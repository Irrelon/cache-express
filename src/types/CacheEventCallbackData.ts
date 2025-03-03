import type {CachedItemContainer} from "./CachedItemContainer";

export interface CacheEventCallbackData {
	url: string;
	reason?: string;
	cachedItemContainer?: CachedItemContainer,
}
