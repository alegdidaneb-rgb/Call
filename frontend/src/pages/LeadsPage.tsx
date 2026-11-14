import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Download,
  Filter,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { LeadGrid } from "@/components/leads/LeadGrid";
import { CsvImport } from "@/components/leads/CsvImport";
import { LeadForm } from "@/components/leads/LeadForm";
import { useCampaigns } from "@/hooks/useCampaigns";
import {
  useCreateLead,
  useCreateLeads,
  useDeleteLead,
  useLeads,
  useUpdateLead,
} from "@/hooks/useLeads";
import {
  downloadCsv,
  leadsToCsv,
  matchesLead,
  sortLeads,
  type SortDirection,
  type SortKey,
} from "@/lib/leads";
import { pushOverlay } from "@/lib/keys";
import { statusLabel } from "@/lib/outcomes";
import type { Database } from "@/types/database";

type Lead = Database["public"]["Tables"]["leads"]["Row"];
type LeadStatus = Lead["status"];
type NewLead = Omit<Lead, "id" | "created_at" | "updated_at" | "call_count">;

/**
 * The lead list.
 *
 * This is the "conventional page" half of the interface: everything an
 * administrator does to the data rather than the calls an agent makes from it.
 * Dialling lives in the workspace, so this page's job is to get leads in, keep
 * them accurate, and get them out again — which is why import and export are
 * first-class here rather than hidden in a row menu.
 *
 * The export button on the page this replaces was an imported icon with no
 * handler. It downloads now, and it honours the filters: exporting what you can
 * see is what "export" means to somebody who has just narrowed a list.
 */

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Every status" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "interested", label: "Interested" },
  { value: "callback", label: "Callback" },
  { value: "not_interested", label: "Not interested" },
  { value: "converted", label: "Converted" },
  { value: "do_not_contact", label: "Do not contact" },
  { value: "dnc", label: "Do-not-contact flag" },
];

