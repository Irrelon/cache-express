import type {CachedItemContainer} from "./CachedItemContainer";

export interface CacheHitEventCallbackData {
	url: string;
	reason?: string;
	cachedItemContainer: CachedItemContainer,
}

export interface CacheMissEventCallbackData {
	url: string;
	reason?: string;
}

export type CacheEventCallbackData = CacheHitEventCallbackData | CacheMissEventCallbackData;
