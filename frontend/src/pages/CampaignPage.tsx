import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { ArrowRight, Pencil, Plus, Search, Target, Trash2 } from "lucide-react";
import { CampaignForm, type CampaignFormValues } from "@/components/campaigns/CampaignForm";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { SkeletonCards } from "@/components/common/Skeleton";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useCallLogs } from "@/hooks/useCallLogs";
import {
  useCampaigns,
  useCreateCampaign,
  useDeleteCampaign,
  useUpdateCampaign,
} from "@/hooks/useCampaigns";
import { useLeads } from "@/hooks/useLeads";
import type { CampaignRow } from "@/lib/apiClient";
import { outcomeLabel } from "@/lib/outcomes";

/**
 * Campaigns.
 *
 * The page used to list a name, a type and a creation date — three facts that
 * describe the record rather than the work. It also had an Edit button that set
 * state nothing ever read, so clicking it did nothing at all, and it ran its own
 * copy of the campaigns query instead of the shared hook, which meant the list
 * and the dropdowns on the Leads page could disagree after an edit.
 *
 * A campaign card now answers the question an operator actually has about it:
 * how many leads are in it, how far through them the team is, how often calls
 * connected, and when it was last worked. Edit goes through the shared update
 * mutation, and "View leads" deep-links into the Leads page filtered to that
 * campaign.
 */

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
] as const;

interface CampaignStats {
  leads: number;
  worked: number;
  answered: number;
  calls: number;
  converted: number;
  lastActivity: string | null;
}

/** `answered` and `converted` are the two numbers a campaign is judged on. */
function statsFor(
  campaignId: string,
  leads: { campaign_id: string | null; status: string | null; call_count: number | null; updated_at: string | null }[],
  logs: { campaign_id: string | null; outcome: string | null; started_at: string | null; created_at: string | null }[],
): CampaignStats {
  const campaignLeads = leads.filter((lead) => lead.campaign_id === campaignId);
  const campaignLogs = logs.filter((log) => log.campaign_id === campaignId);

  const stamps = [...campaignLeads.map((lead) => lead.updated_at), ...campaignLogs.map((log) => log.started_at ?? log.created_at)]
    .filter((value): value is string => Boolean(value))
    .sort();

  return {
    leads: campaignLeads.length,
    worked: campaignLeads.filter((lead) => (lead.call_count ?? 0) > 0 || lead.status !== "new").length,
    answered: campaignLogs.filter((log) => log.outcome === "answered").length,
    calls: campaignLogs.length,
    converted: campaignLeads.filter((lead) => lead.status === "converted").length,
    lastActivity: stamps.length ? stamps[stamps.length - 1] : null,
  };
}

