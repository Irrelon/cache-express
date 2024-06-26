const { Emitter } = require('@irrelon/emitter');
const emitter = new Emitter();

const inFlight = {};

/**
 * Hashes a string to create a unique cache key.
 * @param {string} str - The input string to be hashed.
 * @returns {number} - The generated hash value.
 */
function hashString(str) {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const charCode = str.charCodeAt(i);
		hash = ((hash << 5) - hash + charCode) | 0;
	}
	return hash + 2147483647 + 1;
}

/**
 * MemoryCache class for caching data in memory.
 */
class MemoryCache {
	constructor() {
		this.cache = {};
		this.dependencies = {};
	}

	/**
	 * Retrieves a value from the cache.
	 * @param {string} key - The cache key.
	 * @param {Array} depArrayValues - Dependency values for cache checking.
	 * @returns {*} - The cached value if found and not expired, otherwise null.
	 */
	get(key, depArrayValues) {
		const item = this.cache[key];
		const checkDepsChanged = this.dependenciesChanged(key, depArrayValues);

		if (checkDepsChanged) {
			if (item && item.timer) {
				clearInterval(item.timer);
			}
			delete this.cache[key];
			return null;
		}

		if (item && (!item.expireTime || item.expireTime > Date.now())) {
			return item.value;
		} else {
			delete this.cache[key];
			return null;
		}
	}

	/**
	 * Sets a value in the cache with an optional timeout and callback.
	 * @param {string} key - The cache key.
	 * @param {*} value - The value to cache.
	 * @param {number} timeoutMs - Timeout in milliseconds.
	 * @param {function} callback - Callback function when the cache expires.
	 * @param {Array} dependencies - Dependency values for cache checking.
	 */
	set(key, value, timeoutMs, callback, dependencies) {
		if (timeoutMs && timeoutMs > 0) {
			const expireTime = Date.now() + timeoutMs;
			this.cache[key] = { value, expireTime, dependencies, timeoutMs };

			if (callback) {
				this.cache[key].timer = setTimeout(() => {
					if (this.cache[key]) {
						callback(key, this.cache[key].value);
						delete this.cache[key];
					}
				}, timeoutMs);
			}
		} else {
			this.cache[key] = { value, dependencies };
		}

		this.dependencies[key] = dependencies;
	}

	/**
	 * Removes a value from the cache.
	 * @param {string} key - The cache key to remove.
	 */
	remove(key) {
		delete this.cache[key];
		delete this.dependencies[key];
	}

	/**
	 * Checks if a key exists in the cache.
	 * @param {string} key - The cache key to check.
	 * @returns {boolean} - True if the key exists in the cache, otherwise false.
	 */
	has(key) {
		return key in this.cache;
	}

	/**
	 * Checks if the dependencies have changed.
	 * @param {string} key - The cache key.
	 * @param {Array} depArrayValues - Dependency values to compare.
	 * @returns {boolean} - True if the dependencies have changed, otherwise false.
	 */
	dependenciesChanged(key, depArrayValues) {
		const dependencies = this.dependencies[key];

		if (!dependencies) {
			return false;
		}

		const check =
			JSON.stringify(dependencies) === JSON.stringify(depArrayValues);

		if (check) {
			return false;
		} else {
			this.dependencies[key] = depArrayValues;
			return true;
		}
	}
}

const cache = new MemoryCache();

function doesRequestWantCache  (req) {
	return req.get("Cache-Control") !== "no-cache";
}

function respondWithCachedResponse (cachedResponse, res, onCacheEvent) {
	const cachedBody = cachedResponse.body;
	const cachedHeaders = cachedResponse.headers;
	const cachedStatusCode = cachedResponse.statusCode;
	const cachedIsJson = cachedResponse.isJson;

	// Set headers that we cached
	if (cachedHeaders) {
		res.set(JSON.parse(cachedHeaders));
	}

	res.status(cachedStatusCode).send(cachedBody);
}

function getPoolSize (cacheKey) {
	return ((emitter._eventListeners && emitter._eventListeners[cacheKey] && emitter._eventListeners[cacheKey]["*"]) || []).length;
}

/**
 * @typedef {"MISS" | "HIT" | "STORED" | "NOT_STORED"} CacheEvent
 */

