import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { api, setAuthToken } from "@/lib/apiClient";
import { isProvisioned, normaliseRole, type AppRole, type AppUser } from "@/types/app";

const API_URL = import.meta.env.VITE_API_URL || "";
export const isApiMode = Boolean(API_URL);

/**
 * A dev-only stand-in user. It must never be reachable from a production build:
 * previously `AuthProvider` substituted it whenever no session existed, which
 * meant the login screen could be bypassed entirely in production.
 */
const DEV_USER: AppUser = {
  id: "dev-user-001",
  email: "dev@example.com",
  fullName: "Dev User",
  role: "admin",
  provisioned: true,
};

export function devFallbackUser(): AppUser | null {
  return import.meta.env.DEV ? DEV_USER : null;
}

/**
 * The edge function that provisions accounts.
 *
 * Creating a user needs the service role key, which cannot ship to the browser,
 * so every write goes through this function. There is deliberately no `signUp`
 * here any more: public self-registration has been removed, and an account can
 * only come into existence because an administrator created it.
 */
const USERS_FUNCTION = "admin-users";

export interface NewUserInput {
  email: string;
  password: string;
  fullName: string;
  role: AppRole;
}

export interface TeamMember {
  id: string;
  email: string | null;
  fullName: string | null;
  role: AppRole;
  provisioned: boolean;
  createdAt: string | null;
}

/**
 * Unwraps an edge function failure into a message worth showing.
 *
 * `functions.invoke` reports non-2xx responses as a `FunctionsHttpError` whose
 * `context` holds the real `Response`, so without this the UI would display
 * "Edge Function returned a non-200 status code" instead of the reason.
 */
async function invokeUsersFunction(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke(USERS_FUNCTION, { body });
  if (error) {
    let message = error.message || "Request failed";
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const parsed = (await context.json()) as { error?: string };
        if (parsed?.error) message = parsed.error;
      } catch {
        // Body was not JSON; keep the transport-level message.
      }
    }
    throw new Error(message);
  }
  return data;
}

/** True while the deployment has no administrator and setup is still possible. */
export async function fetchSetupStatus(): Promise<{ needsSetup: boolean }> {
  if (isApiMode) {
    return api.auth.status();
  }
  try {
    const data = await invokeUsersFunction({ action: "status" });
    return { needsSetup: Boolean(data?.needsSetup) };
  } catch {
    // A failed status check must not lock the user out of the sign-in form.
    return { needsSetup: false };
  }
}

/**
 * Creates the very first administrator of an empty deployment.
 *
 * Rejected by the server once any account exists, so it cannot be used to mint
 * additional administrators after setup.
 */
export async function bootstrapFirstAdmin(
  input: Omit<NewUserInput, "role">
): Promise<AppUser> {
  if (isApiMode) {
    const { user } = await api.auth.bootstrap(input.email, input.password, input.fullName);
    return toAppUser(user);
  }
  const data = await invokeUsersFunction({ action: "bootstrap", ...input });
  return toAppUser(data?.user);
}

/** Administrator-only account creation. */
export async function createUser(input: NewUserInput): Promise<AppUser> {
  if (isApiMode) {
    const { user } = await api.users.create(input);
    return toAppUser(user);
  }
  const data = await invokeUsersFunction({ action: "create", ...input });
  return toAppUser(data?.user);
}

/** Everyone an administrator may see. RLS restricts this to admins. */
export async function listTeamMembers(): Promise<TeamMember[]> {
  if (isApiMode) {
    const rows = await api.users.list();
    return (rows ?? []).map(toTeamMember);
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, invited_by, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toTeamMember);
}

export async function signIn(email: string, password: string): Promise<AppUser> {
  if (isApiMode) {
    const { user, token } = await api.auth.login(email, password);
    setAuthToken(token);
    return toAppUser(user);
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error("Sign in did not return a user");
  return toAppUser(await fetchSupabaseProfile(data.user.id, data.user.email));
}

export async function signOut(): Promise<void> {
  if (isApiMode) {
    setAuthToken(null);
    return;
  }
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Resolves the current user, or null when there is no valid session. */
export async function getCurrentUser(): Promise<AppUser | null> {
  if (isApiMode) {
    if (!localStorage.getItem("cold-dialer-token")) return null;
    try {
      return toAppUser(await api.auth.me());
    } catch {
      // Token is missing, expired or rejected: clear it so the UI can redirect.
      setAuthToken(null);
      return null;
    }
  }

  if (!isSupabaseConfigured) return devFallbackUser();

  const { data } = await supabase.auth.getSession();
  const sessionUser = data.session?.user;
  if (!sessionUser) return devFallbackUser();
  return toAppUser(await fetchSupabaseProfile(sessionUser.id, sessionUser.email));
}

/**
 * `role` and `invited_by` live in the `profiles` table, not in the Supabase auth
 * user, so they have to be read separately. A failure to read them degrades to
 * the least privileged state -- an unprovisioned agent -- rather than to admin.
 */
async function fetchSupabaseProfile(
  userId: string,
  email: string | null | undefined
): Promise<Partial<AppUser> & { id: string }> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, invited_by")
      .eq("id", userId)
      .single();
    if (error || !data) throw error ?? new Error("No profile row");
    const role = normaliseRole(data.role);
    return {
      id: data.id ?? userId,
      email: data.email ?? email ?? null,
      fullName: data.full_name ?? null,
      role,
      provisioned: isProvisioned(role, data.invited_by),
    };
  } catch {
    return { id: userId, email: email ?? null, fullName: null, role: "agent", provisioned: false };
  }
}

function toAppUser(raw: unknown): AppUser {
  const value = (raw ?? {}) as Record<string, unknown>;
  const metadata = (value.user_metadata ?? {}) as Record<string, unknown>;
  const role = normaliseRole(value.role);
  const provisioned =
    typeof value.provisioned === "boolean"
      ? value.provisioned
      : isProvisioned(role, value.invited_by ?? value.invitedBy);
  return {
    id: String(value.id ?? ""),
    email: (value.email as string | null) ?? null,
    fullName:
      (value.fullName as string | null) ??
      (value.full_name as string | null) ??
      (metadata.full_name as string | null) ??
      null,
    role,
    provisioned,
  };
}

function toTeamMember(raw: unknown): TeamMember {
  const value = (raw ?? {}) as Record<string, unknown>;
  const role = normaliseRole(value.role);
  return {
    id: String(value.id ?? ""),
    email: (value.email as string | null) ?? null,
    fullName:
      (value.fullName as string | null) ?? (value.full_name as string | null) ?? null,
    role,
    provisioned:
      typeof value.provisioned === "boolean"
        ? value.provisioned
        : isProvisioned(role, value.invited_by ?? value.invitedBy),
    createdAt: (value.createdAt as string | null) ?? (value.created_at as string | null) ?? null,
  };
}

export function onAuthStateChange(callback: (user: AppUser | null) => void) {
  if (isApiMode) {
    // API mode has no push-based session events; callers re-fetch on navigation.
    return { data: { subscription: { unsubscribe: () => {} } } };
  }
  return supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
    const sessionUser = session?.user;
    if (!sessionUser) {
      callback(devFallbackUser());
      return;
    }
    void fetchSupabaseProfile(sessionUser.id, sessionUser.email).then((profile) =>
      callback(toAppUser(profile))
    );
  });
}
