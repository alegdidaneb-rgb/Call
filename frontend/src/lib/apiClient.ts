import type { AppUser } from "@/types/app";
import type { Database } from "@/types/database";

/**
 * The self-hosted API client.
 *
 * Every one of these methods used to be typed `any`, in 32 places. That is not a
 * cosmetic problem: `any` at the boundary is what let two real defects survive.
 * `users.list()` was annotated as a profile row while the server has always
 * returned `fullName`, not `full_name`, so the trunk-assignment dropdown in
 * Phone settings silently fell back to showing email addresses; and
 * `leads.import()` was declared to take only `rows` when the server also accepts
 * a `campaign_id`, so an import through this path could never be attributed to a
 * campaign. Both are visible the moment the return types describe the server
 * instead of describing what the caller hoped for.
 *
 * The types below are derived from `types/database.ts` — the same file the
 * Supabase path is checked against — so the two deployment modes cannot drift
 * apart silently again.
 */

type Tables = Database["public"]["Tables"];

export type LeadRow = Tables["leads"]["Row"];
export type LeadInsert = Tables["leads"]["Insert"];
export type LeadUpdate = Tables["leads"]["Update"];

export type CampaignRow = Tables["campaigns"]["Row"];
export type CampaignInsert = Tables["campaigns"]["Insert"];
export type CampaignUpdate = Tables["campaigns"]["Update"];

export type CallLogRow = Tables["call_logs"]["Row"];
export type CallLogInsert = Tables["call_logs"]["Insert"];

export type ScriptRow = Tables["call_scripts"]["Row"];
export type ScriptInsert = Tables["call_scripts"]["Insert"];
export type ScriptUpdate = Tables["call_scripts"]["Update"];

export type SipAccountRow = Tables["sip_accounts"]["Row"];
export type SipAccountInsert = Tables["sip_accounts"]["Insert"];
export type SipAccountUpdate = Tables["sip_accounts"]["Update"];

/** One rejected row of a bulk import, as the server reports it. */
export interface ImportError {
  /** 1-based position in the submitted array, so it matches the CSV line. */
  row: number;
  reason: string;
}

export interface ImportResult {
  imported: number;
  failed: number;
  total: number;
  /** The server caps this at the first 20 failures. */
  errors: ImportError[];
}

/**
 * What a bulk import may contain. Deliberately narrower than `LeadInsert`: the
 * server ignores `id`, timestamps and ownership, and rejecting them here stops a
 * caller from believing it set something it did not.
 */
export type LeadImportRow = Omit<
  LeadInsert,
  "id" | "created_at" | "updated_at" | "user_id" | "created_by" | "campaign_id"
>;

export const API_URL: string = import.meta.env.VITE_API_URL ?? "";

/**
 * True when the app talks to the Express backend instead of Supabase directly.
 *
 * Exported so the hooks that branch on it read one definition rather than
 * re-deriving the environment variable, which is how the two paths drift.
 */
export const isApiMode: boolean = Boolean(API_URL);

/**
 * Where the session token lives when running against the backend.
 *
 * `localStorage` is a deliberate, documented trade-off rather than an oversight:
 * it survives a reload without a refresh-token flow the backend does not
 * implement. It is readable by any script on the origin, so this is only
 * acceptable on a deployment with no third-party scripts. Supabase mode keeps
 * its own session handling and does not use this key.
 */
const TOKEN_KEY = "cold-dialer-token";

let authToken: string | null = localStorage.getItem(TOKEN_KEY);

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

/** A failure carrying the HTTP status, so callers can tell 409 from 500. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => null)) as { error?: unknown } | null;
    const message =
      typeof body?.error === "string" && body.error
        ? body.error
        : `Request failed: ${response.status}`;
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

function remove(path: string): Promise<void> {
  return request<void>(path, { method: "DELETE" });
}

/**
 * What an administrator supplies to create an account.
 *
 * No email: the server derives the Supabase Auth identity from `username`, so
 * the two deployment modes cannot disagree about the synthetic domain.
 */
export interface NewUserInput {
  username: string;
  password: string;
  fullName: string;
  role: AppUser["role"];
}

