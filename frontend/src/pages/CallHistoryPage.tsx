import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Clock, Download, PhoneCall, Search, X } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { SkeletonRows } from "@/components/common/Skeleton";
import { useCallLogs } from "@/hooks/useCallLogs";
import { useLeads } from "@/hooks/useLeads";
import { leadName } from "@/lib/leads";
import { OUTCOMES, chipClass, dotClass, outcomeLabel, outcomeTone } from "@/lib/outcomes";
import { downloadCsv } from "@/lib/leads";
import type { Database } from "@/types/database";

type CallLog = Database["public"]["Tables"]["call_logs"]["Row"];

/**
 * Every call that has been recorded, newest first.
 *
 * This page previously fetched the leads it needed with its own second query
 * keyed on the call logs' lead ids, which meant two round trips and a second
 * place for row-level security to disagree. It reads the same lead list as
 * everything else now.
 *
 * It also printed `{duration_seconds}s`, so every unanswered call read "0s" and
 * every ring-out looked like a call that connected and immediately ended. Talk
 * time and ring time are different things and are shown as different things.
 */

const RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 0, label: "All time" },
] as const;

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Prefer the real start of the call over the moment the row was written. */
function callTime(log: CallLog): number | null {
  return timestamp(log.started_at) ?? timestamp(log.ended_at) ?? timestamp(log.created_at);
}

