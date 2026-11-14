import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Minus,
  PhoneOff,
  Trash2,
  Users,
} from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { SkeletonRows } from "@/components/common/Skeleton";
import { leadInitials, leadName } from "@/lib/leads";
import { chipClass, dotClass, statusTone } from "@/lib/outcomes";
import { flagEmoji } from "@/data/countries";
import type { SortDirection, SortKey } from "@/lib/leads";
import type { Database } from "@/types/database";

type Lead = Database["public"]["Tables"]["leads"]["Row"];
type LeadStatus = Database["public"]["Tables"]["leads"]["Row"]["status"];

/**
 * The lead list as a data grid.
 *
 * What this replaces was a `<table>` with padding: it could not be sorted, it
 * rendered every row at once, it had no notion of selecting more than one lead,
 * and its status control was a full-size `<select>` in every row. Those are the
 * four things that make a records screen feel like a spreadsheet somebody's
 * cousin built, so those are the four things addressed.
 *
 * Rows are windowed on a fixed pixel height for the same reason as the queue, and
 * arrow-key navigation is handled on the grid itself rather than globally: a grid
 * should respond to the keyboard when it has focus, and a page-level binding
 * would fight with the filters above it.
 */

const ROW_HEIGHT = 46;
const OVERSCAN = 10;

const COLUMNS: Array<{ key: SortKey | null; label: string; className: string }> = [
  { key: "name", label: "Lead", className: "min-w-0 flex-1" },
  { key: "company", label: "Company", className: "hidden w-40 shrink-0 md:block" },
  { key: "phone", label: "Phone", className: "hidden w-40 shrink-0 lg:block" },
  { key: "country", label: "", className: "hidden w-12 shrink-0 xl:block" },
  { key: "status", label: "Status", className: "w-36 shrink-0" },
  { key: "calls", label: "Calls", className: "hidden w-16 shrink-0 text-right sm:block" },
  { key: "lastCalled", label: "Last called", className: "hidden w-28 shrink-0 text-right lg:block" },
  { key: null, label: "", className: "w-16 shrink-0" },
];

const STATUS_OPTIONS: Array<{ value: LeadStatus; label: string }> = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "interested", label: "Interested" },
  { value: "callback", label: "Callback" },
  { value: "not_interested", label: "Not interested" },
  { value: "converted", label: "Converted" },
  { value: "do_not_contact", label: "Do not contact" },
];

function relativeDay(value: string | null): string {
  if (!value) return "never";
  const then = Date.parse(value);
  if (!Number.isFinite(then)) return "—";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

interface LeadGridProps {
  leads: Lead[];
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSortChange: (key: SortKey) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, range: boolean) => void;
  onSelectAll: () => void;
  onStatusChange: (lead: Lead, status: LeadStatus) => void;
  onOpen: (lead: Lead) => void;
  onDelete: (lead: Lead) => void;
  isLoading: boolean;
  hasFilters: boolean;
  onClearFilters: () => void;
}

