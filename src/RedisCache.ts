import type {CacheInterface} from "./types/CacheInterface";
import type {RedisClientType} from "redis";
import type {RedisCacheConstructorOptions} from "./types/RedisCacheConstructorOptions";

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
	 * @param depArrayValues Dependency values for cache checking.
	 * @returns The cached value if found and not expired, otherwise null.
	 */
	async get(key: string, depArrayValues: any[] = []) {
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
		return item.value;
	}

	/**
	 * Sets a value in the cache with an optional timeout and callback.
	 * @param key The cache key.
	 * @param value The value to cache.
	 * @param timeoutMins Timeout in minutes.
	 * @param onTimeout Callback function when the cache expires.
	 * @param dependencies Dependency values for cache checking.
	 */
	async set(key: string, value: any, timeoutMins: number = 0, onTimeout: (key: string) => void = () => {}, dependencies: any[] = []): Promise<boolean> {
		if (!this.client.isOpen || !this.client.isReady) {
			// The redis connection is not open or ready, don't store anything
			return false;
		}

		this.dependencies[key] = dependencies;

		if (!timeoutMins) {
			await this.client.set(key, JSON.stringify({value}));
			return true;
		}

		const timeoutMs = timeoutMins * 60000;
		const expireTime = Date.now() + timeoutMs;
		const expireAt = new Date(expireTime).toISOString();
		await this.client.set(key, JSON.stringify({
			value,
			expireAt,
		}), {PXAT: expireTime});

		return true;
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

	/**
	 * Checks if the dependencies have changed.
	 * @param key The cache key.
	 * @param depArrayValues Dependency values to compare.
	 * @returns True if the dependencies have changed, otherwise false.
	 */
	dependenciesChanged(key: string, depArrayValues: any[]): boolean {
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
