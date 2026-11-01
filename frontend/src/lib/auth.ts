import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { api, setAuthToken } from "@/lib/apiClient";
import { normaliseRole, type AppUser } from "@/types/app";

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
};

export function devFallbackUser(): AppUser | null {
  return import.meta.env.DEV ? DEV_USER : null;
}

export interface SignUpResult {
  user: AppUser;
  /**
   * True when Supabase requires email confirmation before the account can sign
   * in. The caller must tell the user to check their inbox rather than sending
   * them to a login form that will reject them.
   */
  needsConfirmation: boolean;
}

export async function signUp(
  email: string,
  password: string,
  fullName: string
): Promise<SignUpResult> {
  if (isApiMode) {
    const { user, token } = await api.auth.signup(email, password, fullName);
    setAuthToken(token);
    return { user: toAppUser(user), needsConfirmation: false };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      /**
       * This Supabase project is shared, and its `site_url` belongs to another
       * application. Pinning the redirect here means confirmation emails return
       * to *this* deployment instead of that app's domain. The origin must be
       * listed in Supabase Auth → URL Configuration → Redirect URLs.
       */
      emailRedirectTo: typeof window === "undefined" ? undefined : window.location.origin,
    },
  });
  if (error) throw error;
  if (!data.user) throw new Error("Sign up did not return a user");

  const profile = await fetchSupabaseProfile(data.user.id, data.user.email);
  return { user: toAppUser(profile), needsConfirmation: !data.session };
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
 * `role` lives in the `profiles` table, not in the Supabase auth user, so it has
 * to be read separately. A failure to read it degrades to the least privileged
 * role rather than to admin.
 */
async function fetchSupabaseProfile(
  userId: string,
  email: string | null | undefined
): Promise<Partial<AppUser> & { id: string }> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, role")
      .eq("id", userId)
      .single();
    if (error || !data) throw error ?? new Error("No profile row");
    return {
      id: data.id ?? userId,
      email: data.email ?? email ?? null,
      fullName: data.full_name ?? null,
      role: normaliseRole(data.role),
    };
  } catch {
    return { id: userId, email: email ?? null, fullName: null, role: "agent" };
  }
}

function toAppUser(raw: unknown): AppUser {
  const value = (raw ?? {}) as Record<string, unknown>;
  const metadata = (value.user_metadata ?? {}) as Record<string, unknown>;
  return {
    id: String(value.id ?? ""),
    email: (value.email as string | null) ?? null,
    fullName:
      (value.fullName as string | null) ??
      (value.full_name as string | null) ??
      (metadata.full_name as string | null) ??
      null,
    role: normaliseRole(value.role),
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
