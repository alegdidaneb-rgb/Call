import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, isApiMode } from "@/lib/apiClient";
import { isProvisioned, normaliseRole, type AppRole } from "@/types/app";
import { supabase } from "@/lib/supabase";
import {
  SIP_PROVIDERS,
  envSipAccount,
  isUsableAccount,
  normaliseSipUri,
  resolveStunUrls,
  type SipAccount,
  type SipProvider,
} from "@/sip/config";
import { sipEngine, type SipEngineSnapshot } from "@/sip/engine";
import type { Database } from "@/types/database";

type SipAccountRow = Database["public"]["Tables"]["sip_accounts"]["Row"];

/**
 * Someone a trunk can be assigned to.
 *
 * The two deployment modes return different field names for the same person:
 * Supabase gives a `profiles` row with `full_name`, the Express API gives the
 * public user shape with `fullName`. This hook used to declare the Supabase type
 * and cast the API response into it, so in API mode `full_name` was always
 * undefined and the assignment dropdown quietly showed email addresses instead
 * of names. Normalising here means neither caller can be wrong.
 */
export interface AssignablePerson {
  id: string;
  /** What the trunk-assignment dropdown shows; `email` is only a last resort. */
  username: string | null;
  email: string | null;
  fullName: string | null;
  role: AppRole;
  /**
   * Whether an administrator has onboarded this account. An unprovisioned agent
   * can read no data under RLS, so assigning a trunk to one is a no-op and the
   * Administration page reports it.
   */
  provisioned: boolean;
}

export interface SipAccountPayload {
  label: string | null;
  provider: SipProvider;
  sip_uri: string;
  password: string;
  ws_url: string;
  caller_id: string | null;
  stun_urls: string[];
  turn_urls: string[];
  turn_username: string | null;
  turn_credential: string | null;
  register_expiry: number;
  user_id: string | null;
  enabled: boolean;
}

function normaliseProvider(value: unknown): SipProvider {
  return SIP_PROVIDERS.includes(value as SipProvider) ? (value as SipProvider) : "custom";
}

/** Never trust a provider string or URI from the network without narrowing it. */
function rowToAccount(row: SipAccountRow): SipAccount | null {
  const sipUri = normaliseSipUri(row.sip_uri ?? "");
  const password = (row.password ?? "").trim();
  const wsUrl = (row.ws_url ?? "").trim();
  if (!sipUri || !password || !wsUrl) return null;

  const provider = normaliseProvider(row.provider);
  return {
    source: "database",
    id: row.id,
    label: row.label ?? undefined,
    provider,
    sipUri,
    password,
    wsUrl,
    callerId: row.caller_id ?? undefined,
    stunUrls: resolveStunUrls(provider, row.stun_urls),
    // Absent rather than defaulted: unlike STUN, there is no public TURN relay to
    // fall back to, so an account without one simply has no relay.
    turnUrls: (row.turn_urls ?? []).filter(Boolean),
    turnUsername: (row.turn_username ?? "").trim() || undefined,
    turnCredential: (row.turn_credential ?? "").trim() || undefined,
    registerExpiry: row.register_expiry ?? 600,
    isTrunkDefault: row.user_id === null,
  };
}

/**
 * The credentials this agent should dial with.
 *
 * Row-level security already limits the result to the signed-in agent's own
 * account plus the shared trunk default, so this only has to pick between them:
 * a personal extension wins, because it is the one the provider can block or
 * bill individually. Build-time `VITE_SIP_*` variables remain as a fallback so
 * deployments configured that way keep working.
 */
export function useSipAccount(): {
  account: SipAccount | null;
  isLoading: boolean;
  isUnusable: boolean;
} {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["sip-account", user?.id ?? "none"],
    enabled: Boolean(user?.provisioned),
    staleTime: 60_000,
    queryFn: async (): Promise<SipAccount | null> => {
      if (isApiMode) {
        const row = await api.sipAccounts.effective();
        if (!row) return envSipAccount();
        return rowToAccount(row as SipAccountRow) ?? envSipAccount();
      }

      const { data, error } = await supabase
        .from("sip_accounts")
        .select("*")
        .eq("enabled", true);

      if (error) {
        // A missing migration or a denied read must not be reported as "no
        // credentials", or an administrator would have no way to tell why the
        // phone is silent. Fall through to the environment so existing
        // deployments keep working.
        console.warn(`[sip] could not read sip_accounts: ${error.message}`);
      }

      const rows = (data ?? []) as SipAccountRow[];
      const chosen = rows.find((row) => row.user_id === user?.id) ?? rows.find((row) => row.user_id === null);
      if (chosen) {
        const account = rowToAccount(chosen);
        if (account) return account;
        console.warn("[sip] the stored SIP account is incomplete and was ignored");
      }
      return envSipAccount();
    },
  });

  const account = query.data ?? null;
  return {
    account,
    isLoading: query.isLoading,
    // Present but not usable is a different situation from absent: it means
    // somebody saved something malformed, and that is worth saying out loud.
    isUnusable: Boolean(account) && !isUsableAccount(account),
  };
}

