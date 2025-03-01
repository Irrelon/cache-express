import {Emitter} from "@irrelon/emitter";
import type {NextFunction, Request, Response} from "express";
import type {
	CachedResponse,
	ExpressCacheOptions,
	ExpressCacheOptionsRequired,
	ExtendedRequest,
	StoreCacheResult
} from "./types";

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

function hasNoCacheHeader(req: Request) {
	return req.get("Cache-Control") === "no-cache";
}

function respondWithCachedResponse(cachedResponse: CachedResponse, res: Response) {
	const cachedBody = cachedResponse.body;
	const cachedHeaders = cachedResponse.headers;
	const cachedStatusCode = cachedResponse.statusCode;

	// Set headers that we cached
	if (cachedHeaders) {
		res.set(JSON.parse(cachedHeaders));
	}

	res.status(cachedStatusCode).send(cachedBody);
}

function getPoolSize(cacheKey: string) {
	const eventListeners = emitter._eventListeners;
	if (!eventListeners) return 0;

	const listenersForKey = eventListeners[cacheKey];
	if (!listenersForKey) return 0;

	const listenersForKeyGlobals = listenersForKey["*"];
	if (!listenersForKeyGlobals) return 0;

	return listenersForKeyGlobals.length;
}

function requestHasPool(cacheKey: string, options: ExpressCacheOptionsRequired) {
	return options.pooling && inFlight[cacheKey];
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
		timeOutMins: () => 60,
		shouldGetCache: (): boolean => {
			return true;
		},
		shouldSetCache: (_, res): boolean => {
			return res.statusCode >= 200 && res.statusCode < 400;
		},
		onCacheEvent: () => {
		},
		provideCacheKey: (cacheUrl: string) => {
			return "c_" + hashString(cacheUrl);
		},
		requestTimeoutMs: 20000,
		compression: false,
		pooling: true
	};

	const options: ExpressCacheOptionsRequired = {
		...defaults,
		...opts
	};

	const {
		dependsOn,
		timeOutMins,
		onCacheEvent,
		shouldGetCache,
		shouldSetCache,
		provideCacheKey,
		requestTimeoutMs,
		cache
	} = options;

	return async function (req: ExtendedRequest, res: Response, next: NextFunction) {
		const cacheUrl = req.originalUrl || req.url;
		const isDisableCacheHeaderPresent = hasNoCacheHeader(req);
		const cacheKey = req.cacheHash || provideCacheKey(cacheUrl, req);
		const depArrayValues = dependsOn();
		const shouldGetCacheResult = shouldGetCache(req, res);
		const missReasons = [];
		let cachedItemContainer;

		if (shouldGetCacheResult === true) {
			cachedItemContainer = await cache.get(cacheKey, depArrayValues);
		} else {
			if (typeof shouldGetCacheResult === "string") {
				missReasons.push(shouldGetCacheResult);
			} else {
				missReasons.push("SHOULD_GET_CACHE_FALSE");
			}
		}

		if (!isDisableCacheHeaderPresent && cachedItemContainer) {
			onCacheEvent(req, "HIT", {
				url: cacheUrl,
				cachedItemContainer,
			});
			respondWithCachedResponse(cachedItemContainer.value, res);
			onCacheEvent(req, "FINISHED_CACHE_HIT", {
				url: cacheUrl,
				cachedItemContainer,
			});
			return;
		}

		if (isDisableCacheHeaderPresent) {
			missReasons.push("CACHE_CONTROL_HEADER");
		}

		if (!cachedItemContainer) {
			if (requestHasPool(cacheKey, options)) {
				missReasons.push(`RESPONSE_POOLED: ${getPoolSize(cacheKey) + 1}`);
			} else {
				missReasons.push("RESPONSE_NOT_IN_CACHE");
			}
		}

		onCacheEvent(req, "MISS", {
			url: cacheUrl,
			reason: missReasons.join("; "),
		});
		const originalSend = res.send;
		const originalJson = res.json;

		// Check if there is a pool for this cacheKey
		if (requestHasPool(cacheKey, options)) {
			// We already have a request pool for this resource, hook the event handler
			const respondHandler = (cachedResponse: CachedResponse) => {
				// The event was fired indicating we have a response to the request
				clearTimeout(requestTimeout);
				respondWithCachedResponse(cachedResponse, res);
			};

			// Set a timeout on the pool to ensure we don't hang it forever
			const requestTimeout = setTimeout(() => {
				emitter.off(cacheKey, respondHandler);
				res.status(504).send({
					isErr: true,
					status: 504,
					err: {
						key: "REQUEST_TIMEOUT",
						msg: "Request timed out waiting for the route handler to respond"
					}
				});
			}, requestTimeoutMs);

			// Emit the event to resolve the pool
			emitter.once(cacheKey, respondHandler);
			return;
		}

		// If polling is enabled, store that we have an in-flight request for this resource now
		if (options.pooling) {
			inFlight[cacheKey] = true;
		}

		const resolvePool = (bodyContent: string, isJson = false) => {
			const finalResponse: Required<CachedResponse> = {
				body: isJson ? JSON.stringify(bodyContent) : bodyContent,
				headers: JSON.stringify(res.getHeaders()),
				statusCode: res.statusCode,
				requestUrl: req.originalUrl || req.url,
			};

			if (options.pooling) {
				delete inFlight[cacheKey];
				onCacheEvent(req, "POOL_SEND", {
					url: cacheUrl,
					reason: `POOL_SIZE: ${getPoolSize(cacheKey)}`,
				});
			}

			emitter.emit(cacheKey, finalResponse);
		};

		const storeCache = async (bodyContent: string, isJson = false): Promise<StoreCacheResult> => {
			// Check the status code before storing
			const shouldCacheResult = shouldSetCache(req, res);
			if (shouldCacheResult !== true) {
				resolvePool(bodyContent, isJson);

				if (typeof shouldCacheResult === "string") {
					onCacheEvent(req, "NOT_STORED", {
						url: cacheUrl,
						reason: `STATUS_CODE (${res.statusCode}); ${shouldCacheResult}`,
					});

					return {
						didStore: false
					};
				}

				onCacheEvent(req, "NOT_STORED", {
					url: cacheUrl,
					reason: `STATUS_CODE (${res.statusCode})`
				});

				return {
					didStore: false
				};
			}

			const cachedResponse: CachedResponse = {
				body: isJson ? JSON.stringify(bodyContent) : bodyContent,
				headers: JSON.stringify(res.getHeaders()),
				statusCode: res.statusCode,
				requestUrl: req.originalUrl || req.url,
			};

			const timeoutMins = timeOutMins(req);
			const cachedSuccessfully = await cache.set(cacheKey, cachedResponse, timeoutMins, depArrayValues);

			if (cachedSuccessfully) {
				onCacheEvent(req, "STORED", {
					url: cacheUrl,
				});
			} else {
				onCacheEvent(req, "NOT_STORED", {
					url: cacheUrl,
					reason: "CACHE_UNAVAILABLE",
				});
			}

			resolvePool(bodyContent, isJson);

			return {
				didStore: true,
			};
		};

		res.send = function (body) {
			storeCache(body, typeof body === "object").then(({didStore}) => {
				if (didStore) {
					onCacheEvent(req, "FINISHED_CACHE_MISS_AND_STORED", {
						url: cacheUrl,
					});
				} else {
					onCacheEvent(req, "FINISHED_CACHE_MISS_AND_NOT_STORED", {
						url: cacheUrl,
					});
				}
			});
			originalSend.call(this, body);
			return res;
		};

		res.json = function (body) {
			storeCache(body, true).then(({didStore}) => {
				if (didStore) {
					onCacheEvent(req, "FINISHED_CACHE_MISS_AND_STORED", {
						url: cacheUrl,
					});
				} else {
					onCacheEvent(req, "FINISHED_CACHE_MISS_AND_NOT_STORED", {
						url: cacheUrl
					});
				}
			});
			originalJson.call(this, body);
			return res;
		};

		next();
	};
}
