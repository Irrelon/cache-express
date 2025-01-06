import type {CacheInterface} from "./CacheInterface";
import type {CacheEventCallback} from "./CacheEventCallback";
import type {Request} from "express";

export interface ExpressCacheOptions {
	/**
	 * The caching system to use to store and retrieve cache data.
	 */
	cache: CacheInterface;
	/**
	 *  A function that returns an array of dependency values for cache checking.
	 */
	dependsOn?: () => any[];
	/**
	 * Timeout in milliseconds for cache expiration. Default is 1 hour (3600000 ms).
	 */
	timeOut?: number;
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
	 * Provide this callback function to fine-control which request
	 * status codes should be cached.
	 * @param statusCode The status code of the current request.
	 * @returns True if the request should be cached or false if not.
	 */
	cacheStatusCode?: (statusCode: number) => boolean;
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
}
