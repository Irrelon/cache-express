import type {CacheEventCallback, CacheInterface} from "./index";
import type {Response} from "express";
import type {ExtendedRequest} from "./ExtendedRequest";

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
	 * @param {Request} req The current request.
	 */
	timeOutMins?: <RequestType extends ExtendedRequest>(req: RequestType) => number;
	/**
	 * A callback function to execute when a cache event is raised.
	 */
	onCacheEvent?: CacheEventCallback;
	/**
	 * Provide this callback function to fine-control which requests
	 * should be served a cached response.
	 * @param {Request} req The current request.
	 * @param {Response} res The current response.
	 * @returns Boolean true if the request should be served a cached
	 * response or false if not. You can also return a string explaining
	 * why this should not be cached, and it will be added to the reasons
	 * for the MISS event.
	 */
	shouldGetCache?: <RequestType extends ExtendedRequest>(req: RequestType, res: Response) => boolean | string;
	/**
	 * Provide this callback function to fine-control which requests
	 * should be cached.
	 * @param {Request} req The current request.
	 * @param {Response} res The current response.
	 * @returns Boolean true if the request should be cached or false if not.
	 * You can also return a string explaining why this should not be cached,
	 * and it will be added to the reasons for the NOT_STORED event.
	 */
	shouldSetCache?: <RequestType extends ExtendedRequest>(req: RequestType, res: Response) => boolean | string;
	/**
	 * Provide this callback to generate your own cache keys from
	 * url / request data. This allows you to decide what request
	 * data is important as differentiators in your caching strategy.
	 * @param url The url of the request.
	 * @param req The actual request object.
	 */
	provideCacheKey?: <RequestType extends ExtendedRequest>(url: string, req: RequestType) => string;
	/**
	 * The number of milliseconds to wait for the express route handler
	 * to return a response before we give up.
	 */
	requestTimeoutMs?: number;
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
