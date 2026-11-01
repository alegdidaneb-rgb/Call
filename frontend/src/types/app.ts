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
}

const VALID_ROLES: AppRole[] = ["admin", "manager", "agent"];

/** Never trust a role string from the network without narrowing it. */
export function normaliseRole(value: unknown): AppRole {
  return VALID_ROLES.includes(value as AppRole) ? (value as AppRole) : "agent";
}
