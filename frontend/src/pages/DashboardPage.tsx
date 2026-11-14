import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Clock,
  Headset,
  PhoneCall,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { BarChart, Donut, Sparkline } from "@/components/charts/Charts";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton, SkeletonCards } from "@/components/common/Skeleton";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useCallLogs } from "@/hooks/useCallLogs";
import { useLeads } from "@/hooks/useLeads";
import {
  OUTCOMES,
  chipClass,
  dotClass,
  isQueueFinished,
  outcomeLabel,
  outcomeTone,
  statusLabel,
  statusTone,
  textClass,
  type Tone,
} from "@/lib/outcomes";
import type { Database } from "@/types/database";

type CallLog = Database["public"]["Tables"]["call_logs"]["Row"];

/**
 * How the operation is going, over a period the operator chooses.
 *
 * The page this replaces listed six totals with no time dimension: "Total Leads
 * 1,204" says nothing actionable on its own, and the same number looks identical
 * whether the team made four hundred calls this week or none. Everything here is
 * scoped to a window, compared against the window before it, and shown as a shape
 * rather than only a digit — because the question a manager is asking is "are we
 * getting through?" and that is a trend, not a total.
 */

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
] as const;

const DAY_MS = 86_400_000;

function startOfDay(value: number): number {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The moment a call happened, preferring the real start over the row's insert. */
function callTime(log: CallLog): number | null {
  return timestamp(log.started_at) ?? timestamp(log.ended_at) ?? timestamp(log.created_at);
}

function shortDay(value: number): string {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function formatMinutes(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

interface Delta {
  /** Percentage change, or null when the previous window was empty. */
  value: number | null;
  /** Rising is good for every metric on this page. */
  good: boolean;
}

function delta(current: number, previous: number): Delta {
  if (previous <= 0) return { value: current > 0 ? null : 0, good: current > 0 };
  const change = ((current - previous) / previous) * 100;
  return { value: Math.round(change), good: change >= 0 };
}

function StatTile({
  label,
  value,
  sublabel,
  icon: Icon,
  tone = "accent",
  series,
  delta: change,
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: Tone;
  series?: number[];
  delta?: Delta;
}) {
  const flat = change?.value === null || change?.value === undefined;
  const positive = change?.good ?? false;

  return (
    <div className="card animate-rise-in p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
            <Icon className="h-3.5 w-3.5" />
            {label}
          </p>
          <p className="tabular mt-1.5 text-2xl font-bold tracking-tight text-ink">{value}</p>
        </div>
        {change && !flat ? (
          <span
            className={`tabular flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
              positive ? chipClass("success") : chipClass("danger")
            }`}
            title="Against the previous period of the same length"
          >
            {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(change.value ?? 0)}%
          </span>
        ) : null}
      </div>

      {series && series.length > 1 ? (
        <div className="mt-2">
          <Sparkline values={series} tone={tone} height={34} />
        </div>
      ) : null}

      {sublabel ? <p className="mt-1.5 text-[11px] leading-relaxed text-faint">{sublabel}</p> : null}
      {flat && change ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-faint">No calls in the previous period</p>
      ) : null}
    </div>
  );
}

export function DashboardPage() {
  const [rangeDays, setRangeDays] = useState<number>(7);

  const leadsQuery = useLeads();
  const logsQuery = useCallLogs();
  const campaignsQuery = useCampaigns();

  const leads = useMemo(() => leadsQuery.data ?? [], [leadsQuery.data]);
  const logs = useMemo(() => logsQuery.data ?? [], [logsQuery.data]);
  const campaigns = useMemo(() => campaignsQuery.data ?? [], [campaignsQuery.data]);

  const loading = leadsQuery.isLoading || logsQuery.isLoading;

  const analysis = useMemo(() => {
    const now = Date.now();
    const todayStart = startOfDay(now);
    const windowStart = todayStart - (rangeDays - 1) * DAY_MS;
    const previousStart = windowStart - rangeDays * DAY_MS;

    const dated = logs
      .map((log) => ({ log, at: callTime(log) }))
      .filter((entry): entry is { log: CallLog; at: number } => entry.at !== null);

    const inWindow = dated.filter((entry) => entry.at >= windowStart && entry.at <= now);
    const inPrevious = dated.filter((entry) => entry.at >= previousStart && entry.at < windowStart);

    // Calls per day, every day in the window including the empty ones. A gap in
    // the bars is information; omitting the day would hide it.
    const buckets = Array.from({ length: rangeDays }, (_, index) => {
      const day = windowStart + index * DAY_MS;
      const dayLogs = inWindow.filter((entry) => startOfDay(entry.at) === day);
      return {
        day,
        label: shortDay(day),
        total: dayLogs.length,
        answered: dayLogs.filter((entry) => entry.log.outcome === "answered").length,
        seconds: dayLogs.reduce((sum, entry) => sum + (entry.log.duration_seconds ?? 0), 0),
      };
    });

    const answeredNow = inWindow.filter((entry) => entry.log.outcome === "answered").length;
    const answeredBefore = inPrevious.filter((entry) => entry.log.outcome === "answered").length;
    const secondsNow = inWindow.reduce((sum, entry) => sum + (entry.log.duration_seconds ?? 0), 0);
    const secondsBefore = inPrevious.reduce((sum, entry) => sum + (entry.log.duration_seconds ?? 0), 0);

    const outcomeCounts = OUTCOMES.map((outcome) => ({
      label: outcome.label,
      value: inWindow.filter((entry) => entry.log.outcome === outcome.value).length,
      tone: outcome.tone,
    }));

    const diallable = leads.filter((lead) => !isQueueFinished(lead.status, lead.dnc));

    const pipeline = (["new", "contacted", "callback", "interested", "converted"] as const).map(
      (status) => ({
        label: statusLabel(status),
        value: leads.filter((lead) => lead.status === status).length,
        tone: statusTone(status),
      }),
    );

    const leadById = new Map(leads.map((lead) => [lead.id, lead]));

    // Per-campaign performance, restricted to the window so it answers "which
    // campaign is working right now" rather than "which has ever worked".
    const campaignRows = campaigns
      .map((campaign) => {
        const campaignLogs = inWindow.filter((entry) => entry.log.campaign_id === campaign.id);
        const connected = campaignLogs.filter((entry) => entry.log.outcome === "answered").length;
        const converted = leads.filter(
          (lead) => lead.campaign_id === campaign.id && lead.status === "converted",
        ).length;
        return {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          leads: leads.filter((lead) => lead.campaign_id === campaign.id).length,
          calls: campaignLogs.length,
          connectRate: percent(connected, campaignLogs.length),
          converted,
        };
      })
      .sort((a, b) => b.calls - a.calls || b.leads - a.leads);

    const unassignedCalls = inWindow.filter((entry) => !entry.log.campaign_id).length;

    const recent = [...dated]
      .sort((a, b) => b.at - a.at)
      .slice(0, 8)
      .map(({ log, at }) => ({ log, at, lead: log.lead_id ? leadById.get(log.lead_id) : undefined }));

    return {
      buckets,
      calls: inWindow.length,
      previousCalls: inPrevious.length,
      answeredNow,
      answeredBefore,
      connectRate: percent(answeredNow, inWindow.length),
      previousConnectRate: percent(answeredBefore, inPrevious.length),
      secondsNow,
      secondsBefore,
      avgSeconds: inWindow.length > 0 ? Math.round(secondsNow / answeredNow || 0) : 0,
      outcomeCounts,
      diallable: diallable.length,
      blocked: leads.filter((lead) => lead.dnc || lead.status === "do_not_contact").length,
      pipeline,
      campaignRows,
      unassignedCalls,
      recent,
      hasAnyCall: dated.length > 0,
    };
  }, [logs, leads, campaigns, rangeDays]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <SkeletonCards cards={4} className="sm:grid-cols-2 xl:grid-cols-4" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  }

  const callSeries = analysis.buckets.map((bucket) => bucket.total);
  const connectSeries = analysis.buckets.map((bucket) => percent(bucket.answered, bucket.total));

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            {analysis.calls > 0
              ? `${analysis.calls} call${analysis.calls === 1 ? "" : "s"} in the last ${rangeDays} days · ${analysis.diallable} lead${analysis.diallable === 1 ? "" : "s"} left to work`
              : `${analysis.diallable} lead${analysis.diallable === 1 ? "" : "s"} waiting to be called`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-line bg-panel p-0.5" role="group" aria-label="Date range">
            {RANGES.map((range) => (
              <button
                key={range.days}
                type="button"
                onClick={() => setRangeDays(range.days)}
                aria-pressed={rangeDays === range.days}
                className={`rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                  rangeDays === range.days
                    ? "bg-accent text-inverse"
                    : "text-muted hover:bg-hover hover:text-ink"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
          <Link to="/workspace" className="btn btn-primary btn-sm">
            <Headset className="h-3.5 w-3.5" />
            Start calling
          </Link>
        </div>
      </header>

      {leads.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Users}
            title="No leads yet"
            description="Everything on this page is derived from your leads and call history. Import a list or add a lead, and the numbers here become real."
            action={
              <Link to="/leads" className="btn btn-primary btn-sm">
                Go to Leads
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
        </div>
      ) : (
        <>
          {/* Headline numbers */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Calls made"
              value={String(analysis.calls)}
              icon={PhoneCall}
              tone="accent"
              series={callSeries}
              delta={delta(analysis.calls, analysis.previousCalls)}
              sublabel={`${analysis.answeredNow} connected`}
            />
            <StatTile
              label="Connect rate"
              value={`${analysis.connectRate}%`}
              icon={Activity}
              tone={analysis.connectRate >= 30 ? "success" : "warning"}
              series={connectSeries}
              delta={delta(analysis.connectRate, analysis.previousConnectRate)}
              sublabel="Answered, as a share of every attempt"
            />
            <StatTile
              label="Talk time"
              value={formatMinutes(analysis.secondsNow)}
              icon={Clock}
              tone="info"
              series={analysis.buckets.map((bucket) => bucket.seconds)}
              delta={delta(analysis.secondsNow, analysis.secondsBefore)}
              sublabel={
                analysis.avgSeconds > 0
                  ? `${analysis.avgSeconds}s average per connected call`
                  : "No connected calls yet"
              }
            />
            <StatTile
              label="Queue remaining"
              value={String(analysis.diallable)}
              icon={Target}
              tone="alt"
              sublabel={
                analysis.blocked > 0
                  ? `${analysis.blocked} on the do-not-contact list, never dialled`
                  : "Ready to dial from the workspace"
              }
            />
          </div>

          {!analysis.hasAnyCall ? (
            <div className="card">
              <EmptyState
                icon={PhoneCall}
                title="No calls recorded yet"
                description="The charts below need call history. Open the workspace, select a lead and dial — or if calls were made from outside the app, record the outcome there and they will appear here."
                action={
                  <Link to="/workspace" className="btn btn-primary btn-sm">
                    <Headset className="h-3.5 w-3.5" />
                    Open the workspace
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-5">
              <section className="card p-4 lg:col-span-3">
                <div className="mb-4 flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold text-ink">Call volume</h2>
                  <span className="text-[11px] text-faint">
                    every day in the window, including days with no calls
                  </span>
                </div>
                <BarChart
                  data={analysis.buckets.map((bucket) => ({
                    label: bucket.label,
                    value: bucket.total,
                    tone: bucket.answered > 0 ? "accent" : "neutral",
                  }))}
                  height={140}
                  emptyMessage="No calls in this period"
                />
              </section>

              <section className="card p-4 lg:col-span-2">
                <h2 className="mb-4 text-sm font-semibold text-ink">Outcome mix</h2>
                <Donut
                  segments={analysis.outcomeCounts}
                  centreValue={String(analysis.calls)}
                  centreLabel="calls"
                />
              </section>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Pipeline */}
            <section className="card p-4">
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">Pipeline</h2>
                <span className="text-[11px] text-faint">{leads.length} leads total</span>
              </div>
              <BarChart
                horizontal
                data={analysis.pipeline}
                emptyMessage="No leads to break down"
              />
            </section>

            {/* Campaign performance */}
            <section className="card overflow-hidden">
              <div className="flex items-baseline justify-between gap-2 border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold text-ink">Campaigns</h2>
                <span className="text-[11px] text-faint">last {rangeDays} days</span>
              </div>

              {analysis.campaignRows.length === 0 ? (
                <EmptyState
                  compact
                  icon={Target}
                  title="No campaigns"
                  description="Campaigns group leads so performance can be compared. Calls still work without one."
                  action={
                    <Link to="/campaigns" className="btn btn-secondary btn-sm">
                      Manage campaigns
                    </Link>
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-line text-[10px] uppercase tracking-wider text-faint">
                        <th className="px-4 py-2 font-semibold">Campaign</th>
                        <th className="px-2 py-2 text-right font-semibold">Leads</th>
                        <th className="px-2 py-2 text-right font-semibold">Calls</th>
                        <th className="px-2 py-2 text-right font-semibold">Connect</th>
                        <th className="px-4 py-2 text-right font-semibold">Won</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {analysis.campaignRows.slice(0, 6).map((row) => (
                        <tr key={row.id} className="transition-colors hover:bg-hover">
                          <td className="max-w-[12rem] px-4 py-2">
                            <span className="flex items-center gap-1.5">
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(
                                  row.status === "active" ? "success" : row.status === "paused" ? "warning" : "neutral",
                                )}`}
                              />
                              <span className="truncate font-medium text-ink">{row.name}</span>
                            </span>
                          </td>
                          <td className="tabular px-2 py-2 text-right text-muted">{row.leads}</td>
                          <td className="tabular px-2 py-2 text-right text-muted">{row.calls}</td>
                          <td
                            className={`tabular px-2 py-2 text-right font-semibold ${textClass(
                              row.connectRate >= 30 ? "success" : row.calls > 0 ? "warning" : "neutral",
                            )}`}
                          >
                            {row.calls > 0 ? `${row.connectRate}%` : "—"}
                          </td>
                          <td className="tabular px-4 py-2 text-right font-semibold text-ink">
                            {row.converted}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {analysis.unassignedCalls > 0 ? (
                <p className="border-t border-line px-4 py-2 text-[11px] text-faint">
                  {analysis.unassignedCalls} call{analysis.unassignedCalls === 1 ? "" : "s"} not
                  attributed to a campaign.
                </p>
              ) : null}
            </section>
          </div>

          {/* Recent activity */}
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <TrendingUp className="h-4 w-4 text-faint" />
                Recent activity
              </h2>
              <Link to="/history" className="btn btn-ghost btn-sm">
                All calls
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            {analysis.recent.length === 0 ? (
              <EmptyState compact icon={Activity} title="Nothing recorded yet" />
            ) : (
              <ol className="divide-y divide-line">
                {analysis.recent.map(({ log, at, lead }) => {
                  const tone = outcomeTone(log.outcome);
                  const name = lead
                    ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") ||
                      lead.company ||
                      "Unnamed lead"
                    : "Deleted lead";
                  return (
                    <li key={log.id} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-hover">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(tone)}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        {lead ? (
                          <Link
                            to={`/leads/${lead.id}`}
                            className="truncate text-[13px] font-medium text-ink hover:text-accent"
                          >
                            {name}
                          </Link>
                        ) : (
                          <span className="truncate text-[13px] font-medium text-faint">{name}</span>
                        )}
                        {log.notes ? (
                          <span className="block truncate text-[11px] text-faint">{log.notes}</span>
                        ) : null}
                      </span>
                      <span className={`chip shrink-0 !text-[10px] ${chipClass(tone)}`}>
                        {outcomeLabel(log.outcome)}
                      </span>
                      <span className="tabular w-14 shrink-0 text-right font-mono text-[11px] text-muted">
                        {log.duration_seconds > 0 ? formatMinutes(log.duration_seconds) : "—"}
                      </span>
                      <span className="tabular hidden w-24 shrink-0 text-right text-[11px] text-faint sm:block">
                        {new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}
