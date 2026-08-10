import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Pool } from "pg";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

/** Hand-rolled migration runner, same minimal-tooling preference as the rest
 * of the repo (raw ws, raw http, hand-written Lua) — no ORM/migration
 * framework for four tables. Applies every `.sql` file in `src/migrations`
 * not yet recorded in `schema_migrations`, in filename order, each inside
 * its own transaction. Returns the filenames newly applied (empty on a
 * no-op rerun). */
export async function runMigrations(pool: Pool): Promise<string[]> {
  await pool.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const { rows } = await pool.query<{ name: string }>("select name from schema_migrations");
  const applied = new Set(rows.map((row) => row.name));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    newlyApplied.push(file);
  }

  return newlyApplied;
}
