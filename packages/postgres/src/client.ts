import { Pool, type PoolConfig } from "pg";
import { Kysely, PostgresDialect } from "kysely";
import type { Database } from "./schema.js";

export interface CreatePostgresClientOptions {
  connectionString: string;
  poolConfig?: PoolConfig;
}

/** Single shared pool factory, same rationale as packages/redis's
 * createRedisClient — every caller agrees on connection settings. Postgres
 * here is durable history only, never on the critical path of a move (see
 * CLAUDE.md "Core architecture"). createDb below wraps this same pool for
 * both migrations (src/migrate.ts) and typed queries. */
export function createPostgresClient({
  connectionString,
  poolConfig,
}: CreatePostgresClientOptions): Pool {
  return new Pool({ connectionString, ...poolConfig });
}

/** Kysely instance for typed queries (see docs/decisions.md "packages/postgres:
 * Kysely for queries, hand-rolled SQL for migrations") — wraps the same Pool
 * used for migrations rather than owning its own connection. */
export function createDb(pool: Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
