import type { Request } from "express";

export interface ExtendedRequest extends Request {
	cacheHash?: string;
}
