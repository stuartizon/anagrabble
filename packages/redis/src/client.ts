import { createClient, type RedisClientOptions } from "redis";

export type Redis = ReturnType<typeof createClient>;

export interface CreateRedisClientOptions {
  url: string;
  redisOptions?: RedisClientOptions;
}

/** Single shared client factory so every caller (server + Lua script loader)
 * agrees on connection settings. Node processes are stateless — this client
 * holds a connection, never authoritative game state. Unlike ioredis,
 * node-redis doesn't connect on construction — callers must await
 * `.connect()` themselves before issuing commands. */
export function createRedisClient({ url, redisOptions }: CreateRedisClientOptions): Redis {
  return createClient({ url, ...redisOptions });
}
