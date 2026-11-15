/**
 * Username rules for the self-hosted API.
 *
 * The third copy of one rule: the client has `frontend/src/lib/username.ts` for
 * instant feedback, migration 005 has `public.reserved_usernames()` and the
 * `profiles_username_shape` constraint for the Supabase deployment, and this file
 * serves the SQLite deployment, which shares no code with either. Three copies is
 * a drift risk, so the split is deliberate: this one is authoritative for API
 * mode only, and it must reject at least everything the others reject — an
 * account this backend accepts must be creatable on a Supabase deployment too,
 * or the two modes disagree about who exists.
 *
 * If you change a rule, change all three.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

/** Lowercase letters, digits and `. _ -`, starting and ending alphanumeric. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/;

/** Must stay identical to `public.reserved_usernames()`. */
export const RESERVED_USERNAMES = [
  "admin",
  "administrator",
  "root",
  "system",
  "setup",
  "support",
  "help",
  "noreply",
  "no-reply",
  "postmaster",
  "webmaster",
  "abuse",
  "security",
  "everyone",
  "all",
  "null",
  "undefined",
  "unknown",
  "test",
  "guest",
];

/**
 * The domain this backend stores as an account's address.
 *
 * `profiles.email` is `NOT NULL UNIQUE` and predates usernames, so it stays as
 * the storage identity; nothing here ever mails it. Must match
 * `SYNTHETIC_EMAIL_DOMAIN` in the `admin-users` edge function, or the same
 * username would resolve to two different addresses depending on deployment
 * mode.
 */
export const SYNTHETIC_EMAIL_DOMAIN = "agents.cold-dialer.internal";

export function syntheticEmail(username: string): string {
  return `${normaliseUsername(username)}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/** How usernames are stored and compared: trimmed and lowercase. */
export function normaliseUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function isEmailLike(input: string): boolean {
  return input.includes("@");
}

/** The reason a username is not acceptable, or null when it is. */
export function usernameProblem(input: unknown): string | null {
  if (typeof input !== "string") return "A username is required";
  const value = normaliseUsername(input);
  if (!value) return "A username is required";
  if (value.length < USERNAME_MIN_LENGTH) {
    return `Username must be at least ${USERNAME_MIN_LENGTH} characters`;
  }
  if (value.length > USERNAME_MAX_LENGTH) {
    return `Username must be at most ${USERNAME_MAX_LENGTH} characters`;
  }
  if (isEmailLike(value)) return "Use a username, not an email address";
  if (!USERNAME_PATTERN.test(value)) {
    return "Username may contain lowercase letters, numbers and . _ - , and must start and end with a letter or number";
  }
  if (RESERVED_USERNAMES.includes(value)) return "That username is reserved";
  return null;
}

/**
 * A username derived from an address, for rows that predate usernames.
 *
 * Used only to backfill and to display. Never used to authenticate: the stored
 * `username` column is what login reads.
 */
export function usernameFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  let local = email.split("@")[0]?.trim().toLowerCase() ?? "";
  local = local.replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+|[._-]+$/g, "");
  if (local.length < USERNAME_MIN_LENGTH || RESERVED_USERNAMES.includes(local)) {
    local = "user";
  }
  return local.slice(0, USERNAME_MAX_LENGTH);
}