function formatDuration(totalSeconds: number | null): string {
  if (!totalSeconds || totalSeconds <= 0) return "—";
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatTotal(seconds: number): string {
  if (seconds <= 0) return "0m";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function when(value: number): string {
  const minutes = Math.round((Date.now() - value) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function CallHistoryPage() {
  const logsQuery = useCallLogs();
  const leadsQuery = useLeads();

  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [rangeDays, setRangeDays] = useState<number>(7);

  const logs = useMemo(() => logsQuery.data ?? [], [logsQuery.data]);
  const leads = useMemo(() => leadsQuery.data ?? [], [leadsQuery.data]);

  const leadById = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads]);

  const filtered = useMemo(() => {
    const cutoff = rangeDays > 0 ? Date.now() - rangeDays * 86_400_000 : 0;
    const query = search.trim().toLowerCase();

    return logs
      .map((log) => ({ log, at: callTime(log), lead: log.lead_id ? leadById.get(log.lead_id) : undefined }))
      .filter((entry) => {
        if (cutoff && (!entry.at || entry.at < cutoff)) return false;
        if (outcomeFilter !== "all" && entry.log.outcome !== outcomeFilter) return false;
        if (!query) return true;
        const name = entry.lead ? leadName(entry.lead).toLowerCase() : "";
        const number = (entry.log.sip_call_id ?? "").toLowerCase();
        return (
          name.includes(query) ||
          (entry.log.notes ?? "").toLowerCase().includes(query) ||
          number.includes(query)
        );
      })
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  }, [logs, leadById, search, outcomeFilter, rangeDays]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const answered = filtered.filter((entry) => entry.log.outcome === "answered").length;
    const seconds = filtered.reduce((sum, entry) => sum + (entry.log.duration_seconds ?? 0), 0);
    return {
      total,
      answered,
      connectRate: total > 0 ? Math.round((answered / total) * 100) : 0,
      seconds,
    };
  }, [filtered]);

  const hasFilters = Boolean(search.trim()) || outcomeFilter !== "all" || rangeDays !== 0;

  function clearFilters() {
    setSearch("");
    setOutcomeFilter("all");
    setRangeDays(0);
  }

  function handleExport() {
    if (filtered.length === 0) return;
    const header = ["When", "Lead", "Phone", "Outcome", "Talk seconds", "Direction", "SIP Call-ID", "Notes"];
    const rows = filtered.map(({ log, at, lead }) => [
      at ? new Date(at).toISOString() : "",
      lead ? leadName(lead) : "",
      lead?.phone ?? "",
      outcomeLabel(log.outcome),
      String(log.duration_seconds ?? 0),
      log.direction,
      log.sip_call_id ?? "",
      log.notes ?? "",
    ]);
    const csv = [header, ...rows]
      .map((cells) => cells.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","))
      .join("\r\n");
    downloadCsv(`call-history-${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${csv}`);
  }

  if (logsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Call history" />
        <div className="card overflow-hidden">
          <SkeletonRows rows={12} rowClassName="h-[52px]" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title="Call history"
        description={
          logs.length === 0
            ? "No calls recorded yet. Calls made from the workspace appear here with their outcome, talk time and SIP Call-ID."
            : `${stats.total} call${stats.total === 1 ? "" : "s"} shown · ${stats.connectRate}% connected · ${formatTotal(stats.seconds)} talk time`
        }
        actions={
          <button
            type="button"
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="btn btn-secondary btn-sm"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Lead, notes or Call-ID"
              aria-label="Search call history"
              className="input !pl-8"
            />
          </div>

          <div className="flex rounded-lg border border-line bg-panel p-0.5" role="group" aria-label="Date range">
            {RANGES.map((range) => (
              <button
                key={range.label}
                type="button"
                onClick={() => setRangeDays(range.days)}
                aria-pressed={rangeDays === range.days}
                className={`rounded px-2.5 py-1 text-2xs font-semibold transition-colors ${
                  rangeDays === range.days
                    ? "bg-accent text-inverse"
                    : "text-muted hover:bg-hover hover:text-ink"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>

          {hasFilters ? (
            <button type="button" onClick={clearFilters} className="btn btn-ghost btn-sm animate-fade-in">
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          ) : null}
        </div>

        {/* Outcome filter as chips: seven options are too few for a dropdown and
            too useful to hide inside one. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOutcomeFilter("all")}
            aria-pressed={outcomeFilter === "all"}
            className={`chip border transition-colors ${
              outcomeFilter === "all"
                ? "border-accent bg-accent/12 text-accent"
                : "border-line bg-panel text-muted hover:bg-hover hover:text-ink"
            }`}
          >
            All
          </button>
          {OUTCOMES.map((outcome) => {
            const active = outcomeFilter === outcome.value;
            return (
              <button
                key={outcome.value}
                type="button"
                onClick={() => setOutcomeFilter(active ? "all" : outcome.value)}
                aria-pressed={active}
                title={outcome.hint}
                className={`chip border transition-colors ${
                  active
                    ? `${chipClass(outcome.tone)} border-current`
                    : "border-line bg-panel text-muted hover:bg-hover hover:text-ink"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${dotClass(outcome.tone)}`} />
                {outcome.label}
              </button>
            );
          })}
        </div>
      </PageHeader>

      <section className="card overflow-hidden">
        {logsQuery.isError ? (
          <EmptyState
            tone="danger"
            icon={Activity}
            title="Could not load call history"
            description={logsQuery.error instanceof Error ? logsQuery.error.message : "The request failed."}
            action={
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void logsQuery.refetch()}>
                Try again
              </button>
            }
          />
        ) : filtered.length === 0 ? (
          logs.length === 0 ? (
            <EmptyState
              icon={PhoneCall}
              title="No calls yet"
              description="Once a call is dispositioned from the workspace it is recorded here with its outcome, talk time, notes and the SIP Call-ID that ties it to the provider's own record."
              action={
                <Link to="/workspace" className="btn btn-primary btn-sm">
                  Open the workspace
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={Search}
              title="Nothing matches"
              description={`${logs.length} call${logs.length === 1 ? "" : "s"} are recorded, but none match the filters applied.`}
              action={
                <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
                  Clear filters
                </button>
              }
            />
          )
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-line bg-inset px-4 py-2 text-2xs font-semibold uppercase tracking-wider text-faint">
              <span className="min-w-0 flex-1">Lead</span>
              <span className="w-28 shrink-0">Outcome</span>
              <span className="hidden w-20 shrink-0 text-right sm:block">Talk time</span>
              <span className="hidden w-24 shrink-0 text-right md:block">When</span>
            </div>

            <ol className="divide-y divide-line">
              {filtered.map(({ log, at, lead }) => {
                const tone = outcomeTone(log.outcome);
                return (
                  <li
                    key={log.id}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-hover"
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(tone)}`}
                      aria-hidden="true"
                    />

                    <span className="min-w-0 flex-1">
                      {lead ? (
                        <Link
                          to={`/leads/${lead.id}`}
                          className="block truncate text-sm font-medium text-ink transition-colors hover:text-accent"
                        >
                          {leadName(lead)}
                        </Link>
                      ) : (
                        <span className="block truncate text-sm font-medium text-faint">
                          Deleted lead
                        </span>
                      )}
                      <span className="flex items-center gap-2">
                        {lead?.phone ? (
                          <span className="tabular truncate font-mono text-2xs text-faint">
                            {lead.phone}
                          </span>
                        ) : null}
                        {log.notes ? (
                          <span className="truncate text-2xs text-muted" title={log.notes}>
                            {log.notes}
                          </span>
                        ) : null}
                      </span>
                    </span>

                    <span className={`chip w-28 shrink-0 justify-center !text-2xs ${chipClass(tone)}`}>
                      {outcomeLabel(log.outcome)}
                    </span>

                    <span className="tabular hidden w-20 shrink-0 text-right font-mono text-2xs text-muted sm:block">
                      {formatDuration(log.duration_seconds)}
                    </span>

                    <span className="tabular hidden w-24 shrink-0 text-right text-2xs text-faint md:block">
                      <Clock className="mr-1 inline h-3 w-3" />
                      {at ? when(at) : "—"}
                    </span>
                  </li>
                );
              })}
            </ol>

            <div className="flex items-center justify-between gap-2 border-t border-line bg-inset px-4 py-2 text-2xs text-faint">
              <span className="tabular">
                {filtered.length} row{filtered.length === 1 ? "" : "s"} · {stats.answered} connected
              </span>
              <span className="tabular">{formatTotal(stats.seconds)} total talk time</span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
