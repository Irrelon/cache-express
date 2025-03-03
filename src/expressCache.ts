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

function respondWithCachedResponse(cachedResponse: CachedResponse, res: Response, resultHeaderValue: string = "HIT") {
	if (res.headersSent) {
		// The connection has already had a response stopped
		console.error("Could not resolve response in pooled request because headers were already sent. Did we take too long and express closed the request already?");
		return;
	}
	const cachedBody = cachedResponse.body;
	const cachedHeaders = cachedResponse.headers;
	const cachedStatusCode = cachedResponse.statusCode;

	// Set headers that we cached
	if (cachedHeaders) {
		res.set(JSON.parse(cachedHeaders));
	}

	// Reset the encoding because we don't cache gzipped data
	res.set("content-encoding", "identity");
	res.set("x-cache-result", resultHeaderValue);
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
		shouldGetCache: (req) => {
			const isDisableCacheHeaderPresent = hasNoCacheHeader(req);

			if (isDisableCacheHeaderPresent) {
				// When we return a string it is the same as returning `false` but also
				// provides a reason that goes in the log
				return "CACHE_CONTROL_HEADER";
			}

			return true;
		},
		shouldSetCache: (_, res) => {
			if (res.statusCode >= 200 && res.statusCode < 400) {
				return true;
			}

			return "STATUS_CODE_NOT_2XX_3XX";
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
		const cacheKey = req.cacheHash || provideCacheKey(cacheUrl, req);
		const depArrayValues = dependsOn();
		const shouldGetCacheResult = shouldGetCache(req, res);
		const missReasons = [];
		let cachedItemContainer;

		// Check if the no-pool header is present
		const noPoolHeader = req.get("x-cache-do-not-pool") === "true";

		// If we have a no-pool header, check if there is a pool for this request
		if (noPoolHeader && requestHasPool(cacheKey, options)) {
			// A pool exists and the no-pool header is present, see if we
			// can respond with a cached result instead
			const tmpCachedItemContainer = await cache.get(cacheKey, depArrayValues);

			if (tmpCachedItemContainer) {
				// A cached result exists, respond with it instead of pooling
				respondWithCachedResponse(tmpCachedItemContainer.value, res);
				return;
			}
		}

		if (shouldGetCacheResult === true) {
			cachedItemContainer = await cache.get(cacheKey, depArrayValues);
		} else {
			if (typeof shouldGetCacheResult === "string") {
				missReasons.push(shouldGetCacheResult);
			} else {
				missReasons.push("SHOULD_GET_CACHE_FALSE");
			}
		}

		if (cachedItemContainer) {
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
				respondWithCachedResponse(cachedResponse, res, "POOLED");
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
			res.set("x-cache-result", "MISS");
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
			res.set("x-cache-result", "MISS");
			originalJson.call(this, body);
			return res;
		};

		next();
	};
}
