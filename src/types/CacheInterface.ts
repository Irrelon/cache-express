import type {CachedResponse} from "./CachedResponse";

/**
 * Implement this interface when creating new cache systems
 * for storing and retrieving cache data in different ways.
 */
export interface CacheInterface {
	get: (key: string, depArrayValues: any[]) => Promise<CachedResponse | null>;
	set: (key: string, value: CachedResponse, timeoutMs: number, callback: (key: string) => void, dependencies: any[]) => Promise<boolean>;
	has: (key: string) => Promise<boolean>;
	remove: (key: string) => Promise<boolean>;
}
