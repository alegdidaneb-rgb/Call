/**
 * Centralised, validated environment configuration.
 *
 * The server refuses to boot in production with a missing or known-weak
 * JWT secret. Previously a hardcoded fallback secret was silently used,
 * which made every issued token forgeable by anyone who read the source.
 */

export type NodeEnv = "development" | "test" | "production";

export const NODE_ENV = (process.env.NODE_ENV || "development") as NodeEnv;
export const isProduction = NODE_ENV === "production";

export const PORT = Number.parseInt(process.env.PORT || "4000", 10);

/**
 * Postgres connection string, read here but validated on first connection.
 *
 * Validation is deferred to `requireDatabaseUrl()`, which the pool calls when it
 * first opens. Throwing at module load instead picks the wrong moment to fail on a
 * serverless platform: the runtime imports this module during instance
 * initialisation, so a throw surfaces as an opaque `INITIALIZATION_ERROR` 500 that
 * never says what is missing. Deferred, the same misconfiguration travels through
 * `schemaReady`, which `api/index.ts` already converts into a `503` naming the
 * cause. The long-lived server is unaffected — it awaits the schema before it
 * listens, so this still stops the process at boot.
 *
 * There is deliberately no default value. The SQLite store this replaced created a
 * file wherever it was pointed, so a typo in the environment produced a *working*
 * server full of empty tables rather than an error anyone would notice.
 */
export const DATABASE_URL = process.env.DATABASE_URL?.trim() ?? "";

/** Returns the connection string, or throws with an actionable message. */
export function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Point it at a Postgres database, e.g. " +
        "postgres://user:password@host:5432/dbname. There is no local-file fallback: " +
        "the previous SQLite store could not survive a serverless filesystem, and a " +
        "silent default produced an empty database instead of an error."
    );
  }
  if (!/^(postgres|postgresql):\/\//i.test(DATABASE_URL)) {
    throw new Error("DATABASE_URL must be a postgres:// or postgresql:// connection string");
  }
  return DATABASE_URL;
}

/** Secrets that appear in this project's history, docs or compose files. */
const KNOWN_WEAK_SECRETS = new Set([
  "cold-dialer-dev-secret-change-in-production",
  "change-me-in-production",
  "dev-secret-change-in-production",
  "changeme",
  "secret",
  "password",
]);

const MIN_SECRET_LENGTH = 32;

/**
 * Development-only fallback. Deliberately distinct from the historical value so
 * that a deployment still carrying the old string cannot silently reuse it.
 * Never reachable when NODE_ENV=production.
 */
const DEV_FALLBACK_SECRET = "cold-dialer-INSECURE-LOCAL-DEV-ONLY-do-not-ship";

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (secret) {
    if (secret.length < MIN_SECRET_LENGTH) {
      if (isProduction) {
        throw new Error(
          `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production (got ${secret.length}).`
        );
      }
      console.warn(
        `[config] JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters. Acceptable for local development only.`
      );
      return secret;
    }
    if (KNOWN_WEAK_SECRETS.has(secret.toLowerCase())) {
      if (isProduction) {
        throw new Error(
          "JWT_SECRET is set to a value published in this repository's history. Generate a new one, e.g. `openssl rand -hex 32`."
        );
      }
      console.warn("[config] JWT_SECRET is a known published value. Local development only.");
    }
    return secret;
  }

  if (isProduction) {
    throw new Error(
      "JWT_SECRET is required in production and no safe default exists. " +
        "Generate one with `openssl rand -hex 32` and set it in the environment."
    );
  }

  console.warn(
    "[config] JWT_SECRET is not set. Using an insecure development-only secret. " +
      "Tokens issued now will not be accepted once a real secret is configured."
  );
  return DEV_FALLBACK_SECRET;
}

export const JWT_SECRET = resolveJwtSecret();
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

/**
 * Comma-separated list of allowed browser origins.
 *
 * `cors({ origin: true })` previously reflected *any* origin while also sending
 * `Access-Control-Allow-Credentials: true`, which lets any website make
 * credentialed cross-origin calls to this API.
 */
function resolveCorsOrigins(): string[] | "*" {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) {
    // No credentials are used by this API (bearer tokens in headers only), so
    // an open origin policy is acceptable for the public read case, but we keep
    // it explicit and logged rather than implicit.
    if (isProduction) {
      console.warn(
        "[config] CORS_ORIGINS is not set; allowing any origin. Set CORS_ORIGINS to your frontend URL(s) in production."
      );
    }
    return "*";
  }
  if (raw === "*") return "*";
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export const CORS_ORIGINS = resolveCorsOrigins();

/** Hard cap on rows accepted by POST /api/leads/import in a single request. */
export const MAX_IMPORT_ROWS = Number.parseInt(process.env.MAX_IMPORT_ROWS || "1000", 10);

/** Request body size limit for express.json(). */
export const BODY_LIMIT = process.env.BODY_LIMIT || "2mb";

export const BCRYPT_ROUNDS = Number.parseInt(process.env.BCRYPT_ROUNDS || "12", 10);
