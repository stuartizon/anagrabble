import { sql, type RawBuilder } from "kysely";

/** node-postgres auto-serializes plain JS objects passed as query params,
 * but not arrays (it treats a JS array as a Postgres array literal instead)
 * — so a jsonb column holding an array (e.g. word_plays.used_words) needs an
 * explicit stringify + cast. Safe to use on object-shaped jsonb columns too;
 * kept explicit everywhere a jsonb column is written so the serialization
 * doesn't depend on the value's shape. */
export function jsonbValue<T>(value: T): RawBuilder<T> {
  return sql`${JSON.stringify(value)}::jsonb`;
}
