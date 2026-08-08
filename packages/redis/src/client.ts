import { Redis, type RedisOptions } from "ioredis";

export interface CreateRedisClientOptions {
  url: string;
  redisOptions?: RedisOptions;
}

/** Single shared client factory so every caller (server + Lua script loader)
 * agrees on connection settings. Node processes are stateless — this client
 * holds a connection, never authoritative game state. */
export function createRedisClient({ url, redisOptions }: CreateRedisClientOptions): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    ...redisOptions,
  });
}
