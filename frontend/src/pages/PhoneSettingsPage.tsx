import type { ReactNode } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Phone,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useSipAccountsAdmin, type SipAccountPayload } from "@/hooks/useSip";
import {
  SIP_PRESETS,
  SIP_PROVIDERS,
  deriveWsUrl,
  domainFromSipUri,
  isUsableAccount,
  normaliseSipUri,
  parseSipUri,
  type SipAccount,
  type SipProvider,
} from "@/sip/config";
import { testSipAccount } from "@/sip/engine";
import type { SipFailure } from "@/sip/engine";
import type { Database } from "@/types/database";

type SipAccountRow = Database["public"]["Tables"]["sip_accounts"]["Row"];

const EMPTY_FORM: FormState = {
  id: null,
  label: "",
  provider: "custom",
  sipUri: "",
  password: "",
  wsUrl: "",
  callerId: "",
  stunUrls: "",
  registerExpiry: 600,
  assignTo: "",
  enabled: true,
};

interface FormState {
  id: string | null;
  label: string;
  provider: SipProvider;
  sipUri: string;
  password: string;
  wsUrl: string;
  callerId: string;
  stunUrls: string;
  registerExpiry: number;
  /** Empty string means the shared trunk default. */
  assignTo: string;
  enabled: boolean;
}

