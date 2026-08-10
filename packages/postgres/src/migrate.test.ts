// Integration tests against a real Postgres (not a mock) — same rationale/
// harness as packages/redis's Lua tests (CLAUDE.md "Testing strategy"):
// the point is verifying real schema/constraint behavior, not a mock's idea
// of it.

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPostgresClient } from "./client.js";
import { runMigrations } from "./migrate.js";

describe("runMigrations", () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    pool = createPostgresClient({ connectionString: container.getConnectionUri() });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("applies every migration and creates the documented tables", async () => {
    const applied = await runMigrations(pool);

    expect(applied).toEqual(["0001_init.sql"]);

    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "game_players",
      "games",
      "player_settings",
      "schema_migrations",
      "word_plays",
    ]);
  });

  it("is idempotent — a second run applies nothing new", async () => {
    const applied = await runMigrations(pool);

    expect(applied).toEqual([]);
  });
});
