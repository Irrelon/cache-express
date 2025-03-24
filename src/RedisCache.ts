import type {CacheInterface, CacheSetOptions, RedisCacheConstructorOptions, CachedItemContainer} from "./types";
import type {RedisClientType} from "redis";
import {expiryFromMins} from "./utils";
import {version} from "../package.json";

/**
 * RedisCache class for caching data to a redis server.
 */
export class RedisCache implements CacheInterface {
	client: RedisClientType<any>;
	dependencies: Record<string, any[]>;
	timers: Record<string, any>;

	constructor(options: RedisCacheConstructorOptions = {}) {
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
	 * @returns The cached value if found and not expired, otherwise null.
	 */
	async get(key: string): Promise<CachedItemContainer | null> {
		if (!this.client.isOpen || !this.client.isReady) {
			// The redis connection is not open or ready, return null
			// which will essentially signal no cache and regenerate the request
			return null;
		}

		const data = await this.client.get(key);

		if (!data) {
			return null;
		}

		let item;

		// Attempt to parse the stored data to JSON
		try {
			item = JSON.parse(data);
		} catch (err: unknown) {
			void err;
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
	 * @param [options] Options object.
	 */
	async set(key: string, value: any, timeoutMins: number = 0, options?: CacheSetOptions): Promise<CachedItemContainer | false> {
		if (!this.client.isOpen || !this.client.isReady) {
			// The redis connection is not open or ready, don't store anything
			return false;
		}

		const expiry = expiryFromMins(timeoutMins);
		const { expiresTime } = expiry;

		const cachedItemContainer: CachedItemContainer = {
			...(options?.containerData || {}),
			value,
			metaData: {
				...(options?.metaData || {}),
				expiry,
				modelVersion: version,
			}
		};

		const expiryOption = timeoutMins ? {"PXAT": expiresTime} : undefined;

		await this.client.set(key, JSON.stringify(cachedItemContainer), expiryOption);

		return cachedItemContainer;
	}

	/**
	 * Removes a value from the cache.
	 * @param key The cache key to remove.
	 */
	async remove(key: string) {
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
	async has(key: string): Promise<boolean> {
		if (!this.client.isOpen) return false;
		const result = await this.client.exists(key);
		return result === 1;
	}
}
