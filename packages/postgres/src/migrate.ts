import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sql, type Kysely } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import type { Database } from "./schema.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

/** Reads the same plain `.sql` files this repo has always used for
 * migrations (see docs/decisions.md "packages/postgres: Kysely for queries
 * and migrations") and hands each one to Kysely's Migrator as a `Migration`
 * whose `up` runs the file's raw SQL — the schema stays "just SQL files",
 * only the runner changes. */
class SqlFileMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql"));

    const migrations: Record<string, Migration> = {};
    for (const file of files) {
      const contents = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      migrations[file] = {
        async up(db) {
          await sql.raw(contents).execute(db);
        },
      };
    }
    return migrations;
  }
}

/** Applies every not-yet-run migration in `src/migrations`, in filename
 * order, via Kysely's own `Migrator` rather than a hand-rolled runner —
 * switched from the latter because the intended caller (`apps/server`,
 * calling this once on startup — not yet wired up) can run as multiple
 * stateless nodes booting at once. Kysely's migrator serializes concurrent
 * callers through a `kysely_migration_lock` table so two nodes racing to
 * apply the same migration is safe (the hand-rolled version had no such
 * lock). Returns the filenames newly applied (empty on a no-op rerun). */
export async function runMigrations(db: Kysely<Database>): Promise<string[]> {
  const migrator = new Migrator({ db, provider: new SqlFileMigrationProvider() });
  const { error, results } = await migrator.migrateToLatest();

  if (error) throw error;

  return (results ?? [])
    .filter((result) => result.status === "Success")
    .map((result) => result.migrationName);
}
