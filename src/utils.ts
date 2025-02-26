import type {ExpiryData} from "./types/ExpiryData";

export function expiryFromMins (timeoutMins: number): ExpiryData {
	const timeoutMs = timeoutMins * 60000;
	const expireTime = Date.now() + timeoutMs;
	const expireAt = new Date(expireTime).toISOString();

	return {
		timeoutMins,
		timeoutMs,
		expiresTime: expireTime,
		expiresAt: expireAt
	}
}
