/**
 * The interface that describes the data shape being stored
 * for each cached item.
 */
export interface CachedResponse {
	body: string;
	headers: string;
	statusCode: number;
}
