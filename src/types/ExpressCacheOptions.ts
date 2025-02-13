import type {CacheEventCallback, CacheInterface} from "./index";
import type {Request, Response} from "express";

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
