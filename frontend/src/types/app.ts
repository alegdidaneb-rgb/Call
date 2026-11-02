export type AppRole = "admin" | "manager" | "agent";

/**
 * The signed-in user as the UI understands it.
 *
 * Deliberately not `@supabase/supabase-js`'s `User`: in self-hosted API mode the
 * user comes from the Express backend and has a different shape. `role` is
 * required so that route guards and navigation can rely on it.
 */
export interface AppUser {
  id: string;
  email: string | null;
  fullName: string | null;
  role: AppRole;
  /**
   * Whether an administrator has onboarded this account.
   *
   * Mirrors the database predicate `public.is_provisioned()`: a privileged role
   * is provisioned by definition, an `agent` only once `profiles.invited_by` is
   * set. An authenticated but unprovisioned account can read no data at all
   * under RLS, so the UI must show a "waiting for an administrator" screen
   * rather than empty tables that look like a successful load.
   */
  provisioned: boolean;
}

const VALID_ROLES: AppRole[] = ["admin", "manager", "agent"];

/** Never trust a role string from the network without narrowing it. */
export function normaliseRole(value: unknown): AppRole {
  return VALID_ROLES.includes(value as AppRole) ? (value as AppRole) : "agent";
}

/**
 * Client-side twin of `public.is_provisioned()`. Kept in one place so the UI and
 * the database cannot drift apart on what counts as an active account.
 */
export function isProvisioned(role: AppRole, invitedBy: unknown): boolean {
  return role === "admin" || role === "manager" || Boolean(invitedBy);
}
