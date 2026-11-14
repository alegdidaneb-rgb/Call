import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const NOT_CONFIGURED_MESSAGE =
  "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, " +
  "or set VITE_API_URL to use the self-hosted backend.";

/**
 * Stand-in used when Supabase is not configured.
 *
 * Every data query is fully chainable (`.select().eq().order().single()`) and
 * resolves to a real `error`, instead of the previous mock which only supported
 * two fixed call chains and threw a TypeError on anything else. Surfacing an
 * error means a misconfigured deployment shows a message rather than silently
 * rendering empty tables that look like a successful load.
 */
function createUnconfiguredBuilder(): any {
  const resolved = { data: null, error: { message: NOT_CONFIGURED_MESSAGE }, count: 0 };

  const chain: any = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") return (onFulfilled: (v: unknown) => unknown) => onFulfilled(resolved);
      if (prop === "data") return resolved.data;
      if (prop === "error") return resolved.error;
      if (prop === "count") return resolved.count;
      return chain;
    },
    apply() {
      return chain;
    },
  });

  return chain;
}

const noopSubscription = {
  data: { subscription: { unsubscribe: () => {} } },
};

const unconfiguredClient = {
  from: (_table: string) => createUnconfiguredBuilder(),
  channel: (_name: string) => ({
    on: () => ({ subscribe: () => {} }),
    subscribe: () => {},
    unsubscribe: () => {},
    send: () => {},
  }),
  removeChannel: async () => {},
  // Edge functions are how an administrator provisions accounts; the stub keeps
  // a misconfigured deployment reporting the same message instead of throwing a
  // TypeError on `.functions.invoke`.
  functions: {
    invoke: async (_fn: string, _opts?: unknown) => ({
      data: null,
      error: { message: NOT_CONFIGURED_MESSAGE },
    }),
  },
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: { message: NOT_CONFIGURED_MESSAGE } }),
    onAuthStateChange: (_cb: unknown) => noopSubscription,
    signInWithPassword: async () => ({
      data: { user: null, session: null },
      error: { message: NOT_CONFIGURED_MESSAGE },
    }),
    signOut: async () => ({ error: null }),
  },
  isConfigured: false,
};

/**
 * Typed as a real SupabaseClient in both branches so that call sites keep full
 * type inference instead of collapsing to `any`.
 */
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : (unconfiguredClient as unknown as SupabaseClient);

// Preserve the runtime flag the rest of the app checks for.
if (isSupabaseConfigured) {
  (supabase as unknown as Record<string, unknown>).isConfigured = true;
} else if (import.meta.env.PROD) {
  console.error(`[supabase] ${NOT_CONFIGURED_MESSAGE}`);
} else {
  console.warn(`[supabase] ${NOT_CONFIGURED_MESSAGE}`);
}