export const api = {
  auth: {
    /** Whether the deployment still needs its first administrator. */
    status: () => request<{ needsSetup: boolean }>("/api/auth/status"),
    /**
     * First-run bootstrap; the server refuses once any account exists. No token
     * comes back — the new administrator signs in through the normal path.
     */
    bootstrap: (username: string, password: string, fullName: string) =>
      post<{ user: AppUser }>("/api/auth/bootstrap", { username, password, fullName }),
    /**
     * `identifier` is a username, or an address for an account that predates
     * usernames. The server resolves it.
     */
    login: (identifier: string, password: string) =>
      post<{ user: AppUser; token: string }>("/api/auth/login", { identifier, password }),
    me: () => request<AppUser>("/api/auth/me"),
  },

  /** Administrator-only account management. */
  users: {
    /**
     * The server returns the public user shape (`fullName`), not a `profiles`
     * row (`full_name`). Anything displaying these has to use this spelling.
     */
    list: () => request<AppUser[]>("/api/users"),
    create: (data: NewUserInput) => post<{ user: AppUser }>("/api/users", data),
    /**
     * Sets a new password for somebody else.
     *
     * Not optional: a synthetic login address cannot receive mail, so there is no
     * self-service recovery. Without this a forgotten password is permanent.
     */
    resetPassword: (userId: string, password: string) =>
      post<{ user: AppUser }>(`/api/users/${userId}/password`, { password }),
  },

  leads: {
    list: () => request<LeadRow[]>("/api/leads"),
    get: (id: string) => request<LeadRow>(`/api/leads/${id}`),
    create: (data: LeadInsert) => post<LeadRow>("/api/leads", data),
    update: (id: string, data: LeadUpdate) => patch<LeadRow>(`/api/leads/${id}`, data),
    delete: (id: string) => remove(`/api/leads/${id}`),
    /**
     * `campaignId` is optional on the server; omitting it imports unattributed
     * leads, which then cannot be reported on per campaign.
     */
    import: (rows: LeadImportRow[], campaignId?: string | null) =>
      post<ImportResult>("/api/leads/import", { rows, campaign_id: campaignId ?? null }),
  },

  campaigns: {
    list: () => request<CampaignRow[]>("/api/campaigns"),
    get: (id: string) => request<CampaignRow>(`/api/campaigns/${id}`),
    create: (data: CampaignInsert) => post<CampaignRow>("/api/campaigns", data),
    update: (id: string, data: CampaignUpdate) =>
      patch<CampaignRow>(`/api/campaigns/${id}`, data),
    delete: (id: string) => remove(`/api/campaigns/${id}`),
  },

  callLogs: {
    list: () => request<CallLogRow[]>("/api/call-logs"),
    getByLead: (leadId: string) => request<CallLogRow[]>(`/api/call-logs/lead/${leadId}`),
    get: (id: string) => request<CallLogRow>(`/api/call-logs/${id}`),
    create: (data: CallLogInsert) => post<CallLogRow>("/api/call-logs", data),
    delete: (id: string) => remove(`/api/call-logs/${id}`),
  },

  sipAccounts: {
    /** The credentials this agent should register with, or null if none exist. */
    effective: () => request<SipAccountRow | null>("/api/sip-accounts/effective"),
    list: () => request<SipAccountRow[]>("/api/sip-accounts"),
    create: (data: SipAccountInsert) => post<SipAccountRow>("/api/sip-accounts", data),
    update: (id: string, data: SipAccountUpdate) =>
      patch<SipAccountRow>(`/api/sip-accounts/${id}`, data),
    delete: (id: string) => remove(`/api/sip-accounts/${id}`),
  },

  scripts: {
    list: () => request<ScriptRow[]>("/api/scripts"),
    get: (id: string) => request<ScriptRow>(`/api/scripts/${id}`),
    create: (data: ScriptInsert) => post<ScriptRow>("/api/scripts", data),
    update: (id: string, data: ScriptUpdate) => patch<ScriptRow>(`/api/scripts/${id}`, data),
    delete: (id: string) => remove(`/api/scripts/${id}`),
  },
};
