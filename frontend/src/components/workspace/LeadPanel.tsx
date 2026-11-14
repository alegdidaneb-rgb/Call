import { Link } from "react-router-dom";
import {
  Building2,
  ExternalLink,
  FileText,
  History,
  Mail,
  MapPin,
  Phone,
  UserRound,
} from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/common/Skeleton";
import { useCallLog } from "@/hooks/useCallLogs";
import { parseObjections, useScriptFor } from "@/hooks/useScripts";
import {
  chipClass,
  dotClass,
  outcomeLabel,
  outcomeTone,
  statusLabel,
  statusTone,
  textClass,
} from "@/lib/outcomes";
import { leadName } from "@/lib/leads";
import { flagEmoji } from "@/data/countries";
import type { Database } from "@/types/database";

type Lead = Database["public"]["Tables"]["leads"]["Row"];

/**
 * Everything an agent needs about the lead in front of them, without leaving the
 * workspace.
 *
 * The previous layout put this on a separate page, which meant every call cost a
 * navigation. Here the identity, the number that will be dialled, what happened
 * last time and what to say are all one scroll away from the dial button.
 *
 * The script comes from the `call_scripts` table resolved against the lead's
 * campaign. If there is no script, this says so — the page it replaces rendered a
 * hardcoded sample, which reads as guidance an administrator never wrote.
 */

