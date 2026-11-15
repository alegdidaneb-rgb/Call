/**
 * What a username may be.
 *
 * This is the client half of a rule the database also enforces, in
 * `public.reserved_usernames()` and the `profiles_username_shape` check
 * constraint from migration 005, and again in the `admin-users` edge function.
 * Three copies is a drift risk, so the split is deliberate and narrow: this file
 * exists only to tell somebody "that is not allowed" before they press a button.
 * The server is authoritative and its answer always wins — a username accepted
 * here and rejected there is a bug in this file, never a reason to relax the
 * server.
 *
 * If you change a rule, change all three.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

/**
 * Lowercase letters, digits and the separators `.`, `_` and `-`, starting and
 * ending alphanumeric. Matches the check constraint exactly.
 */
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
] as const;

/** Trim and lowercase, which is how the database stores and compares them. */
export function normaliseUsername(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * True when what was typed is an address rather than a username.
 *
 * Sign-in uses this to decide whether to resolve the value at all: an address is
 * already the identity Supabase Auth knows, so it is passed through untouched.
 * That is also what keeps accounts created before usernames existed working.
 */
export function isEmailLike(input: string): boolean {
  return input.includes("@");
}

/**
 * The reason a username is not acceptable, or null when it is.
 *
 * Messages are written to be shown verbatim next to the field, so each one says
 * what to do rather than which rule fired.
 */
export function usernameProblem(input: string): string | null {
  const value = normaliseUsername(input);

  if (!value) return "Choose a username";
  if (value.length < USERNAME_MIN_LENGTH) {
    return `Use at least ${USERNAME_MIN_LENGTH} characters`;
  }
  if (value.length > USERNAME_MAX_LENGTH) {
    return `Use at most ${USERNAME_MAX_LENGTH} characters`;
  }
  if (isEmailLike(value)) {
    return "That is an email address — use the part before the @, or a name of your own";
  }
  if (!USERNAME_PATTERN.test(value)) {
    return "Lowercase letters, numbers and . _ - only, starting and ending with a letter or number";
  }
  if ((RESERVED_USERNAMES as readonly string[]).includes(value)) {
    return "That name is reserved — choose another";
  }

  return null;
}

/**
 * The username part of an address, for showing an account that predates
 * usernames. Never used to sign in.
 */
export function usernameFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const local = email.split("@")[0]?.trim().toLowerCase();
  return local || null;
}
