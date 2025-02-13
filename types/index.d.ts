import { Request, Response, NextFunction } from 'express';
import { RedisClientType } from 'redis';

/**
 * The interface that describes the data shape being stored
 * for each cached item.
 */
interface CachedResponse {
    body: string;
    headers: string;
    statusCode: number;
}

type CacheEvent = "MISS" | "HIT" | "STORED" | "NOT_STORED" | "POOL_SEND";

/**
 * @param evt The cache event being raised.
 * @param url The url that the event was raised against.
 * @param reason The reason for the event.
 */
type CacheEventCallback = (evt: CacheEvent, url: string, reason?: string) => void;

/**
 * Implement this interface when creating new cache systems
 * for storing and retrieving cache data in different ways.
 */
interface CacheInterface {
    get: (key: string, depArrayValues: any[]) => Promise<CachedResponse | null>;
    set: (key: string, value: CachedResponse, timeoutMins: number, callback: (key: string) => void, dependencies: any[]) => Promise<boolean>;
    has: (key: string) => Promise<boolean>;
    remove: (key: string) => Promise<boolean>;
}

interface ExpressCacheOptions {
    /**
     * The caching system to use to store and retrieve cache data.
     */
    cache: CacheInterface;
    /**
     *  A function that returns an array of dependency values for cache checking.
     */
    dependsOn?: () => any[];
    /**
     * Timeout in minutes for cache expiration. Default is 1 hour (60 mins).
     */
    timeOutMins?: number;
    /**
     * A callback function to execute when a cached item expires.
     * @param key The key that timed out.
     */
    onTimeout?: (key: string) => void;
    /**
     * A callback function to execute when a cache event is raised.
     */
    onCacheEvent?: CacheEventCallback;
    /**
     * Provide this callback function to fine-control which requests
     * should be cached.
     * @param {Request} req The current request.
     * @param {Response} res The current response.
     * @returns Boolean true if the request should be cached or false if not.
     * You can also return a string explaining why this should not be cached,
     * and it will be added to the reasons for the NOT_STORED event.
     */
    shouldCache?: (req: Request, res: Response) => boolean | string;
    /**
     * Provide this callback to generate your own cache keys from
     * url / request data. This allows you to decide what request
     * data is important as differentiators in your caching strategy.
     * @param url The url of the request.
     * @param req The actual request object.
     */
    provideCacheKey?: (url: string, req: Request) => string;
    /**
     * Flag indicating if we should compress the data before storing
     * it in the cache system. Defaults to false.
     */
    compression?: boolean;
    /**
     * Flag indicating if connection pooling should be enabled or not.
     * Defaults to true.
     */
    pooling?: boolean;
}

interface ExpressCacheOptionsRequired extends Required<ExpressCacheOptions> {
}

interface RedisCacheConstructorOptions {
    client?: RedisClientType<any>;
}

/**
 * A map of keys and booleans to determine if a particular request (represented
 * by a cache key string) is currently being processed / loaded or not.
 */
declare const inFlight: Record<string, boolean>;
/**
 * Hashes a string to create a unique cache key.
 * @param str The input string to be hashed.
 * @returns The generated hash value.
 */
declare function hashString(str: string): string;
/**
 * Middleware function for Express.js to enable caching. Use it
 * like any express middleware. Calling this function returns
 * the middleware handler that accepts the (req, res, next) arguments
 * that Express passes to its route handlers.
 *
 * @param opts Options for caching.
 * @returns Middleware function.
 */
declare function expressCache(opts: ExpressCacheOptions): (req: Request<any>, res: Response<any>, next: NextFunction) => Promise<void>;

/**
 * MemoryCache class for caching data in memory.
 */
declare class MemoryCache implements CacheInterface {
    cache: Record<string, any>;
    dependencies: Record<string, any[]>;
    timers: Record<string, any>;
    constructor();
    /**
     * Retrieves a value from the cache.
     * @param key The cache key.
     * @param depArrayValues Dependency values for cache checking.
     * @returns The cached value if found and not expired, otherwise null.
     */
    get(key: string, depArrayValues: any[]): Promise<any | null>;
    /**
     * Sets a value in the cache with an optional timeout and callback.
     * @param key The cache key.
     * @param value The value to cache.
     * @param timeoutMins Timeout in minutes.
     * @param callback Callback function when the cache expires.
     * @param dependencies Dependency values for cache checking.
     */
    set(key: string, value: any, timeoutMins?: number, callback?: (key: string) => void, dependencies?: any[]): Promise<boolean>;
    /**
     * Checks if a key exists in the cache.
     * @param key The cache key to check.
     * @returns True if the key exists in the cache, otherwise false.
     */
    has(key: string): Promise<boolean>;
    /**
     * Removes a value from the cache.
     * @param key The cache key to remove.
     */
    remove(key: string): Promise<boolean>;
    /**
     * Checks if the dependencies have changed.
     * @param key The cache key.
     * @param depArrayValues Dependency values to compare.
     * @returns True if the dependencies have changed, otherwise false.
     */
    dependenciesChanged(key: string, depArrayValues: any[]): boolean;
}

/**
 * RedisCache class for caching data to a redis server.
 */
declare class RedisCache implements CacheInterface {
    client: RedisClientType<any>;
    dependencies: Record<string, any[]>;
    timers: Record<string, any>;
    constructor(options?: RedisCacheConstructorOptions);
    /**
     * Retrieves a value from the cache.
     * @param key The cache key.
     * @param depArrayValues Dependency values for cache checking.
     * @returns The cached value if found and not expired, otherwise null.
     */
    get(key: string, depArrayValues?: any[]): Promise<any>;
    /**
     * Sets a value in the cache with an optional timeout and callback.
     * @param key The cache key.
     * @param value The value to cache.
     * @param timeoutMins Timeout in minutes.
     * @param onTimeout Callback function when the cache expires.
     * @param dependencies Dependency values for cache checking.
     */
    set(key: string, value: any, timeoutMins?: number, onTimeout?: (key: string) => void, dependencies?: any[]): Promise<boolean>;
    /**
     * Removes a value from the cache.
     * @param key The cache key to remove.
     */
    remove(key: string): Promise<boolean>;
    /**
     * Checks if a key exists in the cache.
     * @param key The cache key to check.
     * @returns True if the key exists in the cache, otherwise false.
     */
    has(key: string): Promise<boolean>;
    /**
     * Checks if the dependencies have changed.
     * @param key The cache key.
     * @param depArrayValues Dependency values to compare.
     * @returns True if the dependencies have changed, otherwise false.
     */
    dependenciesChanged(key: string, depArrayValues: any[]): boolean;
}

export { type CacheEvent, type CacheEventCallback, type CacheInterface, type CachedResponse, type ExpressCacheOptions, type ExpressCacheOptionsRequired, MemoryCache, RedisCache, type RedisCacheConstructorOptions, expressCache, hashString, inFlight };
