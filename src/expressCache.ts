import {Emitter} from "@irrelon/emitter";
import type {NextFunction, Request, Response} from "express";
import type {CachedResponse} from "./types/CachedResponse";
import type {ExpressCacheOptions} from "./types/ExpressCacheOptions";
import type {ExpressCacheOptionsRequired} from "./types/ExpressCacheOptionsRequired";

const emitter = new Emitter();

/**
 * A map of keys and booleans to determine if a particular request (represented
 * by a cache key string) is currently being processed / loaded or not.
 */
export const inFlight: Record<string, boolean> = {};

/**
 * Hashes a string to create a unique cache key.
 * @param str The input string to be hashed.
 * @returns The generated hash value.
 */
export function hashString(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const charCode = str.charCodeAt(i);
		hash = ((hash << 5) - hash + charCode) | 0;
	}
	return (hash + 2147483647 + 1).toString();
}

function hasNoCacheHeader  (req: Request) {
	return req.get("Cache-Control") === "no-cache";
}

function respondWithCachedResponse (cachedResponse: CachedResponse, res: Response) {
	const cachedBody = cachedResponse.body;
	const cachedHeaders = cachedResponse.headers;
	const cachedStatusCode = cachedResponse.statusCode;

	// Set headers that we cached
	if (cachedHeaders) {
		res.set(JSON.parse(cachedHeaders));
	}

	res.status(cachedStatusCode).send(cachedBody);
}

function getPoolSize (cacheKey: string) {
	const eventListeners = emitter._eventListeners;
	if (!eventListeners) return 0;

	const listenersForKey = eventListeners[cacheKey];
	if (!listenersForKey) return 0;

	const listenersForKeyGlobals = listenersForKey["*"];
	if (!listenersForKeyGlobals) return 0;

	return listenersForKeyGlobals.length;
}

/**
 * Middleware function for Express.js to enable caching. Use it
 * like any express middleware. Calling this function returns
 * the middleware handler that accepts the (req, res, next) arguments
 * that Express passes to its route handlers.
 *
 * @param opts Options for caching.
 * @returns Middleware function.
 */
export function expressCache(opts: ExpressCacheOptions) {
	const defaults: Omit<ExpressCacheOptionsRequired, "cache"> = {
		dependsOn: () => [],
		timeOut: 60 * 60 * 1000,
		onTimeout: () => {
			console.log("Cache removed");
		},
		onCacheEvent: () => {},
		cacheStatusCode: (statusCode: number) => {
			return statusCode >= 200 && statusCode < 400;
		},
		provideCacheKey: (cacheUrl: string) => {
			return "c_" + hashString(cacheUrl);
		},
		compression: false,
		pooling: true
	};

	const options: ExpressCacheOptionsRequired = {
		...defaults,
		...opts,
	};

	const {
		dependsOn,
		timeOut,
		onTimeout,
		onCacheEvent,
		cacheStatusCode,
		provideCacheKey,
		cache
	} = options;

	return async function (req: Request<any>, res: Response<any>, next: NextFunction) {
		const cacheUrl = req.originalUrl || req.url;
		const isDisableCacheHeaderPresent = hasNoCacheHeader(req);
		// @ts-expect-error cacheHash is a legit key
		const cacheKey = req.cacheHash || provideCacheKey(cacheUrl, req);
		const depArrayValues = dependsOn();
		const cachedResponse = await cache.get(cacheKey, depArrayValues);
		const missReasons = [];

		if (isDisableCacheHeaderPresent) {
			missReasons.push("CACHE_CONTROL_HEADER");
		}

		if (!cachedResponse) {
			if (options.pooling && inFlight[cacheKey]) {
				missReasons.push(`RESPONSE_POOLED: ${getPoolSize(cacheKey) + 1}`);
			} else {
				missReasons.push("RESPONSE_NOT_IN_CACHE");
			}
		}

		if (!isDisableCacheHeaderPresent && cachedResponse) {
			onCacheEvent("HIT", cacheUrl);
			respondWithCachedResponse(cachedResponse, res);
			return;
		}

		onCacheEvent("MISS", cacheUrl, missReasons.join("; "));
		const originalSend = res.send;
		const originalJson = res.json;

		// Check if there is a pool for this cacheKey
		if (!isDisableCacheHeaderPresent && options.pooling && inFlight[cacheKey]) {
			// We already have a request in flight for this resource, hook the event handler
			emitter.once(cacheKey, (cachedResponse) => {
				// The event was fired indicating we have a response to the request
				respondWithCachedResponse(cachedResponse, res);
			});
			return;
		}

		if (options.pooling) {
			inFlight[cacheKey] = true;
		}

		const storeCache = async (bodyContent: string, isJson = false) => {
			if (options.pooling) {
				delete inFlight[cacheKey];
			}

			// Check the status code before storing
			if (!cacheStatusCode(res.statusCode)) {
				return onCacheEvent("NOT_STORED", cacheUrl, `STATUS_CODE (${res.statusCode})`);
			}

			const cachedResponse: CachedResponse = {
				body: isJson ? JSON.stringify(bodyContent) : bodyContent,
				headers: JSON.stringify(res.getHeaders()),
				statusCode: res.statusCode
			};

			const cachedSuccessfully = await cache.set(cacheKey, cachedResponse, timeOut, onTimeout, depArrayValues);
			if (cachedSuccessfully) {
				onCacheEvent("STORED", cacheUrl);
			} else {
				onCacheEvent("NOT_STORED", cacheUrl, "CACHE_UNAVAILABLE");
			}

			if (options.pooling) {
				onCacheEvent("POOL_SEND", cacheUrl, `POOL_SIZE: ${getPoolSize(cacheKey)}`);
			}

			emitter.emit(cacheKey, cachedResponse);
		}

		res.send = function (body) {
			storeCache(body, typeof body === "object");
			originalSend.call(this, body);
			return res;
		};

		res.json = function (body) {
			storeCache(body, true)
			originalJson.call(this, body);
			return res;
		};

		next();
	};
}