/** Compact relative time. Absolute timestamps are on the full record. */
function ago(value: string | null): string {
  if (!value) return "never";
  const then = Date.parse(value);
  if (!Number.isFinite(then)) return "unknown";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

function formatDuration(totalSeconds: number | null): string {
  if (!totalSeconds || totalSeconds <= 0) return "—";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

interface LeadPanelProps {
  lead: Lead | null;
  campaignName: string | null;
  isLoadingQueue: boolean;
}

function Detail({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
  href?: string;
}) {
  const body = (
    <>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
      <span className="min-w-0 flex-1">
        <span className="block text-2xs font-semibold uppercase tracking-wider text-faint">
          {label}
        </span>
        <span className="block truncate text-sm text-ink" title={value ?? undefined}>
          {value || "—"}
        </span>
      </span>
    </>
  );

  if (href && value) {
    return (
      <a
        href={href}
        className="flex items-start gap-2 rounded-lg border border-line bg-inset px-2.5 py-2 transition-colors hover:border-line-strong hover:bg-hover"
      >
        {body}
        <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-faint" />
      </a>
    );
  }
  return <div className="flex items-start gap-2 rounded-lg border border-line bg-inset px-2.5 py-2">{body}</div>;
}

export function LeadPanel({ lead, campaignName, isLoadingQueue }: LeadPanelProps) {
  const history = useCallLog(lead?.id ?? "");
  const { script, isLoading: scriptLoading, isExactMatch } = useScriptFor(lead?.campaign_id);

  if (isLoadingQueue) {
    return (
      <section className="pane flex-none lg:min-w-0 lg:flex-1" aria-label="Lead" aria-busy="true">
        <div className="space-y-4 p-4">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-36" />
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-14" />
            ))}
          </div>
          <Skeleton className="h-32" />
        </div>
      </section>
    );
  }

  if (!lead) {
    return (
      <section className="pane flex-none lg:min-w-0 lg:flex-1" aria-label="Lead">
        <EmptyState
          icon={UserRound}
          title="No lead selected"
          description="Pick a lead from the queue, or press the down arrow to start at the top. Everything you need to work the call is on this screen."
        />
      </section>
    );
  }

  const tone = statusTone(lead.status);
  const objections = parseObjections(script?.objection_responses ?? null);
  const calls = history.data ?? [];

  return (
    <section className="pane flex-none lg:min-w-0 lg:flex-1" aria-label={leadName(lead)}>
      <div className="pane-head !px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="pane-title">Lead</span>
          {campaignName ? (
            <span className="truncate text-2xs text-faint">· {campaignName}</span>
          ) : null}
        </div>
        <Link
          to={`/leads/${lead.id}`}
          className="btn btn-ghost btn-sm shrink-0"
          title="Open the full record"
        >
          Full record
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      <div className="pane-body">
        <div className="space-y-4 p-4">
          {/* Identity */}
          <header className="animate-rise-in">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-ink">{leadName(lead)}</h2>
              {lead.country ? (
                <span className="text-base leading-none" title={lead.country} aria-hidden="true">
                  {flagEmoji(lead.country)}
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={`chip ${chipClass(tone)}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${dotClass(tone)}`} />
                {statusLabel(lead.status)}
              </span>
              {lead.company ? (
                <span className="chip bg-hover text-muted">
                  <Building2 className="h-3 w-3" />
                  {lead.company}
                </span>
              ) : null}
              <span className="chip bg-hover text-muted tabular">
                <Phone className="h-3 w-3" />
                {lead.call_count ?? 0} call{(lead.call_count ?? 0) === 1 ? "" : "s"}
              </span>
              <span className="chip bg-hover text-muted">
                <History className="h-3 w-3" />
                last {ago(lead.last_called_at)}
              </span>
            </div>
          </header>

          {/* Contact */}
          <div className="grid gap-2 sm:grid-cols-2">
            <Detail icon={Phone} label="Phone" value={lead.phone} href={lead.phone ? `tel:${lead.phone}` : undefined} />
            <Detail icon={Mail} label="Email" value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
            <Detail
              icon={MapPin}
              label="Location"
              value={[lead.city, lead.state, lead.zip].filter(Boolean).join(", ") || null}
            />
            <Detail icon={Building2} label="Source" value={lead.source} />
          </div>

          {/* Script */}
          <div className="card overflow-hidden animate-rise-in">
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
              <h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
                <FileText className="h-3.5 w-3.5" />
                Call script
              </h3>
              {script ? (
                <span className="truncate text-2xs text-faint">
                  {isExactMatch ? "for this campaign" : "general"}
                </span>
              ) : null}
            </div>

            {scriptLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-11/12" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            ) : script ? (
              <div className="space-y-3 p-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{script.title}</p>
                  {script.category ? (
                    <p className="mt-0.5 text-2xs font-semibold uppercase tracking-wider text-faint">
                      {script.category}
                    </p>
                  ) : null}
                </div>
                <p className="max-h-56 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-muted">
                  {script.content}
                </p>
                {objections.length > 0 ? (
                  <div className="space-y-1.5 border-t border-line pt-2.5">
                    <p className="text-2xs font-semibold uppercase tracking-wider text-faint">
                      If they object
                    </p>
                    {objections.map((entry) => (
                      <details key={entry.objection} className="group rounded-lg bg-inset px-2.5 py-1.5">
                        <summary className="cursor-pointer list-none text-xs font-semibold text-ink marker:content-none">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate capitalize">{entry.objection}</span>
                            <span className="shrink-0 text-2xs text-faint transition-transform group-open:rotate-90">
                              ›
                            </span>
                          </span>
                        </summary>
                        <p className="mt-1.5 text-xs leading-relaxed text-muted">{entry.response}</p>
                        {entry.category ? (
                          <p className="mt-1 text-2xs font-semibold uppercase tracking-wider text-faint">
                            {entry.category}
                          </p>
                        ) : null}
                      </details>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="px-3 py-4 text-center text-xs leading-relaxed text-faint">
                No script has been written for this campaign.{" "}
                <Link to="/scripts" className="font-semibold text-accent underline underline-offset-2">
                  Add one
                </Link>{" "}
                and it will appear here for every lead in it.
              </p>
            )}
          </div>

          {/* History */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
              <h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
                <History className="h-3.5 w-3.5" />
                Previous calls
              </h3>
              <span className="tabular text-2xs text-faint">{calls.length}</span>
            </div>

            {history.isLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : calls.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-faint">
                Never called. This is the first attempt.
              </p>
            ) : (
              <ol className="divide-y divide-line">
                {calls.slice(0, 6).map((call) => {
                  const callTone = outcomeTone(call.outcome);
                  return (
                    <li key={call.id} className="flex items-start gap-2.5 px-3 py-2">
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(callTone)}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className={`text-xs font-semibold ${textClass(callTone)}`}>
                            {outcomeLabel(call.outcome)}
                          </span>
                          <span className="tabular text-2xs text-faint">
                            {ago(call.started_at ?? call.created_at)} ·{" "}
                            {formatDuration(call.duration_seconds)}
                          </span>
                        </span>
                        {call.notes ? (
                          <span className="mt-0.5 block truncate text-2xs text-muted" title={call.notes}>
                            {call.notes}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