export function LeadGrid({
  leads,
  sortKey,
  sortDirection,
  onSortChange,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onStatusChange,
  onOpen,
  onDelete,
  isLoading,
  hasFilters,
  onClearFilters,
}: LeadGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(520);
  const [activeIndex, setActiveIndex] = useState(-1);
  /** Anchor for shift-click range selection. */
  const anchorIndex = useRef(-1);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientHeight));
    observer.observe(element);
    setViewport(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || activeIndex < 0) return;
    const top = activeIndex * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
    }
  }, [activeIndex]);

  // A sort or filter change invalidates the cursor position.
  useEffect(() => {
    setActiveIndex(-1);
    anchorIndex.current = -1;
  }, [sortKey, sortDirection, leads.length]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(leads.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  const visible = leads.slice(start, end);

  const allSelected = leads.length > 0 && leads.every((lead) => selectedIds.has(lead.id));
  const someSelected = leads.some((lead) => selectedIds.has(lead.id));

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (leads.length === 0) return;
    if (event.key === "ArrowDown" || (event.key === "j" && !event.metaKey && !event.ctrlKey)) {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, leads.length - 1));
    } else if (event.key === "ArrowUp" || event.key === "k") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && leads[activeIndex]) onOpen(leads[activeIndex]);
    } else if (event.key === " ") {
      event.preventDefault();
      if (activeIndex >= 0 && leads[activeIndex]) onToggleSelect(leads[activeIndex].id, false);
    }
  }

  function handleRowClick(index: number, event: React.MouseEvent) {
    setActiveIndex(index);
    if (event.shiftKey && anchorIndex.current >= 0) {
      const from = Math.min(anchorIndex.current, index);
      const to = Math.max(anchorIndex.current, index);
      for (let cursor = from; cursor <= to; cursor += 1) {
        const lead = leads[cursor];
        if (lead && !selectedIds.has(lead.id)) onToggleSelect(lead.id, true);
      }
      return;
    }
    anchorIndex.current = index;
  }

  return (
    <section className="card flex min-h-[20rem] flex-1 flex-col overflow-hidden">
      {/* Column headers */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-inset px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-faint">
        <span className="w-5 shrink-0">
          <button
            type="button"
            onClick={onSelectAll}
            disabled={leads.length === 0}
            aria-label={allSelected ? "Clear selection" : "Select every lead in view"}
            title={allSelected ? "Clear selection" : "Select every lead in view"}
            className="flex h-4 w-4 items-center justify-center rounded border border-line-strong bg-panel text-inverse transition-colors hover:border-accent disabled:opacity-40"
          >
            {allSelected ? (
              <span className="block h-2 w-2 rounded-sm bg-accent" />
            ) : someSelected ? (
              <Minus className="h-3 w-3 text-accent" />
            ) : null}
          </button>
        </span>

        {COLUMNS.map((column) => {
          const isSorted = column.key !== null && column.key === sortKey;
          const content = (
            <span className="flex items-center gap-1">
              {column.label}
              {isSorted ? (
                sortDirection === "asc" ? (
                  <ArrowUp className="h-3 w-3 text-accent" />
                ) : (
                  <ArrowDown className="h-3 w-3 text-accent" />
                )
              ) : null}
            </span>
          );
          return column.key ? (
            <button
              key={column.label || column.key}
              type="button"
              onClick={() => onSortChange(column.key as SortKey)}
              aria-sort={isSorted ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
              className={`${column.className} truncate text-left transition-colors hover:text-ink`}
              title={`Sort by ${column.label.toLowerCase()}`}
            >
              {content}
            </button>
          ) : (
            <span key={column.label || "spacer"} className={column.className} />
          );
        })}
      </div>

      {/* Rows */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="grid"
        aria-label="Leads"
        aria-rowcount={leads.length}
      >
        {isLoading ? (
          <SkeletonRows rows={12} rowClassName="h-[46px]" />
        ) : leads.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={Users}
              title="No leads match"
              description="Nothing in the list matches the filters currently applied."
              action={
                <button type="button" className="btn btn-secondary btn-sm" onClick={onClearFilters}>
                  Clear filters
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No leads yet"
              description="Add a lead by hand, or import a CSV. Once there are leads here they can be dialled from the workspace."
            />
          )
        ) : (
          <div style={{ height: leads.length * ROW_HEIGHT }} className="relative">
            <div
              style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}
              className="absolute inset-x-0 top-0"
            >
              {visible.map((lead, offset) => {
                const index = start + offset;
                const isSelected = selectedIds.has(lead.id);
                const isActive = index === activeIndex;
                const tone = statusTone(lead.status);
                const blocked = lead.dnc || lead.status === "do_not_contact";

                return (
                  <div
                    key={lead.id}
                    role="row"
                    aria-selected={isSelected}
                    style={{ height: ROW_HEIGHT }}
                    onClick={(event) => handleRowClick(index, event)}
                    onDoubleClick={() => onOpen(lead)}
                    className={`flex items-center gap-2 border-b border-line px-3 text-sm transition-colors duration-75 ${
                      isSelected
                        ? "row-selected"
                        : isActive
                          ? "bg-hover"
                          : blocked
                            ? "bg-inset/40 hover:bg-hover"
                            : "hover:bg-hover"
                    }`}
                  >
                    <span className="w-5 shrink-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => onToggleSelect(lead.id, false)}
                        aria-label={`Select ${leadName(lead)}`}
                        className="h-3.5 w-3.5 cursor-pointer rounded border-line-strong bg-panel"
                      />
                    </span>

                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-bold ${
                          isSelected ? "bg-accent text-inverse" : "bg-inset text-muted"
                        }`}
                        aria-hidden="true"
                      >
                        {leadInitials(lead)}
                      </span>
                      <span className="min-w-0">
                        <span
                          className={`block truncate font-medium ${blocked ? "text-muted line-through decoration-danger/60" : "text-ink"}`}
                        >
                          {leadName(lead)}
                        </span>
                        <span className="tabular block truncate font-mono text-2xs text-faint md:hidden">
                          {lead.phone || "no number"}
                        </span>
                      </span>
                      {blocked ? (
                        <PhoneOff
                          className="h-3 w-3 shrink-0 text-danger"
                          aria-label="Do not contact"
                        />
                      ) : null}
                    </span>

                    <span className="hidden w-40 shrink-0 truncate text-muted md:block">
                      {lead.company || "—"}
                    </span>

                    <span className="tabular hidden w-40 shrink-0 truncate font-mono text-xs text-muted lg:block">
                      {lead.phone || "—"}
                    </span>

                    <span
                      className="hidden w-12 shrink-0 text-sm xl:block"
                      title={lead.country ?? "No country recorded"}
                      aria-hidden="true"
                    >
                      {lead.country ? flagEmoji(lead.country) : ""}
                    </span>

                    <span className="w-36 shrink-0">
                      {/* Clicking the status changes it in place; opening the lead
                          is a separate action, so neither interferes. */}
                      <select
                        value={lead.status}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => onStatusChange(lead, event.target.value as LeadStatus)}
                        aria-label={`Status of ${leadName(lead)}`}
                        className={`chip w-full cursor-pointer appearance-none border-0 !px-2 !py-0.5 !text-2xs outline-none focus:ring-2 focus:ring-accent ${chipClass(tone)}`}
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value} className="bg-panel text-ink">
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </span>

                    <span className="tabular hidden w-16 shrink-0 text-right text-muted sm:block">
                      {lead.call_count ?? 0}
                    </span>

                    <span className="tabular hidden w-28 shrink-0 text-right text-2xs text-faint lg:block">
                      {relativeDay(lead.last_called_at)}
                    </span>

                    <span className="flex w-16 shrink-0 items-center justify-end gap-0.5">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(lead);
                        }}
                        aria-label={`Open ${leadName(lead)}`}
                        title="Open record"
                        className="rounded p-1 text-faint transition-colors hover:bg-hover hover:text-accent"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(lead);
                        }}
                        aria-label={`Delete ${leadName(lead)}`}
                        title="Delete"
                        className="rounded p-1 text-faint transition-colors hover:bg-danger/12 hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-inset px-3 py-1.5 text-2xs text-faint">
        <span className="tabular">
          {leads.length} row{leads.length === 1 ? "" : "s"}
          {selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}
        </span>
        <span className="hidden sm:inline">
          ↑↓ move · Enter open · Space select · shift-click a range
        </span>
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass(leads.length > 0 ? "success" : "neutral")}`} />
      </div>
    </section>
  );
}
