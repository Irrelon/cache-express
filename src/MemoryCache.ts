import type {CacheInterface} from "./types/CacheInterface";
import {expiryFromMins} from "./utils";
import type {CachedItemContainer} from "./types/CachedItemContainer";
import {version} from "../package.json";

/**
 * MemoryCache class for caching data in memory.
 */
export class MemoryCache implements CacheInterface {
	cache: Record<string, CachedItemContainer>;
	dependencies: Record<string, any[]>;
	timers: Record<string, any>;

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
	async get(key: string, depArrayValues: any[]) {
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
	async set(key: string, value: any, timeoutMins: number = 0, dependencies: any[] = []): Promise<CachedItemContainer | false> {
		this.dependencies[key] = dependencies;

		const expiry = expiryFromMins(timeoutMins);
		const {
			timeoutMs,
		} = expiry;

		if (!timeoutMins) {
			this.cache[key] = {
				value,
				metaData: {
					expiry,
					modelVersion: version
				}
			};
			return this.cache[key];
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

		return this.cache[key];
	}

	/**
	 * Checks if a key exists in the cache.
	 * @param key The cache key to check.
	 * @returns True if the key exists in the cache, otherwise false.
	 */
	async has(key: string): Promise<boolean> {
		return key in this.cache;
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
	dependenciesChanged(key: string, depArrayValues: any[]): boolean {
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
