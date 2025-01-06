import type {RedisClientType} from "redis";

export interface RedisCacheConstructorOptions {
	client?: RedisClientType<any>;
}