/**
 * Middleware function for Express.js to enable caching.
 *
 * @param {Object} [opts] - Options for caching.
 * @param {Function} [opts.dependsOn=() => []] - A function that returns an array of dependency values for cache checking.
 * @param {number} [opts.timeOut=3600000] - Timeout in milliseconds for cache expiration. Default is 1 hour (3600000 ms).
 * @param {Function} [opts.onTimeout=() => { console.log("Cache removed"); }] - A callback function to execute when a cached item expires.
 * @param {Function} [opts.onCacheEvent=(event: CacheEvent, url: string, reason: string) => {  }] - A callback function to execute when a cache
 * event is raised.
 * @param {Function} [opts.cacheStatusCode=(statusCode: number): boolean => { return statusCode >= 200 && statusCode < 400; }] - A callback function to determine
 * if the response should be cached based on the response statusCode. Defaults to only caching responses in the range of 200 to 399.
 * @param {Function} [opts.provideCacheKey=(url, req): string => { return "c_" + hashString(cacheUrl); }] Use this to override the key that cached objects are stored in.
 * @returns {function} - Middleware function.
 */
function expressCache(opts = {}) {
	const defaults = {
		dependsOn: () => [],
		timeOut: 60 * 60 * 1000,
		onTimeout: () => {
			console.log("Cache removed");
		},
		onCacheEvent: () => {},
		cacheStatusCode: (statusCode) => {
			return statusCode >= 200 && statusCode < 400;
		},
		provideCacheKey: (cacheUrl, req) => {
			return "c_" + hashString(cacheUrl);
		}
	};

	const options = {
		...defaults,
		...opts,
	};

	const {
		dependsOn,
		timeOut,
		onTimeout,
		onCacheEvent,
		cacheStatusCode,
		provideCacheKey
	} = options;

	return function (req, res, next) {
		const cacheUrl = req.originalUrl || req.url;
		const wantsCache = doesRequestWantCache(req);
		const cacheKey = provideCacheKey(cacheUrl, req);
		const depArrayValues = dependsOn();
		const cachedResponse = cache.get(cacheKey, depArrayValues);
		const missReasons = [];

		if (!wantsCache) {
			missReasons.push("CACHE_CONTROL_HEADER");
		}

		if (!cachedResponse) {
			if (inFlight[cacheKey]) {
				missReasons.push(`RESPONSE_POOLED: ${getPoolSize(cacheKey) + 1}`);
			} else {
				missReasons.push("RESPONSE_NOT_IN_CACHE");
			}
		}

		if (wantsCache && cachedResponse) {
			onCacheEvent("HIT", cacheUrl);
			respondWithCachedResponse(cachedResponse, res);
			return;
		}

		onCacheEvent("MISS", cacheUrl, missReasons.join("; "));
		const originalSend = res.send;
		const originalJson = res.json;

		// Check if there is a pool for this cacheKey
		if (wantsCache && inFlight[cacheKey]) {
			// We already have a request in flight for this resource, hook the event handler
			emitter.once(cacheKey, (cachedResponse) => {
				respondWithCachedResponse(cachedResponse, res);
			});
			return;
		}

		inFlight[cacheKey] = true;

		const storeCache = (bodyContent, isJson = false) => {
			delete inFlight[cacheKey];

			// Check the status code before storing
			if (!cacheStatusCode(res.statusCode)) {
				return onCacheEvent("NOT_STORED", cacheUrl, `STATUS_CODE (${res.statusCode})`);
			}

			const cachedResponse = {
				isJson,
				body: isJson ? JSON.stringify(bodyContent) : bodyContent,
				headers: JSON.stringify(res.getHeaders()),
				statusCode: res.statusCode
			};

			cache.set(cacheKey, cachedResponse, timeOut, onTimeout, depArrayValues);

			onCacheEvent("STORED", cacheUrl);
			onCacheEvent("RELEASING", cacheUrl, `POOL_SIZE: ${getPoolSize(cacheKey)}`);
			emitter.emit(cacheKey, cachedResponse);
		}

		res.send = function (body) {
			storeCache(body, typeof body === "object");
			originalSend.call(this, body);
		};

		res.json = function (body) {
			storeCache(body, true)
			originalJson.call(this, body);
		};

		next();
	};
}
module.exports = expressCache;
module.exports.hash = hashString;
module.exports.MemoryCache = MemoryCache;
