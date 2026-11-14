import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  Database,
  FileText,
  Lock,
  PhoneCall,
  ShieldAlert,
  Users,
} from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { SkeletonRows } from "@/components/common/Skeleton";
import { useCallLogs } from "@/hooks/useCallLogs";
import { useLeads } from "@/hooks/useLeads";
import { useScripts } from "@/hooks/useScripts";
import { useSipAccountsAdmin } from "@/hooks/useSip";
import { API_URL, isApiMode } from "@/lib/apiClient";
import { dotClass, outcomeLabel, textClass, type Tone } from "@/lib/outcomes";

/**
 * Administration.
 *
 * This screen used to be a second dashboard: the same five totals the Dashboard
 * already shows, drawn with worse charts and no date range, on a page titled
 * "Administration" that administered nothing. An administrator arriving here
 * found no information they did not already have and nothing they could do.
 *
 * What an administrator actually needs that nobody else does is the state of the
 * deployment — the handful of conditions that decide whether a call can be
 * placed at all, and what to do about each one that is not met. So this page
 * answers that instead, and the performance numbers stay on the Dashboard where
 * the date range and the comparisons live.
 */

type CheckState = "ok" | "attention" | "blocking";

const STATE_TONE: Record<CheckState, Tone> = {
  ok: "success",
  attention: "warning",
  blocking: "danger",
};

const STATE_WORD: Record<CheckState, string> = {
  ok: "Ready",
  attention: "Check",
  blocking: "Blocking",
};

interface Check {
  id: string;
  state: CheckState;
  title: string;
  /** What was found. One sentence, stating the fact rather than the rule. */
  finding: string;
  /** What to do about it, when it is not ready. */
  remedy?: string;
  to?: string;
  actionLabel?: string;
}

