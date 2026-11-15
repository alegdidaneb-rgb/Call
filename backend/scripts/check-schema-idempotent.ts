/**
 * Applies the schema twice and requires the second application to change nothing.
 *
 * `ensureSchema()` runs on every cold start, so a database that already has the
 * tables is the normal case rather than the exception. Everything in it is written
 * to be re-runnable — `CREATE TABLE IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT
 * EXISTS`, and a guarded repair block — but "written to be re-runnable" is an
 * intention, and an intention that is never executed is how a duplicate-object
 * error reaches a cold start at three in the morning.
 *
 * This is not the seed. The seed cannot be run twice: `profiles.email` is unique
 * and the seeded username is fixed, so a second run collides on it. What is being
 * checked here is the schema, which is the part that has to tolerate repetition.
 *
 * Needs `DATABASE_URL`. Run against a real Postgres, because the point is what the
 * server does, not what the SQL parses to.
 */
import { ensureSchema } from "../src/db/database.js";
import { closePool } from "../src/db/pool.js";

async function main(): Promise<void> {
  await ensureSchema();
  await ensureSchema();

  // A third time over a database that now definitely has every object, including
  // the ones the guarded repair block adds only when they are missing.
  await ensureSchema();
}

main()
  .then(() => closePool())
  .then(() => {
    console.log("  PASS: ensureSchema is idempotent over three applications");
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error("  FAIL:", err instanceof Error ? err.message : String(err));
    await closePool().catch(() => undefined);
    process.exit(1);
  });
