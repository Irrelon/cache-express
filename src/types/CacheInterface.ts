import type {CachedResponse} from "./CachedResponse";
import type {CachedItemContainer} from "./CachedItemContainer";
import type {CacheSetOptions} from "./CacheSetOptions";

/**
 * Implement this interface when creating new cache systems
 * for storing and retrieving cache data in different ways.
 */
export interface CacheInterface {
	get: (key: string) => Promise<CachedItemContainer | null>;
	set: (key: string, value: CachedResponse, timeoutMins: number, options?: CacheSetOptions) => Promise<CachedItemContainer | false>;
	has: (key: string) => Promise<boolean>;
	remove: (key: string) => Promise<boolean>;
}
