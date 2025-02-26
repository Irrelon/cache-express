import type {CachedResponse} from "./CachedResponse";
import type {CachedItemContainer} from "./CachedItemContainer";

/**
 * Implement this interface when creating new cache systems
 * for storing and retrieving cache data in different ways.
 */
export interface CacheInterface {
	get: (key: string, depArrayValues: any[]) => Promise<CachedItemContainer | null>;
	set: (key: string, value: CachedResponse, timeoutMins: number, dependencies: any[]) => Promise<boolean>;
	has: (key: string) => Promise<boolean>;
	remove: (key: string) => Promise<boolean>;
}
