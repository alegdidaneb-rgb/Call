import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { AlertTriangle, PhoneOff, Search, Users } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { SkeletonRows } from "@/components/common/Skeleton";
import { chipClass, dotClass, statusLabel, statusTone } from "@/lib/outcomes";
import { leadInitials, leadName } from "@/lib/leads";
import { flagEmoji } from "@/data/countries";
import type { Database } from "@/types/database";

type Lead = Database["public"]["Tables"]["leads"]["Row"];

/**
 * The dialling queue: a dense, windowed list an agent can work entirely from the
 * keyboard.
 *
 * Rows are virtualised by hand rather than pulling in a library. A campaign can
 * hold tens of thousands of leads, and rendering all of them makes the pane
 * unusable long before it makes the page slow — but the whole point of the
 * workspace is that nothing leaves the loop, so a dependency that only helps at
 * scale is not worth its weight in the main chunk. The implementation is about
 * thirty lines because the rows are a fixed height.
 *
 * That fixed height is the one real constraint, and it is why the row uses
 * pixel-valued text sizes instead of the rem scale: `data-density` changes the
 * root font size, so a rem-sized row would change height under the virtualiser
 * and the scroll position would drift. Density still resizes everything else on
 * the screen.
 */

const ROW_HEIGHT = 58;
const OVERSCAN = 8;

interface LeadQueueProps {
  leads: Lead[];
  selectedId: string | null;
  selectedIndex: number;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  filterCount: number;
  onClearFilters: () => void;
  /** Ref so the workspace can focus the filter box from a shortcut. */
  searchRef: RefObject<HTMLInputElement>;
}

export function LeadQueue({
  leads,
  selectedId,
  selectedIndex,
  search,
  onSearchChange,
  onSelect,
  isLoading,
  isError,
  onRetry,
  filterCount,
  onClearFilters,
  searchRef,
}: LeadQueueProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(480);

  // The pane has no fixed height — it flexes with the window — so the number of
  // rows to render is measured rather than assumed.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientHeight));
    observer.observe(element);
    setViewport(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  // Keyboard navigation moves the selection, so the pane has to follow it. This
  // is done arithmetically rather than with scrollIntoView: the target row is
  // usually not rendered yet, and scrollIntoView on a virtualised list scrolls
  // the whole page.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || selectedIndex < 0) return;
    const top = selectedIndex * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < element.scrollTop) {
      element.scrollTop = top;
    } else if (bottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = bottom - element.clientHeight;
    }
  }, [selectedIndex]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(leads.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);
  const visible = leads.slice(start, end);

  return (
    <section
      className="pane max-h-[24rem] flex-none border-b border-line lg:max-h-none lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-r"
      aria-label="Dialling queue"
    >
      <div className="pane-head">
        <span className="pane-title">Queue</span>
        <span className="tabular text-2xs font-semibold text-muted">{leads.length}</span>
      </div>

      <div className="shrink-0 border-b border-line p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Filter queue"
            aria-label="Filter the queue"
            className="input !py-1.5 !pl-8 !text-sm"
          />
          <span className="kbd pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">f</span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="pane-body"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        role="listbox"
        aria-label="Leads to call"
        tabIndex={-1}
      >
        {isLoading ? (
          <SkeletonRows rows={9} rowClassName="h-[58px]" />
        ) : isError ? (
          <EmptyState
            compact
            tone="danger"
            icon={AlertTriangle}
            title="Could not load the queue"
            description="The list of leads did not come back. Nothing has been lost — retry, and if it keeps failing check the connection."
            action={
              <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
                Try again
              </button>
            }
          />
        ) : leads.length === 0 ? (
          filterCount > 0 ? (
            <EmptyState
              compact
              icon={Search}
              title="Nothing matches"
              description={`${filterCount} filter${filterCount === 1 ? "" : "s"} are hiding every lead in this queue.`}
              action={
                <button type="button" className="btn btn-secondary btn-sm" onClick={onClearFilters}>
                  Clear filters
                </button>
              }
            />
          ) : (
            <EmptyState
              compact
              icon={Users}
              title="Queue is empty"
              description="Every lead here has been converted, declined or put on the do-not-contact list. Add leads, or turn on “show finished” below."
            />
          )
        ) : (
          <div style={{ height: leads.length * ROW_HEIGHT }} className="relative">
            <div
              style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}
              className="absolute inset-x-0 top-0"
            >
              {visible.map((lead) => {
                const isSelected = lead.id === selectedId;
                const tone = statusTone(lead.status);
                return (
                  <button
                    key={lead.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => onSelect(lead.id)}
                    style={{ height: ROW_HEIGHT }}
                    className={`flex w-full items-center gap-2.5 border-b border-line px-2.5 text-left transition-colors duration-100 ${
                      isSelected ? "row-selected" : "hover:bg-hover"
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-2xs font-bold ${
                        isSelected ? "bg-accent text-inverse" : "bg-inset text-muted"
                      }`}
                      aria-hidden="true"
                    >
                      {leadInitials(lead)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-ink">
                          {leadName(lead)}
                        </span>
                        {lead.country ? (
                          <span className="shrink-0 text-2xs leading-none" aria-hidden="true">
                            {flagEmoji(lead.country)}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className="tabular truncate font-mono text-2xs text-muted">
                          {lead.phone || "no number"}
                        </span>
                        {(lead.call_count ?? 0) > 0 ? (
                          <span
                            className="tabular shrink-0 text-2xs font-semibold text-faint"
                            title={`Called ${lead.call_count} time${lead.call_count === 1 ? "" : "s"}`}
                          >
                            ×{lead.call_count}
                          </span>
                        ) : null}
                      </span>
                    </span>

                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className={`chip !px-1.5 !py-0 !text-2xs ${chipClass(tone)}`}>
                        {statusLabel(lead.status)}
                      </span>
                      {lead.status === "callback" ? (
                        <span className={`h-1.5 w-1.5 rounded-full ${dotClass("warning")}`} aria-hidden="true" />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line px-3 py-2">
        <p className="flex items-center gap-1.5 text-2xs text-faint">
          <PhoneOff className="h-3 w-3" />
          <span>Do-not-contact leads are never queued.</span>
        </p>
      </div>
    </section>
  );
}