function relative(iso: string | null): string {
  if (!iso) return "never worked";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never worked";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wide text-faint">{label}</dt>
      <dd className={`tabular mt-0.5 font-semibold ${emphasis ? "text-base text-ink" : "text-sm text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}

export function CampaignPage() {
  const campaignsQuery = useCampaigns();
  const leadsQuery = useLeads();
  const callLogsQuery = useCallLogs();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CampaignRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CampaignRow | null>(null);

  const campaigns = useMemo(() => campaignsQuery.data ?? [], [campaignsQuery.data]);
  const leads = useMemo(() => leadsQuery.data ?? [], [leadsQuery.data]);
  const logs = useMemo(() => callLogsQuery.data ?? [], [callLogsQuery.data]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return campaigns.filter((campaign) => {
      if (statusFilter !== "all" && campaign.status !== statusFilter) return false;
      return !query || campaign.name.toLowerCase().includes(query);
    });
  }, [campaigns, search, statusFilter]);

  const isFiltered = Boolean(search.trim()) || statusFilter !== "all";

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(campaign: CampaignRow) {
    setEditing(campaign);
    setFormOpen(true);
  }

  async function handleSubmit(values: CampaignFormValues) {
    if (editing) {
      await updateCampaign.mutateAsync({ id: editing.id, ...values });
      toast.success(`Saved ${values.name}`);
    } else {
      await createCampaign.mutateAsync(values);
      toast.success(`Created ${values.name}`);
    }
    setFormOpen(false);
    setEditing(null);
  }

  async function handleDelete(campaign: CampaignRow) {
    try {
      await deleteCampaign.mutateAsync(campaign.id);
      toast.success(`Deleted ${campaign.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the campaign");
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="Campaigns"
        description={
          campaigns.length === 0
            ? "No campaigns yet — leads can still be added without one, but nothing can be compared or reported on separately."
            : `${filtered.length} of ${campaigns.length} shown · group leads so their performance can be compared and each group can carry its own call script`
        }
        actions={
          <button type="button" onClick={openCreate} className="btn btn-primary btn-sm">
            <Plus className="h-3.5 w-3.5" />
            New campaign
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
              placeholder="Search campaigns"
              aria-label="Search campaigns"
              className="input !pl-8"
            />
          </div>

          <div className="flex rounded-lg border border-line bg-panel p-0.5" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatusFilter(option.value)}
                aria-pressed={statusFilter === option.value}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                  statusFilter === option.value
                    ? "bg-accent text-inverse"
                    : "text-muted hover:bg-hover hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </PageHeader>

      {campaignsQuery.isLoading ? (
        <SkeletonCards cards={3} />
      ) : filtered.length === 0 ? (
        isFiltered ? (
          <EmptyState
            icon={Search}
            title="No campaigns match"
            description="Nothing matches that search and status together. Clear the filters to see the full list."
            action={
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                }}
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={Target}
            title="No campaigns yet"
            description="A campaign groups leads so their results can be compared, and can carry its own call script for agents to read while dialling."
            action={
              <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" />
                New campaign
              </button>
            }
          />
        )
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((campaign) => {
            const stats = statsFor(campaign.id, leads, logs);
            const connectRate = stats.calls > 0 ? Math.round((stats.answered / stats.calls) * 100) : null;
            const coverage = stats.leads > 0 ? Math.round((stats.worked / stats.leads) * 100) : null;

            return (
              <li key={campaign.id} className="card flex flex-col p-4 transition-shadow hover:shadow-raised">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-ink" title={campaign.name}>
                      {campaign.name}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted">
                      {campaign.type.charAt(0).toUpperCase() + campaign.type.slice(1)} ·{" "}
                      {relative(campaign.updated_at ?? campaign.created_at)}
                    </p>
                  </div>
                  <StatusBadge status={campaign.status} kind="campaign" />
                </div>

                {/* Progress through the leads in this campaign. Hidden when
                    there is nothing to measure rather than showing an empty bar. */}
                {coverage !== null ? (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-2xs text-faint">
                      <span className="uppercase tracking-wide">Worked</span>
                      <span className="tabular">
                        {stats.worked} of {stats.leads}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hover" role="presentation">
                      <div
                        className="h-full rounded-full bg-accent transition-all"
                        style={{ width: `${coverage}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
                  <Metric label="Leads" value={String(stats.leads)} />
                  <Metric
                    label="Connect rate"
                    value={connectRate === null ? "—" : `${connectRate}%`}
                    emphasis
                  />
                  <Metric label="Converted" value={String(stats.converted)} />
                </dl>

                <p className="mt-2 text-2xs text-faint">
                  {stats.calls === 0
                    ? "No calls recorded against this campaign yet"
                    : `${stats.calls} call${stats.calls === 1 ? "" : "s"} · ${stats.answered} ${outcomeLabel("answered").toLowerCase()}`}
                </p>

                <div className="mt-4 flex items-center gap-1 border-t border-line pt-3">
                  <Link
                    to={`/leads?campaign=${campaign.id}`}
                    className="btn btn-ghost btn-sm flex-1 justify-start"
                  >
                    View leads
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => openEdit(campaign)}
                    className="btn btn-ghost btn-sm"
                    aria-label={`Edit ${campaign.name}`}
                    title="Edit campaign"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(campaign)}
                    className="btn btn-ghost btn-sm text-danger hover:bg-danger/12 hover:text-danger"
                    aria-label={`Delete ${campaign.name}`}
                    title="Delete campaign"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CampaignForm
        open={formOpen}
        campaign={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete campaign"
        message={`Delete ${pendingDelete?.name ?? "this campaign"}? The leads in it are kept; they become unassigned.`}
        variant="danger"
        confirmLabel="Delete campaign"
        onConfirm={() => pendingDelete && handleDelete(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
