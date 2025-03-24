import type {CachedResponse} from "./CachedResponse";
import type {ExpiryData} from "./ExpiryData";

export interface CachedItemContainer extends Record<string, any> {
	value: CachedResponse;
	metaData: {
		expiry: ExpiryData;
		modelVersion: string;
	} & Record<string, any>;
}