export function LeadsPage() {
  const navigate = useNavigate();
  const leadsQuery = useLeads();
  const campaignsQuery = useCampaigns();
  const createLead = useCreateLead();
  const createLeads = useCreateLeads();
  const updateLead = useUpdateLead();
  const deleteLead = useDeleteLead();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [bulkDelete, setBulkDelete] = useState(false);

  const leads = useMemo(() => leadsQuery.data ?? [], [leadsQuery.data]);
  const campaigns = useMemo(() => campaignsQuery.data ?? [], [campaignsQuery.data]);

  // Only offer countries that are actually in the data. A 250-entry list of which
  // one is used would be a control that looks useful and is not.
  const countries = useMemo(() => {
    const present = new Map<string, number>();
    for (const lead of leads) {
      if (!lead.country) continue;
      present.set(lead.country, (present.get(lead.country) ?? 0) + 1);
    }
    return [...present.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [leads]);

  const filtered = useMemo(() => {
    const rows = leads.filter((lead) => {
      if (!matchesLead(lead, search)) return false;
      if (statusFilter === "dnc") {
        if (!lead.dnc && lead.status !== "do_not_contact") return false;
      } else if (statusFilter !== "all" && lead.status !== statusFilter) {
        return false;
      }
      if (campaignFilter !== "all" && lead.campaign_id !== campaignFilter) return false;
      if (countryFilter !== "all" && lead.country !== countryFilter) return false;
      return true;
    });
    return sortLeads(rows, sortKey, sortDirection);
  }, [leads, search, statusFilter, campaignFilter, countryFilter, sortKey, sortDirection]);

  const hasFilters =
    Boolean(search.trim()) || statusFilter !== "all" || campaignFilter !== "all" || countryFilter !== "all";

  const clearFilters = useCallback(() => {
    setSearch("");
    setStatusFilter("all");
    setCampaignFilter("all");
    setCountryFilter("all");
  }, []);

  const handleSortChange = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        // Text reads better ascending, counts and dates better descending.
        setSortDirection(key === "name" || key === "company" || key === "country" ? "asc" : "desc");
      }
    },
    [sortKey],
  );

  const handleToggleSelect = useCallback((id: string, isRange: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      // Extending a range adds; a plain click toggles.
      if (isRange) next.add(id);
      else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds((current) => {
      const everyRowSelected = filtered.length > 0 && filtered.every((lead) => current.has(lead.id));
      return everyRowSelected ? new Set() : new Set(filtered.map((lead) => lead.id));
    });
  }, [filtered]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Drop selections that no longer exist, so a bulk action can never act on a
  // lead that was deleted in another tab.
  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      const alive = new Set([...current].filter((id) => leads.some((lead) => lead.id === id)));
      return alive.size === current.size ? current : alive;
    });
  }, [leads]);

  const selectedLeads = useMemo(
    () => filtered.filter((lead) => selectedIds.has(lead.id)),
    [filtered, selectedIds],
  );

  async function handleStatusChange(lead: Lead, status: LeadStatus) {
    if (lead.status === status) return;
    const previous = lead.status;
    try {
      await updateLead.mutateAsync({
        id: lead.id,
        status,
        // The do-not-contact flag and the status are two representations of one
        // decision. Leaving them out of step means the lead stays out of the
        // queue but looks callable in the list.
        dnc: status === "do_not_contact" ? true : lead.dnc,
      });
      toast.success(`${statusLabel(status)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the lead");
      // Put the control back rather than leaving it showing a value that was
      // never written.
      void updateLead.mutateAsync({ id: lead.id, status: previous }).catch(() => undefined);
    }
  }

  async function handleBulkStatus(status: LeadStatus) {
    const targets = selectedLeads;
    if (targets.length === 0) return;
    try {
      await Promise.all(
        targets.map((lead) =>
          updateLead.mutateAsync({ id: lead.id, status, dnc: status === "do_not_contact" ? true : lead.dnc }),
        ),
      );
      toast.success(`${targets.length} lead${targets.length === 1 ? "" : "s"} marked ${statusLabel(status).toLowerCase()}`);
      clearSelection();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update every selected lead");
    }
  }

  async function handleBulkDnc() {
    const targets = selectedLeads;
    if (targets.length === 0) return;
    try {
      await Promise.all(
        targets.map((lead) =>
          updateLead.mutateAsync({ id: lead.id, dnc: true, status: "do_not_contact" }),
        ),
      );
      toast.success(
        `${targets.length} lead${targets.length === 1 ? "" : "s"} added to the do-not-contact list`,
      );
      clearSelection();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update every selected lead");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteLead.mutateAsync(deleteTarget.id);
      toast.success("Lead deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the lead");
    } finally {
      setDeleteTarget(null);
    }
  }

  async function handleBulkDelete() {
    const targets = selectedLeads;
    try {
      await Promise.all(targets.map((lead) => deleteLead.mutateAsync(lead.id)));
      toast.success(`${targets.length} lead${targets.length === 1 ? "" : "s"} deleted`);
      clearSelection();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete every selected lead");
    } finally {
      setBulkDelete(false);
    }
  }

  function handleExport() {
    const rows = selectedLeads.length > 0 ? selectedLeads : filtered;
    if (rows.length === 0) {
      toast.error("There is nothing to export");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`leads-${stamp}.csv`, leadsToCsv(rows));
    toast.success(
      `Exported ${rows.length} lead${rows.length === 1 ? "" : "s"}${
        selectedLeads.length > 0 ? " (selection)" : hasFilters ? " (filtered)" : ""
      }`,
    );
  }

  const dialogOpen = showForm || showImport || Boolean(deleteTarget) || bulkDelete;
  useEffect(() => (dialogOpen ? pushOverlay() : undefined), [dialogOpen]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Leads</h1>
          <p className="mt-1 text-sm text-muted">
            {leads.length === 0
              ? "Nothing here yet — add a lead or import a file"
              : `${filtered.length} of ${leads.length} shown${
                  leadsQuery.isFetching ? " · updating" : ""
                }`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleExport} className="btn btn-secondary btn-sm">
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
          <button type="button" onClick={() => setShowImport(true)} className="btn btn-secondary btn-sm">
            <Upload className="h-3.5 w-3.5" />
            Import
          </button>
          <button type="button" onClick={() => setShowForm(true)} className="btn btn-primary btn-sm">
            <Plus className="h-3.5 w-3.5" />
            Add lead
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, company, phone, city, tag…"
            aria-label="Search leads"
            className="input !pl-8"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label="Filter by status"
          className="input !w-auto"
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          value={campaignFilter}
          onChange={(event) => setCampaignFilter(event.target.value)}
          aria-label="Filter by campaign"
          className="input !w-auto"
        >
          <option value="all">Every campaign</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>

        {countries.length > 1 ? (
          <select
            value={countryFilter}
            onChange={(event) => setCountryFilter(event.target.value)}
            aria-label="Filter by country"
            className="input !w-auto"
          >
            <option value="all">Every country</option>
            {countries.map(([code, count]) => (
              <option key={code} value={code}>
                {code} · {count}
              </option>
            ))}
          </select>
        ) : null}

        {hasFilters ? (
          <button type="button" onClick={clearFilters} className="btn btn-ghost btn-sm animate-fade-in">
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] text-faint">
            <Filter className="h-3 w-3" />
            No filters
          </span>
        )}
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent/12 px-3 py-2 animate-rise-in">
          <span className="tabular text-[12px] font-semibold text-accent">
            {selectedIds.size} selected
          </span>
          <span className="hidden h-4 w-px bg-accent/30 sm:block" />

          <select
            value=""
            onChange={(event) => {
              if (event.target.value) void handleBulkStatus(event.target.value as LeadStatus);
            }}
            aria-label="Set status for the selection"
            className="input !w-auto !py-1 !text-[12px]"
          >
            <option value="">Set status…</option>
            {STATUS_FILTERS.filter((option) => option.value !== "all" && option.value !== "dnc").map(
              (option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ),
            )}
          </select>

          <button type="button" onClick={() => void handleBulkDnc()} className="btn btn-secondary btn-sm">
            Do not contact
          </button>
          <button type="button" onClick={() => void handleExport()} className="btn btn-secondary btn-sm">
            <Download className="h-3.5 w-3.5" />
            Export these
          </button>
          <button type="button" onClick={() => setBulkDelete(true)} className="btn btn-danger btn-sm">
            Delete
          </button>

          <button type="button" onClick={clearSelection} className="btn btn-ghost btn-sm ml-auto">
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      ) : null}

      <LeadGrid
        leads={filtered}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleSelect}
        onSelectAll={handleSelectAll}
        onStatusChange={(lead, status) => void handleStatusChange(lead, status)}
        onOpen={(lead) => navigate(`/leads/${lead.id}`)}
        onDelete={(lead) =>
          setDeleteTarget({
            id: lead.id,
            name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.company || "this lead",
          })
        }
        isLoading={leadsQuery.isLoading}
        hasFilters={hasFilters}
        onClearFilters={clearFilters}
      />

      {showForm ? (
        <LeadForm
          onClose={() => setShowForm(false)}
          onSubmit={async (data) => {
            try {
              await createLead.mutateAsync(data as unknown as NewLead);
              toast.success("Lead added");
              setShowForm(false);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not add the lead");
            }
          }}
        />
      ) : null}

      {showImport ? (
        <CsvImport
          onClose={() => setShowImport(false)}
          onImport={async (rows) => {
            try {
              const created = await createLeads.mutateAsync(rows as unknown as NewLead[]);
              toast.success(`Imported ${created.length || rows.length} lead${rows.length === 1 ? "" : "s"}`);
              setShowImport(false);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "The import failed");
              throw error;
            }
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete lead"
        message={`Delete "${deleteTarget?.name}"? Their call history stays, but the lead cannot be dialled again and this cannot be undone.`}
        variant="danger"
        confirmLabel="Delete"
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={bulkDelete}
        title={`Delete ${selectedIds.size} leads`}
        message="Every selected lead will be removed. Their call history stays, but they cannot be dialled again and this cannot be undone."
        variant="danger"
        confirmLabel="Delete all"
        onConfirm={() => void handleBulkDelete()}
        onCancel={() => setBulkDelete(false)}
      />
    </div>
  );
}
