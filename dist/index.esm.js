import { Emitter } from '@irrelon/emitter';

const emitter = new Emitter();
const inFlight = {};
/**
 * Hashes a string to create a unique cache key.
 * @param str The input string to be hashed.
 * @returns The generated hash value.
 */
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const charCode = str.charCodeAt(i);
        hash = ((hash << 5) - hash + charCode) | 0;
    }
    return (hash + 2147483647 + 1).toString();
}
function hasNoCacheHeader(req) {
    return req.get("Cache-Control") === "no-cache";
}
function respondWithCachedResponse(cachedResponse, res) {
    const cachedBody = cachedResponse.body;
    const cachedHeaders = cachedResponse.headers;
    const cachedStatusCode = cachedResponse.statusCode;
    // Set headers that we cached
    if (cachedHeaders) {
        res.set(JSON.parse(cachedHeaders));
    }
    res.status(cachedStatusCode).send(cachedBody);
}
function getPoolSize(cacheKey) {
    const eventListeners = emitter._eventListeners;
    if (!eventListeners)
        return 0;
    const listenersForKey = eventListeners[cacheKey];
    if (!listenersForKey)
        return 0;
    const listenersForKeyGlobals = listenersForKey["*"];
    if (!listenersForKeyGlobals)
        return 0;
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
function expressCache(opts) {
    const defaults = {
        dependsOn: () => [],
        timeOut: 60 * 60 * 1000,
        onTimeout: () => {
            console.log("Cache removed");
        },
        onCacheEvent: () => { },
        cacheStatusCode: (statusCode) => {
            return statusCode >= 200 && statusCode < 400;
        },
        provideCacheKey: (cacheUrl) => {
            return "c_" + hashString(cacheUrl);
        },
        compression: false
    };
    const options = {
        ...defaults,
        ...opts,
    };
    const { dependsOn, timeOut, onTimeout, onCacheEvent, cacheStatusCode, provideCacheKey, cache } = options;
    return async function (req, res, next) {
        const cacheUrl = req.originalUrl || req.url;
        const isNoCacheHeaderPresent = hasNoCacheHeader(req);
        // @ts-expect-error cacheHash is a legit key
        const cacheKey = req.cacheHash || provideCacheKey(cacheUrl, req);
        const depArrayValues = dependsOn();
        const cachedResponse = await cache.get(cacheKey, depArrayValues);
        const missReasons = [];
        if (isNoCacheHeaderPresent) {
            missReasons.push("CACHE_CONTROL_HEADER");
        }
        if (!cachedResponse) {
            if (inFlight[cacheKey]) {
                missReasons.push(`RESPONSE_POOLED: ${getPoolSize(cacheKey) + 1}`);
            }
            else {
                missReasons.push("RESPONSE_NOT_IN_CACHE");
            }
        }
        if (!isNoCacheHeaderPresent && cachedResponse) {
            onCacheEvent("HIT", cacheUrl);
            respondWithCachedResponse(cachedResponse, res);
            return;
        }
        onCacheEvent("MISS", cacheUrl, missReasons.join("; "));
        const originalSend = res.send;
        const originalJson = res.json;
        // Check if there is a pool for this cacheKey
        if (!isNoCacheHeaderPresent && inFlight[cacheKey]) {
            // We already have a request in flight for this resource, hook the event handler
            emitter.once(cacheKey, (cachedResponse) => {
                respondWithCachedResponse(cachedResponse, res);
            });
            return;
        }
        inFlight[cacheKey] = true;
        const storeCache = async (bodyContent, isJson = false) => {
            delete inFlight[cacheKey];
            // Check the status code before storing
            if (!cacheStatusCode(res.statusCode)) {
                return onCacheEvent("NOT_STORED", cacheUrl, `STATUS_CODE (${res.statusCode})`);
            }
            const cachedResponse = {
                body: isJson ? JSON.stringify(bodyContent) : bodyContent,
                headers: JSON.stringify(res.getHeaders()),
                statusCode: res.statusCode
            };
            const cachedSuccessfully = await cache.set(cacheKey, cachedResponse, timeOut, onTimeout, depArrayValues);
            if (cachedSuccessfully) {
                onCacheEvent("STORED", cacheUrl);
            }
            else {
                onCacheEvent("NOT_STORED", cacheUrl, "CACHE_UNAVAILABLE");
            }
            onCacheEvent("POOL_SEND", cacheUrl, `POOL_SIZE: ${getPoolSize(cacheKey)}`);
            emitter.emit(cacheKey, cachedResponse);
        };
        res.send = function (body) {
            storeCache(body, typeof body === "object");
            originalSend.call(this, body);
            return res;
        };
        res.json = function (body) {
            storeCache(body, true);
            originalJson.call(this, body);
            return res;
        };
        next();
    };
}

/**
 * MemoryCache class for caching data in memory.
 */
class MemoryCache {
    cache;
    dependencies;
    timers;
    constructor() {
        this.cache = {};
        this.dependencies = {};
        this.timers = {};
    }
    /**
     * Retrieves a value from the cache.
     * @param key The cache key.
     * @param depArrayValues Dependency values for cache checking.
     * @returns The cached value if found and not expired, otherwise null.
     */
    async get(key, depArrayValues) {
        const item = this.cache[key];
        const checkDepsChanged = this.dependenciesChanged(key, depArrayValues);
        if (checkDepsChanged) {
            void this.remove(key);
            return null;
        }
        if (!item || (item.expireTime > 0 && item.expireTime <= Date.now())) {
            void this.remove(key);
            return null;
        }
        return item.value;
    }
    /**
     * Sets a value in the cache with an optional timeout and callback.
     * @param key The cache key.
     * @param value The value to cache.
     * @param timeoutMs Timeout in milliseconds.
     * @param callback Callback function when the cache expires.
     * @param dependencies Dependency values for cache checking.
     */
    async set(key, value, timeoutMs = 0, callback = () => { }, dependencies = []) {
        this.dependencies[key] = dependencies;
        if (!timeoutMs) {
            this.cache[key] = { value, dependencies };
            return true;
        }
        const expireTime = Date.now() + timeoutMs;
        this.cache[key] = { value, expireTime, dependencies, timeoutMs };
        if (!callback) {
            return true;
        }
        this.timers[key] = setTimeout(() => {
            if (this.cache[key]) {
                callback(key);
                this.remove(key);
            }
        }, timeoutMs);
        return true;
    }
    /**
     * Checks if a key exists in the cache.
     * @param key The cache key to check.
     * @returns True if the key exists in the cache, otherwise false.
     */
    async has(key) {
        return key in this.cache;
    }
    /**
     * Removes a value from the cache.
     * @param key The cache key to remove.
     */
    async remove(key) {
        if (this.timers[key]) {
            clearTimeout(this.timers[key]);
            delete this.timers[key];
        }
        delete this.cache[key];
        delete this.dependencies[key];
    }
    /**
     * Checks if the dependencies have changed.
     * @param key The cache key.
     * @param depArrayValues Dependency values to compare.
     * @returns True if the dependencies have changed, otherwise false.
     */
    dependenciesChanged(key, depArrayValues) {
        const dependencies = this.dependencies[key];
        if (!dependencies) {
            return false;
        }
        const check = JSON.stringify(dependencies) === JSON.stringify(depArrayValues);
        if (check) {
            return false;
        }
        this.dependencies[key] = depArrayValues;
        return true;
    }
}

/**
 * RedisCache class for caching data to a redis server.
 */
class RedisCache {
    client;
    dependencies;
    timers;
    constructor(options = {}) {
        if (!options.client) {
            throw new Error("Must pass redis client as `client` to the constructor object");
        }
        this.client = options.client;
        this.dependencies = {};
        this.timers = {};
    }
    /**
     * Retrieves a value from the cache.
     * @param key The cache key.
     * @param depArrayValues Dependency values for cache checking.
     * @returns The cached value if found and not expired, otherwise null.
     */
    async get(key, depArrayValues = []) {
        if (!this.client.isOpen || !this.client.isReady) {
            // The redis connection is not open or ready, return null
            // which will essentially signal no cache and regenerate the request
            return null;
        }
        const data = await this.client.get(key);
        if (!data) {
            return null;
        }
        // At this point, we know data exists for the cache key so check
        // if any dependencies have changed and if so, clear the existing
        // cache data
        const checkDepsChanged = this.dependenciesChanged(key, depArrayValues);
        if (checkDepsChanged) {
            void this.remove(key);
            return null;
        }
        let item;
        // Attempt to parse the stored data to JSON
        try {
            item = JSON.parse(data);
        }
        catch (err) {
            // Parsing the data returned an error, invalid JSON
            void this.remove(key);
            return null;
        }
        // Check if the data was parsed to something useful
        if (!item) {
            void this.remove(key);
            return null;
        }
        // We have a useful value, return it
        return item.value;
    }
    /**
     * Sets a value in the cache with an optional timeout and callback.
     * @param key The cache key.
     * @param value The value to cache.
     * @param timeoutMs Timeout in milliseconds.
     * @param onTimeout Callback function when the cache expires.
     * @param dependencies Dependency values for cache checking.
     */
    async set(key, value, timeoutMs = 0, onTimeout = () => { }, dependencies = []) {
        if (!this.client.isOpen || !this.client.isReady) {
            // The redis connection is not open or ready, don't store anything
            return false;
        }
        this.dependencies[key] = dependencies;
        if (!timeoutMs) {
            await this.client.set(key, JSON.stringify({ value }));
            return true;
        }
        const expireTime = Date.now() + timeoutMs;
        const expireAt = new Date(expireTime).toISOString();
        await this.client.set(key, JSON.stringify({
            value,
            expireAt,
        }), { PXAT: expireTime });
        if (onTimeout) {
            this.timers[key] = setTimeout(() => {
                onTimeout(key);
                this.remove(key);
            }, timeoutMs);
        }
        return true;
    }
    /**
     * Removes a value from the cache.
     * @param key The cache key to remove.
     */
    async remove(key) {
        if (this.timers[key]) {
            clearTimeout(this.timers[key]);
            delete this.timers[key];
        }
        delete this.dependencies[key];
        if (!this.client.isOpen)
            return;
        await this.client.del(key);
    }
    /**
     * Checks if a key exists in the cache.
     * @param key The cache key to check.
     * @returns True if the key exists in the cache, otherwise false.
     */
    async has(key) {
        if (!this.client.isOpen)
            return false;
        const result = await this.client.exists(key);
        return result === 1;
    }
    /**
     * Checks if the dependencies have changed.
     * @param key The cache key.
     * @param depArrayValues Dependency values to compare.
     * @returns True if the dependencies have changed, otherwise false.
     */
    dependenciesChanged(key, depArrayValues) {
        const dependencies = this.dependencies[key];
        if (!dependencies) {
            return false;
        }
        const check = JSON.stringify(dependencies) === JSON.stringify(depArrayValues);
        if (check) {
            return false;
        }
        else {
            this.dependencies[key] = depArrayValues;
            return true;
        }
    }
}

export { MemoryCache, RedisCache, expressCache, hashString, inFlight };
//# sourceMappingURL=index.esm.js.map
