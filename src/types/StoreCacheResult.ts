export interface StoreCachePositiveResult {
	didStore: true;
}

export interface StoreCacheNegativeResult {
	didStore: false;
}

export type StoreCacheResult = StoreCachePositiveResult | StoreCacheNegativeResult;