/** Live view of the softphone, shared by every component that renders it. */
export function useSipEngineSnapshot(): SipEngineSnapshot {
  const [snapshot, setSnapshot] = useState<SipEngineSnapshot>(() => sipEngine.current);
  useEffect(() => sipEngine.subscribe(setSnapshot), []);
  return snapshot;
}

/**
 * Register once for the whole session, at app-shell level.
 *
 * Registration belongs to the shell rather than to the lead page: an agent must
 * stay registered while moving between leads, or inbound calls ring only on
 * whichever page happens to be open.
 */
export function useSipBootstrap(): SipEngineSnapshot {
  const { user } = useAuth();
  const { account, isLoading } = useSipAccount();
  const snapshot = useSipEngineSnapshot();

  useEffect(() => {
    if (isLoading) return;
    void sipEngine.configure(account).catch((error: unknown) => {
      // The failure is already in the engine snapshot and rendered in the UI;
      // this is for whoever opens the console first.
      console.warn("[sip] could not connect:", error);
    });
  }, [account, isLoading]);

  // Drop the registration when the user signs out or the shell unmounts, so a
  // shared workstation does not keep ringing for the previous agent.
  useEffect(() => {
    return () => {
      void sipEngine.disconnect();
    };
  }, [user?.id]);

  return snapshot;
}

/**
 * Administrator CRUD over SIP accounts, in whichever mode the app is running.
 *
 * Both deployment paths are served from one hook so the settings page cannot
 * drift between them: the Supabase path relies on row-level security allowing
 * writes only to `profiles.role = 'admin'`, and the API path on
 * `requireRole("admin")`.
 */
export function useSipAccountsAdmin() {
  const queryClient = useQueryClient();

  const accounts = useQuery({
    queryKey: ["sip-accounts"],
    queryFn: async (): Promise<SipAccountRow[]> => {
      if (isApiMode) return (await api.sipAccounts.list()) as SipAccountRow[];
      const { data, error } = await supabase
        .from("sip_accounts")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SipAccountRow[];
    },
  });

  const profiles = useQuery({
    queryKey: ["profiles-for-assignment"],
    queryFn: async (): Promise<AssignablePerson[]> => {
      if (isApiMode) {
        const users = await api.users.list();
        return users.map((user) => ({
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          provisioned: user.provisioned,
        }));
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, email, full_name, role, invited_by");
      if (error) throw error;
      return (data ?? []).map((row) => {
        const role = normaliseRole(row.role);
        return {
          id: row.id,
          username: row.username,
          email: row.email,
          fullName: row.full_name,
          role,
          provisioned: isProvisioned(role, row.invited_by),
        };
      });
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["sip-accounts"] });
    // Invalidating the effective-account query makes every open softphone
    // reconnect with the new credentials instead of waiting for a page reload.
    void queryClient.invalidateQueries({ queryKey: ["sip-account"] });
  };

  const save = useMutation({
    mutationFn: async ({ id, payload }: { id: string | null; payload: SipAccountPayload }) => {
      if (isApiMode) {
        return id ? api.sipAccounts.update(id, payload) : api.sipAccounts.create(payload);
      }
      const { data, error } = id
        ? await supabase.from("sip_accounts").update(payload).eq("id", id).select().single()
        : await supabase.from("sip_accounts").insert(payload).select().single();
      if (error) throw error;
      return data as SipAccountRow;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (isApiMode) {
        await api.sipAccounts.delete(id);
        return;
      }
      const { error } = await supabase.from("sip_accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { accounts, profiles, save, remove };
}

/**
 * A clock that only ticks while it is needed.
 *
 * Duration is derived from the answer timestamp rather than counted up by an
 * interval, so it survives a muted or held call and cannot drift.
 */
export function useNowMs(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