function parseStunUrls(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function rowToForm(row: SipAccountRow): FormState {
  return {
    id: row.id,
    label: row.label ?? "",
    provider: (SIP_PROVIDERS.includes(row.provider) ? row.provider : "custom") as SipProvider,
    sipUri: row.sip_uri,
    password: row.password,
    wsUrl: row.ws_url,
    callerId: row.caller_id ?? "",
    stunUrls: (row.stun_urls ?? []).join("\n"),
    registerExpiry: row.register_expiry ?? 600,
    assignTo: row.user_id ?? "",
    enabled: row.enabled,
  };
}

function formToAccount(form: FormState): SipAccount {
  return {
    source: "database",
    id: form.id ?? undefined,
    label: form.label.trim() || undefined,
    provider: form.provider,
    sipUri: normaliseSipUri(form.sipUri) ?? "",
    password: form.password,
    wsUrl: form.wsUrl.trim(),
    callerId: form.callerId.trim() || undefined,
    stunUrls: parseStunUrls(form.stunUrls),
    registerExpiry: form.registerExpiry,
    isTrunkDefault: form.assignTo === "",
  };
}

/** Client-side checks that mirror the database constraints, with reasons. */
function validate(form: FormState): string[] {
  const errors: string[] = [];
  if (!parseSipUri(form.sipUri)) {
    errors.push("SIP URI must look like sip:extension@domain.");
  }
  if (!form.password.trim()) {
    errors.push("A SIP password is required.");
  }
  const wsUrl = form.wsUrl.trim();
  if (!wsUrl) {
    errors.push("A WebSocket URL is required.");
  } else if (!/^wss:\/\//i.test(wsUrl)) {
    errors.push(
      "The WebSocket URL must start with wss://. A page served over HTTPS is not allowed to open an insecure ws:// socket.",
    );
  }
  if (form.registerExpiry < 60 || form.registerExpiry > 3600) {
    errors.push("Registration expiry must be between 60 and 3600 seconds.");
  }
  return errors;
}

export function PhoneSettingsPage() {
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<{ ok: boolean; failure: SipFailure | null } | null>(null);
  const [testing, setTesting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SipAccountRow | null>(null);

  // One hook serves both deployment modes, so this page cannot drift between
  // the Supabase path and the self-hosted API path.
  const {
    accounts: accountsQuery,
    profiles: profilesQuery,
    save: saveMutation,
    remove: deleteMutation,
  } = useSipAccountsAdmin();

  const accounts = accountsQuery.data ?? [];
  // Memoised so that `profileName` below does not recompute on every render:
  // `?? []` would otherwise produce a fresh array identity each time.
  const profiles = useMemo(() => profilesQuery.data ?? [], [profilesQuery.data]);
  const trunkDefault = accounts.find((row) => row.user_id === null);

  const profileName = useMemo(() => {
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    return (id: string | null) => {
      if (!id) return "Shared trunk default";
      const profile = byId.get(id);
      return profile?.fullName || profile?.username || profile?.email || "Unknown user";
    };
  }, [profiles]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => (previous ? { ...previous, [key]: value } : previous));
    setTestResult(null);
  }

  // Choosing a provider fills in the WebSocket URL for the administrator, who is
  // far more likely to know the extension than the port.
  function changeProvider(provider: SipProvider) {
    setForm((previous) => {
      if (!previous) return previous;
      const domain = domainFromSipUri(previous.sipUri);
      const preset = SIP_PRESETS[provider];
      // A provider with no SIP-over-WebSocket listener gets no guess at all. The
      // address has to name a PBX or gateway the operator runs, which cannot be
      // inferred from the provider, and a plausible-looking guess is worse than
      // an empty field.
      const auto = preset.browserReady
        ? domain
          ? deriveWsUrl(provider, domain)
          : preset.example.wsUrl
        : "";
      const derived =
        previous.wsUrl.trim() === "" ||
        SIP_PROVIDERS.some((candidate) => previous.wsUrl.trim() === deriveWsUrl(candidate, domain));
      return { ...previous, provider, wsUrl: derived ? auto : previous.wsUrl };
    });
    setTestResult(null);
  }

  function changeSipUri(sipUri: string) {
    setForm((previous) => {
      if (!previous) return previous;
      const domain = domainFromSipUri(sipUri);
      const stale = !previous.wsUrl.trim() || !domainFromSipUri(previous.wsUrl.replace(/^wss:\/\//, "sip:"));
      return {
        ...previous,
        sipUri,
        wsUrl: stale && domain ? deriveWsUrl(previous.provider, domain) : previous.wsUrl,
      };
    });
    setTestResult(null);
  }

  async function handleTest() {
    if (!form) return;
    const problems = validate(form);
    setErrors(problems);
    if (problems.length > 0) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testSipAccount(formToAccount(form)));
    } finally {
      setTesting(false);
    }
  }

  function handleSave() {
    if (!form) return;
    const problems = validate(form);
    setErrors(problems);
    if (problems.length > 0) return;

    const payload: SipAccountPayload = {
      label: form.label.trim() || null,
      provider: form.provider,
      sip_uri: normaliseSipUri(form.sipUri) ?? "",
      password: form.password,
      ws_url: form.wsUrl.trim(),
      caller_id: form.callerId.trim() || null,
      stun_urls: parseStunUrls(form.stunUrls),
      register_expiry: form.registerExpiry,
      user_id: form.assignTo || null,
      enabled: form.enabled,
    };

    saveMutation.mutate(
      { id: form.id, payload },
      {
        onSuccess: () => {
          setForm(null);
          setErrors([]);
          setTestResult(null);
          toast.success("Phone settings saved");
        },
        onError: (error: Error) => toast.error(error.message),
      },
    );
  }

  if (accountsQuery.isError) {
    return (
      <div className="space-y-6">
        <PhoneHeader />
        <div className="rounded-xl border border-danger/30 bg-danger/12 p-5 text-sm text-danger">
          <p className="font-semibold">Could not load the phone settings.</p>
          <p className="mt-1">
            {(accountsQuery.error as Error).message}. If this mentions a missing relation, migration
            <code className="mx-1 font-mono">004_sip_accounts.sql</code>
            has not been applied to this Supabase project.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PhoneHeader />

      {!trunkDefault && accounts.length === 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/12 p-5">
          <div className="flex gap-3">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div className="text-sm text-warning">
              <p className="font-semibold">No phone is configured yet.</p>
              <p className="mt-1">
                A browser cannot place a real call on its own — it has to register with a SIP
                provider, which then connects the call to the telephone network. Add those
                credentials below and the dialer on every lead page becomes live. Until then the
                softphone shows "Not configured" and offers an <em>Open in phone app</em> link
                instead of pretending to call.
              </p>
            </div>
          </div>
        </div>
      )}

      <section className="bg-panel rounded-xl border border-line overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">SIP accounts</h2>
            <p className="text-xs text-muted mt-0.5">
              Give each agent their own extension where the provider allows it, so one leaked
              credential cannot be used to dial on the whole trunk.
            </p>
          </div>
          <button
            onClick={() => {
              setForm({ ...EMPTY_FORM });
              setErrors([]);
              setTestResult(null);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-inverse text-sm font-medium hover:bg-accent-strong transition"
          >
            <Plus className="w-4 h-4" />
            Add account
          </button>
        </div>

        {accountsQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-faint">Loading...</div>
        ) : accounts.length === 0 ? (
          <div className="p-8 text-center text-sm text-faint">No accounts yet.</div>
        ) : (
          <ul className="divide-y divide-line">
            {accounts.map((row) => (
              <li key={row.id} className="px-5 py-4 flex items-start gap-4">
                <div className="w-9 h-9 rounded-full bg-accent/12 flex items-center justify-center shrink-0">
                  <Phone className="w-4 h-4 text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink truncate">
                    {row.label || row.sip_uri}
                    {row.user_id === null && (
                      <span className="ml-2 inline-flex items-center gap-1 text-2xs font-normal text-muted">
                        <Shield className="w-3 h-3" />
                        shared default
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted font-mono truncate">{row.sip_uri}</p>
                  <p className="text-xs text-faint truncate">
                    {SIP_PRESETS[row.provider]?.label ?? row.provider} · {row.ws_url} ·{" "}
                    {profileName(row.user_id)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span
                    className={`text-2xs px-2 py-0.5 rounded-full ${
                      row.enabled ? "bg-success/12 text-success" : "bg-hover text-muted"
                    }`}
                  >
                    {row.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <button
                    onClick={() => {
                      setForm(rowToForm(row));
                      setErrors([]);
                      setTestResult(null);
                    }}
                    className="p-2 rounded-lg text-faint hover:text-accent hover:bg-accent/12 transition"
                    title="Edit"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setConfirmDelete(row)}
                    className="p-2 rounded-lg text-faint hover:text-danger hover:bg-danger/12 transition"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {form && (
        <section className="bg-panel rounded-xl border border-line overflow-hidden">
          <div className="px-5 py-4 border-b border-line flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">
              {form.id ? "Edit account" : "New account"}
            </h2>
            <button
              onClick={() => {
                setForm(null);
                setErrors([]);
                setTestResult(null);
              }}
              className="p-1.5 rounded-lg text-faint hover:text-muted transition"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Provider">
                <select
                  value={form.provider}
                  onChange={(event) => changeProvider(event.target.value as SipProvider)}
                  className={inputClass}
                >
                  {SIP_PROVIDERS.map((provider) => (
                    <option key={provider} value={provider}>
                      {SIP_PRESETS[provider].label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Assign to">
                <select
                  value={form.assignTo}
                  onChange={(event) => set("assignTo", event.target.value)}
                  className={inputClass}
                >
                  <option value="">Shared trunk default (everyone)</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.fullName || profile.username || profile.email || profile.id} · {profile.role}
                    </option>
                  ))}
                </select>
              </Field>

              {!SIP_PRESETS[form.provider].browserReady && (
                <div className="rounded border border-warning/30 bg-warning/12 p-3 text-xs text-warning">
                  <p className="font-semibold">
                    {SIP_PRESETS[form.provider].label} has no SIP-over-WebSocket endpoint
                  </p>
                  <p className="mt-1 leading-relaxed">
                    {SIP_PRESETS[form.provider].browserNote}
                  </p>
                  <p className="mt-1 leading-relaxed">
                    The WebSocket URL below must name a server that answers SIP over
                    WebSocket &mdash; your PBX, or a WebRTC-to-SIP gateway you run. The
                    provider&apos;s own SIP domain belongs in the SIP URI field, not there.
                  </p>
                </div>
              )}

              <Field
                label="SIP URI (address of record)"
                hint={SIP_PRESETS[form.provider].example.sipUri}
              >
                <input
                  value={form.sipUri}
                  onChange={(event) => changeSipUri(event.target.value)}
                  placeholder={SIP_PRESETS[form.provider].example.sipUri}
                  className={`${inputClass} font-mono`}
                  autoComplete="off"
                />
              </Field>

              <Field label="Password">
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => set("password", event.target.value)}
                  className={inputClass}
                  autoComplete="new-password"
                />
              </Field>

              <Field
                label="WebSocket URL"
                hint={
                  form.provider === "custom"
                    ? "The PBX or WebRTC gateway the browser talks to, e.g. wss://pbx.example.com:8089/ws. A trunk such as Bitcall (gateway.bitcall.io on 5060/udp) belongs in the SIP URI field above, never here."
                    : SIP_PRESETS[form.provider].browserReady
                      ? `Where the browser connects, e.g. ${SIP_PRESETS[form.provider].example.wsUrl}`
                      : `A PBX or gateway you run, e.g. ${SIP_PRESETS[form.provider].example.wsUrl} — not the provider's SIP domain`
                }
              >
                <input
                  value={form.wsUrl}
                  onChange={(event) => set("wsUrl", event.target.value)}
                  placeholder={SIP_PRESETS[form.provider].example.wsUrl}
                  className={`${inputClass} font-mono`}
                  autoComplete="off"
                />
              </Field>

              <Field label="Outbound caller ID (optional)">
                <input
                  value={form.callerId}
                  onChange={(event) => set("callerId", event.target.value)}
                  placeholder="+15551234567"
                  className={`${inputClass} font-mono`}
                  autoComplete="off"
                />
              </Field>

              <Field label="Label (optional)">
                <input
                  value={form.label}
                  onChange={(event) => set("label", event.target.value)}
                  placeholder="Frontline trunk"
                  className={inputClass}
                  autoComplete="off"
                />
              </Field>

              <Field label="Registration expiry (seconds)">
                <input
                  type="number"
                  min={60}
                  max={3600}
                  value={form.registerExpiry}
                  onChange={(event) => set("registerExpiry", Number(event.target.value) || 600)}
                  className={inputClass}
                />
              </Field>
            </div>

            <Field
              label="STUN servers (one per line)"
              hint="Needed so a browser behind NAT can be reached. Leave blank for sensible defaults."
            >
              <textarea
                value={form.stunUrls}
                onChange={(event) => set("stunUrls", event.target.value)}
                rows={2}
                placeholder={"stun:stun.l.google.com:19302"}
                className={`${inputClass} font-mono resize-none`}
              />
            </Field>

            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => set("enabled", event.target.checked)}
                className="rounded border-line-strong text-accent focus:ring-accent"
              />
              Enabled
            </label>

            {errors.length > 0 && (
              <ul className="rounded-lg border border-danger/30 bg-danger/12 px-3 py-2 space-y-1">
                {errors.map((message) => (
                  <li key={message} className="text-xs text-danger flex gap-1.5">
                    <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {message}
                  </li>
                ))}
              </ul>
            )}

            {testResult && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  testResult.ok
                    ? "border-success/30 bg-success/12 text-success"
                    : "border-danger/30 bg-danger/12 text-danger"
                }`}
              >
                {testResult.ok ? (
                  <p className="flex items-center gap-1.5 font-medium">
                    <CheckCircle2 className="w-4 h-4" />
                    Registration accepted — these credentials work.
                  </p>
                ) : (
                  <div className="flex gap-1.5">
                    <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">{testResult.failure?.message ?? "Registration failed."}</p>
                      {testResult.failure?.hint && <p className="mt-0.5">{testResult.failure.hint}</p>}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                onClick={handleTest}
                disabled={testing || !isUsableAccount(formToAccount(form))}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line-strong text-sm font-medium text-ink hover:bg-app disabled:opacity-50 transition"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                Test connection
              </button>
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-inverse text-sm font-semibold hover:bg-accent-strong disabled:opacity-50 transition"
              >
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Save
              </button>
              <span className="text-xs text-faint">
                Testing registers and then unregisters; it places no call.
              </span>
            </div>
          </div>
        </section>
      )}

      <section className="bg-panel rounded-xl border border-line p-5 text-sm text-muted space-y-2">
        <h2 className="text-base font-semibold text-ink">About browser credentials</h2>
        <p>
          A web softphone authenticates to your SIP server from the browser, so the password has to
          be readable by the page. That is inherent to this design, not a defect in it — but it means
          these credentials should belong to an extension that can only do what an agent needs, not
          to an administrator account or an unbounded trunk. Restrict it at the provider: cap
          concurrent calls, limit destinations, and block premium-rate ranges.
        </p>
        <p>
          Reads are restricted by row-level security to the owning agent and to administrators, and
          only administrators can add or change an account.
        </p>
      </section>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 p-4">
          <div className="bg-panel rounded-xl shadow-raised max-w-sm w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-ink">Remove this account?</h3>
            <p className="text-sm text-muted">
              {confirmDelete.label || confirmDelete.sip_uri} will no longer be able to register.
              Agents using it will see "Not configured" until another account is added.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-2 rounded-lg border border-line-strong text-sm font-medium text-ink hover:bg-app transition"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  deleteMutation.mutate(confirmDelete.id, {
                    onSuccess: () => {
                      setConfirmDelete(null);
                      toast.success("Account removed");
                    },
                    onError: (error: Error) => toast.error(error.message),
                  })
                }
                disabled={deleteMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-danger text-inverse text-sm font-semibold hover:bg-danger/90 disabled:opacity-50 transition"
              >
                {deleteMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputClass =
  "w-full px-3 py-2 border border-line-strong rounded-lg text-sm focus:ring-2 focus:ring-accent focus:border-accent outline-none bg-panel";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted mb-1">{label}</span>
      {children}
      {hint && <span className="block text-2xs text-faint mt-1 font-mono">{hint}</span>}
    </label>
  );
}

function PhoneHeader() {
  return (
    <PageHeader
      title="Phone"
      description="SIP credentials for the browser softphone. Calls are placed over WebRTC through your SIP provider."
    />
  );
}
