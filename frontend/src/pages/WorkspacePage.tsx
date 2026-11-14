import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Command, Target } from "lucide-react";
import { DialPanel } from "@/components/workspace/DialPanel";
import { LeadPanel } from "@/components/workspace/LeadPanel";
import { LeadQueue } from "@/components/workspace/LeadQueue";
import { ShortcutsOverlay } from "@/components/workspace/ShortcutsOverlay";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useCreateCallLog } from "@/hooks/useCallLogs";
import { useUpdateLead } from "@/hooks/useLeads";
import { useDialControl } from "@/hooks/useDialControl";
import { useSipAccount, useSipEngineSnapshot } from "@/hooks/useSip";
import { useWorkspaceQueue } from "@/hooks/useWorkspaceQueue";
import { bindShortcuts, keyName } from "@/lib/keys";
import {
  OUTCOMES,
  STATUS_ACTIONS,
  isQueueFinished,
  nextLeadStatus,
  outcomeDefinition,
  outcomeLabel,
  statusLabel,
  type CallOutcome,
  type LeadStatus,
} from "@/lib/outcomes";
import { elapsedSeconds, sipEngine } from "@/sip/engine";

/**
 * The calling workspace.
 *
 * One screen for the loop an agent actually performs: pick a lead, dial, record
 * what happened, move to the next. Everything else in the app is a page you visit
 * to set something up or check something afterwards; this is the page you stay on.
 *
 * Three panes, each scrolling independently, so nothing about the call state
 * moves when the queue changes length:
 *
 *   queue  →  the lead  →  the call
 *
 * It is keyboard-driven throughout (press `?` for the list), because a dialler
 * worked with a mouse is slower than a spreadsheet and offers nothing in
 * exchange.
 */

/** Prefix a note with when it was taken, so a lead's notes read as a log. */
function appendNote(existing: string | null, note: string): string {
  const entry = `[${new Date().toLocaleString()}] ${note.trim()}`;
  return existing ? `${entry}\n\n${existing}` : entry;
}

