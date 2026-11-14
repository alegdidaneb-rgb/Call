import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLeads } from "@/hooks/useLeads";
import { matchesLead } from "@/lib/leads";
import { isQueueFinished } from "@/lib/outcomes";
import type { Database } from "@/types/database";

type Lead = Database["public"]["Tables"]["leads"]["Row"];

/**
 * The queue an agent actually works, and the selection that moves through it.
 *
 * `useLeads` returns every lead the agent can see, newest first. That is a fine
 * order for a records page and a useless one for dialling: it puts a lead
 * created five minutes ago ahead of one that asked for a callback yesterday, and
 * it keeps finished leads in the way. This hook turns that list into work.
 *
 * Two behaviours are worth calling out because they are easy to get wrong and
 * annoying to live with:
 *
 * - Selection follows position, not identity. When the lead you are on leaves
 *   the queue — dispositioned, or excluded by a filter change — you land on the
 *   row that took its place. Jumping to the top of a 4,000-lead queue on every
 *   disposition would make the screen unusable.
 * - The order is stable. Re-sorting a queue while somebody is reading it makes
 *   rows move under the cursor, so nothing here depends on the current time.
 */

export interface QueueOptions {
  campaignId: string | null;
  search: string;
  /** Show leads that are converted, declined or on the do-not-contact list. */
  includeFinished: boolean;
}

const DEFAULT_OPTIONS: QueueOptions = {
  campaignId: null,
  search: "",
  includeFinished: false,
};

/**
 * Which lead gets dialled first.
 *
 * `interested` and `callback` outrank untouched leads because a person already
 * engaged is worth more than a cold one, and a callback is a promise made.
 * Within a rank, the lead with the fewest attempts goes first so one hard-to-
 * reach number cannot sit at the front of the queue all day.
 */
const QUEUE_RANK: Record<string, number> = {
  interested: 0,
  callback: 1,
  new: 2,
  contacted: 3,
};

function rankOf(lead: Lead): number {
  return QUEUE_RANK[lead.status] ?? 4;
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function useWorkspaceQueue() {
  const leadsQuery = useLeads();
  const [options, setOptions] = useState<QueueOptions>(DEFAULT_OPTIONS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /** Where to land when the current selection disappears from the queue. */
  const pendingIndex = useRef(0);

  const all = useMemo(() => leadsQuery.data ?? [], [leadsQuery.data]);

  const queue = useMemo(() => {
    const filtered = all.filter((lead) => {
      if (!options.includeFinished && isQueueFinished(lead.status, lead.dnc)) return false;
      if (lead.dnc) return false;
      if (options.campaignId && lead.campaign_id !== options.campaignId) return false;
      return matchesLead(lead, options.search);
    });

    return [...filtered].sort((a, b) => {
      const rank = rankOf(a) - rankOf(b);
      if (rank !== 0) return rank;
      const attempts = (a.call_count ?? 0) - (b.call_count ?? 0);
      if (attempts !== 0) return attempts;
      const recency = timestamp(a.last_called_at) - timestamp(b.last_called_at);
      if (recency !== 0) return recency;
      return timestamp(b.created_at) - timestamp(a.created_at);
    });
  }, [all, options]);

  const selectedIndex = selectedId ? queue.findIndex((lead) => lead.id === selectedId) : -1;
  const selected = selectedIndex >= 0 ? queue[selectedIndex] : null;

  useEffect(() => {
    if (selectedIndex >= 0) pendingIndex.current = selectedIndex;
  }, [selectedIndex]);

  // Keep the selection on the row that took the departed lead's place.
  useEffect(() => {
    if (queue.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (selectedId !== null && queue.some((lead) => lead.id === selectedId)) return;
    const target = queue[Math.min(pendingIndex.current, queue.length - 1)];
    if (target) setSelectedId(target.id);
  }, [queue, selectedId]);

  const select = useCallback(
    (id: string) => {
      const index = queue.findIndex((lead) => lead.id === id);
      if (index >= 0) pendingIndex.current = index;
      setSelectedId(id);
    },
    [queue],
  );

  const moveBy = useCallback(
    (delta: number) => {
      if (queue.length === 0) return;
      const from = selectedIndex >= 0 ? selectedIndex : pendingIndex.current;
      const target = Math.min(Math.max(from + delta, 0), queue.length - 1);
      pendingIndex.current = target;
      setSelectedId(queue[target].id);
    },
    [queue, selectedIndex],
  );

  const next = useCallback(() => moveBy(1), [moveBy]);
  const previous = useCallback(() => moveBy(-1), [moveBy]);

  const setOption = useCallback(<K extends keyof QueueOptions>(key: K, value: QueueOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  }, []);

  const resetOptions = useCallback(() => setOptions(DEFAULT_OPTIONS), []);

  /**
   * Counts for the header.
   *
   * `diallable` is what an agent cares about — how much work is left — and it is
   * computed against the whole lead set rather than the current filter, so it
   * does not silently change meaning when a campaign is selected.
   */
  const stats = useMemo(() => {
    let diallable = 0;
    let finished = 0;
    let blocked = 0;
    for (const lead of all) {
      if (lead.dnc || lead.status === "do_not_contact") {
        blocked += 1;
        continue;
      }
      if (isQueueFinished(lead.status, lead.dnc)) finished += 1;
      else diallable += 1;
    }
    return { total: all.length, diallable, finished, blocked };
  }, [all]);

  return {
    leads: all,
    queue,
    selected,
    selectedId,
    selectedIndex,
    options,
    setOption,
    resetOptions,
    select,
    next,
    previous,
    moveBy,
    stats,
    isLoading: leadsQuery.isLoading,
    isError: leadsQuery.isError,
    error: leadsQuery.error as Error | null,
    refetch: leadsQuery.refetch,
  };
}

export type WorkspaceQueue = ReturnType<typeof useWorkspaceQueue>;
