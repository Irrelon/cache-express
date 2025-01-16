import type {CacheInterface} from "./types/CacheInterface";

/**
 * MemoryCache class for caching data in memory.
 */
export class MemoryCache implements CacheInterface {
	cache: Record<string, any>;
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
	async get(key: string, depArrayValues: any[]): Promise<any | null> {
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
	async set(key: string, value: any, timeoutMs: number = 0, callback: (key: string) => void = () => {}, dependencies: any[] = []) {
		this.dependencies[key] = dependencies;

		if (!timeoutMs) {
			this.cache[key] = {value, dependencies};
			return true;
		}

		const expireTime = Date.now() + timeoutMs;
		this.cache[key] = {value, expireTime, dependencies, timeoutMs};

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
