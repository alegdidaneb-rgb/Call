/**
 * Postgres connection pool, and the query facade the rest of the backend uses.
 *
 * This replaced `better-sqlite3`. Two reasons, and only the first is about
 * hosting: a native module with no prebuilt binary for the platform's Node
 * version fails `npm install` outright (that was `gyp_error` on every Vercel
 * build of this project), and a SQLite file cannot survive serverless anyway —
 * the filesystem is read-only outside `/tmp`, and `/tmp` is ephemeral and
 * per-instance, so every cold start would begin with an empty database.
 *
 * THE FACADE IS ASYNC, AND THAT IS THE POINT.
 *
 * `prepare(sql)` still returns an object with `get` / `all` / `run`, so porting a
 * call site means adding `await` and nothing else — no restructuring of the
 * routes. But the return types are now `Promise`, which is what makes the port
 * checkable: `tsc` rejects `row.id` on an un-awaited result. It does NOT catch
 * every mistake, because `if (!row)` on a Promise is silently always false and
 * type-checks fine. Every boolean test on a query result was reviewed by hand for
 * exactly that reason.
 *
 * Placeholders stay `?` in the SQL and are translated to `$1..$n` here, so the
 * queries in the routes read the same as they did.
 */

import pg from "pg";
import { requireDatabaseUrl } from "../config/env.js";
import { toPostgres } from "./sql.js";

// Re-exported so existing imports of `toPostgres` from this module keep working;
// the implementation lives in ./sql.js, which has no side effects.
export { toPostgres } from "./sql.js";

const { Pool, types } = pg;

/**
 * Return timestamps as ISO 8601 strings and counts as numbers.
 *
 * `pg` hands back `Date` objects for `timestamptz` and *strings* for `int8`.
 * Both would silently change the API: the client does `new Date(row.created_at)`
 * and the routes compare `row.n === 0`. Parsing here keeps the response shape
 * this API has always had, in one place, instead of at eighty call sites.
 */
const OID_TIMESTAMP = 1114;
const OID_TIMESTAMPTZ = 1184;
const OID_INT8 = 20;

types.setTypeParser(OID_TIMESTAMP, (value) => new Date(value).toISOString());
types.setTypeParser(OID_TIMESTAMPTZ, (value) => new Date(value).toISOString());
types.setTypeParser(OID_INT8, (value) => Number.parseInt(value, 10));

/**
 * `require` (the default) verifies the server certificate. `no-verify` accepts an
 * encrypted but unverified connection, for a self-hosted Postgres with a private
 * CA. `disable` turns TLS off and should only ever be used against a database on
 * the same machine.
 */
const SSL_MODE = process.env.PGSSLMODE ?? "require";
const SSL =
  SSL_MODE === "disable" ? false : { rejectUnauthorized: SSL_MODE !== "no-verify" };

/**
 * Deliberately small. On serverless each instance is short-lived and there can be
 * many of them, so a large per-instance pool multiplies into connection
 * exhaustion at the database — the failure mode is every instance waiting on a
 * connection rather than one slow query.
 */
/**
 * The pool, opened on first use rather than at import.
 *
 * Constructing it at module scope attaches the failure to the wrong moment. On a
 * serverless platform the module is imported during instance initialisation, so a
 * bad `DATABASE_URL` would crash the instance before any request arrived and the
 * caller would see an opaque 500. Created lazily, the same misconfiguration
 * surfaces through `schemaReady`, which `api/index.ts` already turns into a `503`
 * that names the cause.
 *
 * It also keeps this module importable with no database configured at all, which is
 * what lets `scripts/check-sql-placeholders.ts` analyse every SQL literal in the
 * codebase without credentials.
 */
let poolInstance: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!poolInstance) {
    poolInstance = new pg.Pool({
      connectionString: requireDatabaseUrl(),
      ssl: SSL,
      max: Number.parseInt(process.env.PGPOOL_MAX ?? "3", 10),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });

    poolInstance.on("error", (err) => {
      // An idle client failing must not take the process down; the next query gets
      // a fresh connection.
      console.error("[db] idle client error:", err.message);
    });
  }
  return poolInstance;
}

/**
 * Drains the pool on shutdown. Safe to call when it was never opened, which is what
 * happens if the process exits before its first query.
 */
export async function closePool(): Promise<void> {
  const instance = poolInstance;
  poolInstance = null;
  if (instance) await instance.end();
}

export interface RunResult {
  /** Rows affected. `better-sqlite3` called this `changes`. */
  changes: number;
}

export interface Statement {
  /** The first matching row, or undefined. */
  get<T = Record<string, unknown>>(...params: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(...params: unknown[]): Promise<T[]>;
  run(...params: unknown[]): Promise<RunResult>;
}

/**
 * The surface the routes use. Structurally the old `better-sqlite3` handle minus
 * the synchronous guarantees, which is why the port is mostly `await`.
 */
export interface Db {
  prepare(sql: string): Statement;
  /** Multiple statements, no parameters. Used for DDL. */
  exec(sql: string): Promise<void>;
}

function statementFor(
  run: (sql: string, params: unknown[]) => Promise<pg.QueryResult>,
  sql: string,
): Statement {
  const text = toPostgres(sql);
  return {
    async get<T>(...params: unknown[]): Promise<T | undefined> {
      const result = await run(text, params);
      return (result.rows[0] as T) ?? undefined;
    },
    async all<T>(...params: unknown[]): Promise<T[]> {
      const result = await run(text, params);
      return result.rows as T[];
    },
    async run(...params: unknown[]): Promise<RunResult> {
      const result = await run(text, params);
      return { changes: result.rowCount ?? 0 };
    },
  };
}

/** The pool-backed handle, used for everything outside a transaction. */
export const db: Db = {
  prepare: (sql) =>
    statementFor((text, params) => getPool().query(text, params as unknown[]), sql),
  exec: async (sql) => {
    await getPool().query(sql);
  },
};

/**
 * Run `fn` against a single connection, committing on success and rolling back on
 * any throw.
 *
 * `better-sqlite3`'s `transaction()` wrapped a synchronous function; this takes an
 * async one, which is why the two call sites in the routes changed shape rather
 * than just gaining an `await`. A transaction must pin one client — running its
 * statements across a pool would interleave them with other requests.
 */
export async function withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const tx: Db = {
      prepare: (sql) =>
        statementFor((text, params) => client.query(text, params as unknown[]), sql),
      exec: async (sql) => {
        await client.query(sql);
      },
    };
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