export default function WorkspacePage() {
  const queue = useWorkspaceQueue();
  const { account } = useSipAccount();
  const snapshot = useSipEngineSnapshot();
  const campaigns = useCampaigns();
  const createCallLog = useCreateCallLog();
  const updateLead = useUpdateLead();

  const [saving, setSaving] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const { inCall, toggle } = useDialControl(queue.selected, account, snapshot);

  const campaignList = useMemo(() => campaigns.data ?? [], [campaigns.data]);
  const campaignName = useMemo(() => {
    const id = queue.selected?.campaign_id;
    if (!id) return null;
    return campaignList.find((campaign) => campaign.id === id)?.name ?? null;
  }, [campaignList, queue.selected?.campaign_id]);

  const filterCount = (queue.options.search ? 1 : 0) + (queue.options.campaignId ? 1 : 0);

  /**
   * Record what happened to a lead.
   *
   * Two different writes, and the difference between them is the honest part:
   *
   * - A call the browser placed or attempted gets a `call_logs` row carrying the
   *   real SIP Call-ID, the real answer and end timestamps, and the measured talk
   *   seconds. Ring time is excluded because it is not billed as talk time.
   * - A disposition recorded with no call — the agent dialled from a mobile, or
   *   is logging a refusal — updates the lead only. It does not invent a call
   *   record with fabricated timestamps, and any notes go onto the lead, where
   *   they can still be read.
   */
  const handleDisposition = useCallback(
    async (outcome: CallOutcome, notes: string) => {
      const lead = queue.selected;
      if (!lead || saving) return;

      const definition = outcomeDefinition(outcome);
      const hadCall = snapshot.callState === "ended" || Boolean(snapshot.callId);
      const seconds = elapsedSeconds(snapshot, Date.now());
      const nextStatus = nextLeadStatus(lead.status, definition?.leadStatus ?? null) ?? lead.status;
      const trimmed = notes.trim();

      setSaving(true);
      try {
        if (hadCall) {
          await createCallLog.mutateAsync({
            lead_id: lead.id,
            // The database forces this from the session; a client-supplied value
            // would be a way to attribute a call to somebody else.
            user_id: null,
            campaign_id: lead.campaign_id,
            direction: snapshot.direction,
            outcome,
            duration_seconds: seconds,
            recording_url: null,
            transcript: null,
            sip_call_id: snapshot.callId,
            started_at: snapshot.startedAtMs ? new Date(snapshot.startedAtMs).toISOString() : null,
            ended_at: snapshot.endedAtMs ? new Date(snapshot.endedAtMs).toISOString() : null,
            notes: trimmed || null,
          });
        }

        await updateLead.mutateAsync({
          id: lead.id,
          status: nextStatus,
          call_count: hadCall ? (lead.call_count ?? 0) + 1 : (lead.call_count ?? 0),
          last_called_at: hadCall
            ? (snapshot.endedAtMs
                ? new Date(snapshot.endedAtMs).toISOString()
                : new Date().toISOString())
            : lead.last_called_at,
          // Notes taken without a call have nowhere else to live.
          notes: !hadCall && trimmed ? appendNote(lead.notes, trimmed) : lead.notes,
        });

        if (hadCall) sipEngine.reset();

        toast.success(
          hadCall ? `${outcomeLabel(outcome)} · ${seconds}s logged` : `${outcomeLabel(outcome)} recorded`,
        );

        // If the lead is still in the queue, move on explicitly. If the
        // disposition removed it, the queue lands on the row that took its place
        // by itself — advancing here as well would skip a lead.
        if (definition?.advances && !isQueueFinished(nextStatus, lead.dnc)) {
          queue.next();
        }
      } catch (error) {
        // A disposition that failed to save must not look like a success, or the
        // agent moves on believing the record exists.
        toast.error(error instanceof Error ? error.message : "Could not save the disposition");
      } finally {
        setSaving(false);
      }
    },
    [queue, saving, snapshot, createCallLog, updateLead],
  );

  const handleStatusAction = useCallback(
    async (status: LeadStatus) => {
      const lead = queue.selected;
      if (!lead || saving) return;
      setSaving(true);
      try {
        await updateLead.mutateAsync({ id: lead.id, status });
        toast.success(`Marked ${statusLabel(status).toLowerCase()}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not update the lead");
      } finally {
        setSaving(false);
      }
    },
    [queue, saving, updateLead],
  );

  useEffect(
    () =>
      bindShortcuts((event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const key = keyName(event);

        if (key === "?") {
          event.preventDefault();
          setShortcutsOpen(true);
          return;
        }
        if (key === "f") {
          event.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
          return;
        }
        if (key === "Escape") {
          if (filterCount > 0) {
            event.preventDefault();
            queue.resetOptions();
          }
          return;
        }
        if (key === "ArrowDown" || key === "j" || key === "n") {
          event.preventDefault();
          queue.next();
          return;
        }
        if (key === "ArrowUp" || key === "k") {
          event.preventDefault();
          queue.previous();
          return;
        }
        if (key === "d") {
          event.preventDefault();
          void toggle();
          return;
        }
        // Mute and hold only mean something while a call is up.
        if (key === "m" && inCall) {
          event.preventDefault();
          sipEngine.setMuted(!snapshot.muted);
          return;
        }
        if (key === "h" && inCall) {
          event.preventDefault();
          void sipEngine.setHeld(snapshot.callState !== "held");
          return;
        }

        const outcome = OUTCOMES.find((option) => option.key === key);
        if (outcome) {
          event.preventDefault();
          void handleDisposition(outcome.value, "");
          return;
        }
        const action = STATUS_ACTIONS.find((option) => option.key === key);
        if (action) {
          event.preventDefault();
          void handleStatusAction(action.value);
        }
      }),
    [filterCount, queue, snapshot, inCall, toggle, handleDisposition, handleStatusAction],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="shrink-0 text-sm font-semibold text-ink">Workspace</h1>
          <span className="tabular hidden shrink-0 rounded-full bg-inset px-2 py-0.5 text-[11px] font-semibold text-muted sm:inline">
            {queue.stats.diallable} to call
          </span>
          {queue.stats.blocked > 0 ? (
            <span
              className="tabular hidden shrink-0 rounded-full bg-danger/12 px-2 py-0.5 text-[11px] font-semibold text-danger md:inline"
              title="Leads on the do-not-contact list. Never dialled."
            >
              {queue.stats.blocked} blocked
            </span>
          ) : null}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Target className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <select
              value={queue.options.campaignId ?? ""}
              onChange={(event) =>
                queue.setOption("campaignId", event.target.value === "" ? null : event.target.value)
              }
              aria-label="Filter by campaign"
              className="input !w-auto !py-1 !pl-7 !pr-7 !text-[12px]"
            >
              <option value="">All campaigns</option>
              {campaignList.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </div>

          <label
            className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-muted"
            title="Include leads that are converted, declined or on the do-not-contact list"
          >
            <input
              type="checkbox"
              checked={queue.options.includeFinished}
              onChange={(event) => queue.setOption("includeFinished", event.target.checked)}
              className="h-3.5 w-3.5 rounded border-line-strong bg-inset"
            />
            Show finished
          </label>

          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="btn btn-ghost btn-sm"
            title="Keyboard shortcuts"
          >
            <Command className="h-3.5 w-3.5" />
            <span className="kbd">?</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <LeadQueue
          leads={queue.queue}
          selectedId={queue.selectedId}
          selectedIndex={queue.selectedIndex}
          search={queue.options.search}
          onSearchChange={(value) => queue.setOption("search", value)}
          onSelect={queue.select}
          isLoading={queue.isLoading}
          isError={queue.isError}
          onRetry={() => void queue.refetch()}
          filterCount={filterCount}
          onClearFilters={queue.resetOptions}
          searchRef={searchRef}
        />

        <LeadPanel
          lead={queue.selected}
          campaignName={campaignName}
          isLoadingQueue={queue.isLoading}
        />

        <DialPanel
          lead={queue.selected}
          snapshot={snapshot}
          account={account}
          onDisposition={handleDisposition}
          onStatusAction={handleStatusAction}
          saving={saving}
        />
      </div>

      {shortcutsOpen ? <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} /> : null}
    </div>
  );
}
