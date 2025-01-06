import type {CacheEvent} from "./CacheEvent";

/**
 * @param evt The cache event being raised.
 * @param url The url that the event was raised against.
 * @param reason The reason for the event.
 */
export type CacheEventCallback = (evt: CacheEvent, url: string, reason?: string) => void;

