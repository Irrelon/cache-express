'use strict';

var emitter$1 = require('@irrelon/emitter');

const emitter = new emitter$1.Emitter();
/**
 * A map of keys and booleans to determine if a particular request (represented
 * by a cache key string) is currently being processed / loaded or not.
 */
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
function requestHasPool(cacheKey, options) {
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
function expressCache(opts) {
    const defaults = {
        dependsOn: () => [],
        timeOutMins: () => 60,
        shouldGetCache: () => {
            return true;
        },
        shouldSetCache: (_, res) => {
            return res.statusCode >= 200 && res.statusCode < 400;
        },
        onCacheEvent: () => {
        },
        provideCacheKey: (cacheUrl) => {
            return "c_" + hashString(cacheUrl);
        },
        requestTimeoutMs: 20000,
        compression: false,
        pooling: true
    };
    const options = {
        ...defaults,
        ...opts
    };
    const { dependsOn, timeOutMins, onCacheEvent, shouldGetCache, shouldSetCache, provideCacheKey, requestTimeoutMs, cache } = options;
    return async function (req, res, next) {
        const cacheUrl = req.originalUrl || req.url;
        const isDisableCacheHeaderPresent = hasNoCacheHeader(req);
        const cacheKey = req.cacheHash || provideCacheKey(cacheUrl, req);
        const depArrayValues = dependsOn();
        const shouldGetCacheResult = shouldGetCache(req, res);
        const missReasons = [];
        let cachedItemContainer;
        if (shouldGetCacheResult === true) {
            cachedItemContainer = await cache.get(cacheKey, depArrayValues);
        }
        else {
            if (typeof shouldGetCacheResult === "string") {
                missReasons.push(shouldGetCacheResult);
            }
            else {
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
            }
            else {
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
            const respondHandler = (cachedResponse) => {
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
        const resolvePool = (bodyContent, isJson = false) => {
            const finalResponse = {
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
        const storeCache = async (bodyContent, isJson = false) => {
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
            const cachedResponse = {
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
            }
            else {
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
            storeCache(body, typeof body === "object").then(({ didStore }) => {
                if (didStore) {
                    onCacheEvent(req, "FINISHED_CACHE_MISS_AND_STORED", {
                        url: cacheUrl,
                    });
                }
                else {
                    onCacheEvent(req, "FINISHED_CACHE_MISS_AND_NOT_STORED", {
                        url: cacheUrl,
                    });
                }
            });
            originalSend.call(this, body);
            return res;
        };
        res.json = function (body) {
            storeCache(body, true).then(({ didStore }) => {
                if (didStore) {
                    onCacheEvent(req, "FINISHED_CACHE_MISS_AND_STORED", {
                        url: cacheUrl,
                    });
                }
                else {
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

function expiryFromMins(timeoutMins) {
    const timeoutMs = timeoutMins * 60000;
    const expireTime = Date.now() + timeoutMs;
    const expireAt = new Date(expireTime).toISOString();
    return {
        timeoutMins,
        timeoutMs,
        expiresTime: expireTime,
        expiresAt: expireAt
    };
}

var version = "4.3.2";

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
        if (!item || (item.metaData.expiry.expiresTime > 0 && item.metaData.expiry.expiresTime <= Date.now())) {
            void this.remove(key);
            return null;
        }
        return item;
    }
    /**
     * Sets a value in the cache with an optional timeout and callback.
     * @param key The cache key.
     * @param value The value to cache.
     * @param timeoutMins Timeout in minutes.
     * @param dependencies Dependency values for cache checking.
     */
    async set(key, value, timeoutMins = 0, dependencies = []) {
        this.dependencies[key] = dependencies;
        const expiry = expiryFromMins(timeoutMins);
        const { timeoutMs, } = expiry;
        if (!timeoutMins) {
            this.cache[key] = {
                value,
                metaData: {
                    expiry,
                    modelVersion: version
                }
            };
            return true;
        }
        // Check if the timeout is greater than the max 32-bit signed integer value
        // that setTimeout accepts
        if (timeoutMs > 0x7FFFFFFF) {
            throw new Error("Timeout cannot be greater than 2147483647ms");
        }
        this.cache[key] = {
            value,
            metaData: {
                expiry,
                modelVersion: version
            }
        };
        this.timers[key] = setTimeout(() => {
            if (this.cache[key]) {
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
        return true;
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
        return item;
    }
    /**
     * Sets a value in the cache with an optional timeout and callback.
     * @param key The cache key.
     * @param value The value to cache.
     * @param timeoutMins Timeout in minutes.
     * @param dependencies Dependency values for cache checking.
     */
    async set(key, value, timeoutMins = 0, dependencies = []) {
        if (!this.client.isOpen || !this.client.isReady) {
            // The redis connection is not open or ready, don't store anything
            return false;
        }
        this.dependencies[key] = dependencies;
        if (!timeoutMins) {
            await this.client.set(key, JSON.stringify({ value }));
            return true;
        }
        const expiry = expiryFromMins(timeoutMins);
        const { expiresTime, } = expiry;
        const cachedItemContainer = {
            value,
            metaData: {
                expiry,
                modelVersion: version
            }
        };
        await this.client.set(key, JSON.stringify(cachedItemContainer), { PXAT: expiresTime });
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
        if (!this.client.isOpen || !this.client.isReady) {
            // The redis connection is not open or ready, don't remove anything
            return false;
        }
        await this.client.del(key);
        return true;
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

exports.MemoryCache = MemoryCache;
exports.RedisCache = RedisCache;
exports.expressCache = expressCache;
exports.hashString = hashString;
exports.inFlight = inFlight;
//# sourceMappingURL=index.cjs.js.map
