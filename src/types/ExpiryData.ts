export interface ExpiryData {
	/**
	 * If the timeout data included timeoutMins greater
	 * than zero this flag will be true, false otherwise.
	 */
	expiryEnabled: boolean;
	/**
	 * The number of minutes to cache for.
	 */
	timeoutMins: number;
	/**
	 * The timeoutMins converted to milliseconds.
	 */
	timeoutMs: number;
	/**
	 * The expiry time calculated as Date.now() + timeoutMs.
	 */
	expiresTime: number;
	/**
	 * The ISO date-time string of the expiresTime.
	 */
	expiresAt: string;
}
