import type {CacheEvent} from "./CacheEvent";
import type {ExtendedRequest} from "./ExtendedRequest";
import type {CacheEventCallbackData} from "./CacheEventCallbackData";

/**
 * @param req The request that caused the event.
 * @param evt The cache event being raised.
 * @param url The url that the event was raised against.
 * @param reason The reason for the event.
 */
export type CacheEventCallback = (req: ExtendedRequest, evt: CacheEvent, data: CacheEventCallbackData) => void;

