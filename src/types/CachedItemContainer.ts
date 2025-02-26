import type {CachedResponse} from "./CachedResponse";
import type {ExpiryData} from "./ExpiryData";

export interface CachedItemContainer {
	value: CachedResponse;
	metaData: {
		expiry: ExpiryData;
		modelVersion: string;
	}
}