function CheckRow({ check }: { check: Check }) {
  const tone = STATE_TONE[check.state];
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass(tone)}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-sm font-semibold text-ink">{check.title}</p>
          <span
            className={`text-2xs font-semibold uppercase tracking-wide ${textClass(tone)}`}
          >
            {STATE_WORD[check.state]}
          </span>
        </div>
        <p className="mt-0.5 text-sm leading-relaxed text-muted">{check.finding}</p>
        {check.remedy ? (
          <p className="mt-1 text-xs leading-relaxed text-faint">{check.remedy}</p>
        ) : null}
      </div>
      {check.to ? (
        <Link to={check.to} className="btn btn-ghost btn-sm shrink-0">
          {check.actionLabel ?? "Open"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </li>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-2xs uppercase tracking-wide text-faint">{label}</p>
      <p className="tabular mt-0.5 text-xl font-bold text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * Statements about how this deployment handles credentials.
 *
 * These are not warnings that can be dismissed by clicking something; they are
 * properties of running a SIP softphone in a browser, and an administrator
 * deciding where to point it should be able to read them in the product rather
 * than only in SECURITY.md.
 */
const POSTURE = [
  {
    title: "SIP passwords are readable in the browser",
    body:
      "Browser SIP authenticates with a digest, so the trunk password has to be present in the page to register. It is stored in sip_accounts and shown to any administrator on the Phone page. Use a trunk account scoped to outbound calling only, never a master account.",
  },
  {
    title: "Accounts can only be created by an administrator",
    body:
      "There is no public sign-up. Enforced in three places that do not depend on each other: no client route, an edge function and a backend route that both require the admin role, and row-level security that rejects an unprovisioned account.",
  },
  {
    title: "Microphone access needs a secure origin",
    body:
      "Browsers only expose getUserMedia over HTTPS or on localhost. A deployment served over plain HTTP will report the microphone as unavailable rather than failing silently.",
  },
] as const;

export function AdminPage() {
  const { accounts, profiles } = useSipAccountsAdmin();
  const leadsQuery = useLeads();
  const callLogsQuery = useCallLogs();
  const scriptsQuery = useScripts();

  const loading =
    accounts.isLoading ||
    profiles.isLoading ||
    leadsQuery.isLoading ||
    callLogsQuery.isLoading ||
    scriptsQuery.isLoading;

  const leads = useMemo(() => leadsQuery.data ?? [], [leadsQuery.data]);
  const logs = useMemo(() => callLogsQuery.data ?? [], [callLogsQuery.data]);
  const trunks = useMemo(() => accounts.data ?? [], [accounts.data]);
  const people = useMemo(() => profiles.data ?? [], [profiles.data]);
  const scripts = useMemo(() => scriptsQuery.data ?? [], [scriptsQuery.data]);

  const checks = useMemo<Check[]>(() => {
    const secureContext = typeof window === "undefined" ? true : window.isSecureContext;
    const answered = logs.filter((log) => log.outcome === "answered").length;
    const dnc = leads.filter((lead) => lead.status === "do_not_contact").length;
    const diallable = leads.filter(
      (lead) => lead.status === "new" || lead.status === "callback" || lead.status === "interested",
    ).length;
    const admins = people.filter((person) => person.role === "admin").length;
    const unprovisioned = people.filter((person) => !person.provisioned).length;
    const sharedTrunk = trunks.find((trunk) => trunk.user_id === null);

    const list: Check[] = [
      {
        id: "trunk",
        state: trunks.length === 0 ? "blocking" : "ok",
        title: "SIP trunk",
        finding:
          trunks.length === 0
            ? "No trunk is configured, so no call can be placed from this deployment."
            : `${trunks.length} trunk${trunks.length === 1 ? "" : "s"} configured${
                sharedTrunk ? ", including one shared default every agent uses" : ""
              }${trunks.length > 1 ? ` · ${trunks.length - (sharedTrunk ? 1 : 0)} assigned to named agents` : ""}.`,
        remedy:
          trunks.length === 0
            ? "Add the WebSocket URL and credentials your provider gives you. A provider without SIP-over-WebSocket cannot be used from a browser at all."
            : undefined,
        to: "/phone",
        actionLabel: "Phone",
      },
      {
        id: "secure",
        state: secureContext ? "ok" : "blocking",
        title: "Secure origin",
        finding: secureContext
          ? "Served over HTTPS or localhost, so the browser will grant microphone access."
          : "This page is not a secure context. The browser will refuse microphone access and calls cannot carry audio.",
        remedy: secureContext ? undefined : "Serve the app over HTTPS, then reload.",
      },
      {
        id: "mode",
        state: "ok",
        title: "Data path",
        finding: isApiMode
          ? `Talking to the self-hosted API at ${API_URL}.`
          : "Talking to Supabase directly, with row-level security deciding what each role can read.",
        remedy: isApiMode
          ? undefined
          : "Set VITE_API_URL at build time to route through the Express backend instead.",
      },
      {
        id: "accounts",
        state: admins === 0 ? "blocking" : unprovisioned > 0 ? "attention" : "ok",
        title: "Accounts",
        finding:
          people.length === 0
            ? "No accounts are visible to you."
            : `${people.length} account${people.length === 1 ? "" : "s"} · ${admins} administrator${admins === 1 ? "" : "s"}${
                unprovisioned > 0
                  ? ` · ${unprovisioned} waiting to be onboarded and able to read no data until then`
                  : ""
              }.`,
        remedy:
          admins === 0
            ? "A deployment with no administrator cannot create accounts or change the trunk."
            : undefined,
        to: "/team",
        actionLabel: "Team",
      },
      {
        id: "leads",
        state: leads.length === 0 ? "attention" : "ok",
        title: "Leads",
        finding:
          leads.length === 0
            ? "There are no leads, so there is nothing for an agent to dial."
            : `${leads.length} lead${leads.length === 1 ? "" : "s"} · ${diallable} still in the queue${
                dnc > 0 ? ` · ${dnc} marked do not contact` : ""
              }.`,
        remedy: leads.length === 0 ? "Import a CSV or add one by hand." : undefined,
        to: "/leads",
        actionLabel: "Leads",
      },
      {
        id: "calls",
        state: logs.length === 0 ? "attention" : "ok",
        title: "Calls",
        finding:
          logs.length === 0
            ? "No call has been recorded from this deployment yet, so the trunk has not been proven to work end to end."
            : `${logs.length} call${logs.length === 1 ? "" : "s"} recorded · ${answered} ${outcomeLabel("answered").toLowerCase()}${
                logs.length > 0
                  ? ` · ${Math.round((answered / logs.length) * 100)}% connect rate`
                  : ""
              }.`,
        remedy:
          logs.length === 0
            ? "Place one test call to a number you control. A trunk that registers but cannot complete a call looks identical to a working one until somebody dials."
            : undefined,
        to: "/history",
        actionLabel: "History",
      },
      {
        id: "scripts",
        state: scripts.length === 0 ? "attention" : "ok",
        title: "Call scripts",
        finding:
          scripts.length === 0
            ? "No scripts exist, so an agent calling from the workspace has nothing to read."
            : `${scripts.length} script${scripts.length === 1 ? "" : "s"} available in the workspace.`,
        remedy: scripts.length === 0 ? "Write one, or attach one to a campaign." : undefined,
        to: "/scripts",
        actionLabel: "Scripts",
      },
    ];

    return list;
  }, [trunks, people, leads, logs, scripts.length]);

  const blocking = checks.filter((check) => check.state === "blocking");
  const attention = checks.filter((check) => check.state === "attention");
  const answeredCount = logs.filter((log) => log.outcome === "answered").length;
  const dncCount = leads.filter((lead) => lead.status === "do_not_contact").length;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title="Administration"
        description={
          loading
            ? "Checking this deployment…"
            : blocking.length > 0
              ? `${blocking.length} condition${blocking.length === 1 ? "" : "s"} stopping calls from being placed.`
              : attention.length > 0
                ? `Calls can be placed. ${attention.length} item${attention.length === 1 ? "" : "s"} worth a look.`
                : "Everything a call needs is in place."
        }
      />

      {loading ? (
        <div className="card p-2">
          <SkeletonRows rows={6} />
        </div>
      ) : (
        <>
          {!isApiMode && leads.length === 0 && logs.length === 0 && trunks.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              title="This deployment is empty"
              description="No trunk, no leads and no calls yet. Configure the trunk first — without it nothing else can be tested."
              action={
                <Link to="/phone" className="btn btn-primary btn-sm">
                  <PhoneCall className="h-3.5 w-3.5" />
                  Configure the trunk
                </Link>
              }
            />
          ) : null}

          <section className="card overflow-hidden" aria-labelledby="readiness-heading">
            <div className="pane-head">
              <h2 id="readiness-heading" className="pane-title">
                Readiness
              </h2>
              <span className="text-2xs text-faint">
                {checks.filter((check) => check.state === "ok").length} of {checks.length} ready
              </span>
            </div>
            <ul className="divide-y divide-line">
              {checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>
          </section>

          <section className="card overflow-hidden" aria-labelledby="counts-heading">
            <div className="pane-head">
              <h2 id="counts-heading" className="pane-title">
                What is stored
              </h2>
              <Link to="/dashboard" className="btn btn-ghost btn-sm">
                Performance
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
              <Stat label="Leads" value={String(leads.length)} hint={`${dncCount} do not contact`} />
              <Stat label="Calls" value={String(logs.length)} hint={`${answeredCount} answered`} />
              <Stat label="Accounts" value={String(people.length)} hint="Created by an admin" />
              <Stat label="Scripts" value={String(scripts.length)} hint="Shown while dialling" />
            </div>
          </section>

          <section aria-labelledby="posture-heading" className="space-y-3">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-faint" />
              <h2 id="posture-heading" className="pane-title">
                How this deployment handles credentials
              </h2>
            </div>
            <ul className="grid gap-3 md:grid-cols-3">
              {POSTURE.map((item) => (
                <li key={item.title} className="card p-4">
                  <p className="text-sm font-semibold text-ink">{item.title}</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">{item.body}</p>
                </li>
              ))}
            </ul>
            <p className="flex items-center gap-1.5 text-xs text-faint">
              <Database className="h-3.5 w-3.5" />
              Row-level security is applied in the database, so a role cannot read data the policy
              does not grant it even if the interface tried to ask.
            </p>
          </section>

          <nav className="grid gap-3 sm:grid-cols-3" aria-label="Administration">
            <Link to="/team" className="card flex items-center gap-3 p-4 transition-shadow hover:shadow-raised">
              <span className="rounded-lg bg-accent/12 p-2 text-accent">
                <Users className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">Team</span>
                <span className="block text-xs text-muted">Create and onboard accounts</span>
              </span>
            </Link>
            <Link to="/phone" className="card flex items-center gap-3 p-4 transition-shadow hover:shadow-raised">
              <span className="rounded-lg bg-info/12 p-2 text-info">
                <PhoneCall className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">Phone</span>
                <span className="block text-xs text-muted">Trunks and caller ID</span>
              </span>
            </Link>
            <Link to="/scripts" className="card flex items-center gap-3 p-4 transition-shadow hover:shadow-raised">
              <span className="rounded-lg bg-alt/12 p-2 text-alt">
                <BookOpen className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">Scripts</span>
                <span className="block text-xs text-muted">What agents read while calling</span>
              </span>
            </Link>
          </nav>

          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-faint">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Dispositions, lead statuses and the shortcuts agents use are defined in code so every
            screen reports them the same way; changing that vocabulary is a release, not a setting.
          </p>
        </>
      )}
    </div>
  );
}
