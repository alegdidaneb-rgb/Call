import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Keyboard,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneOff,
  Play,
  Settings,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDialControl } from "@/hooks/useDialControl";
import { useNowMs } from "@/hooks/useSip";
import { elapsedSeconds, sipEngine, type SipEngineSnapshot } from "@/sip/engine";
import type { SipAccount } from "@/sip/config";
import {
  OUTCOMES,
  STATUS_ACTIONS,
  borderClass,
  chipClass,
  dotClass,
  impliedOutcome,
  textClass,
  type CallOutcome,
  type LeadStatus,
} from "@/lib/outcomes";
import type { Database } from "@/types/database";

type Lead = Database["public"]["Tables"]["leads"]["Row"];

/**
 * Call controls and disposition, in one column, always visible.
 *
 * This is the pane the previous design had no equivalent of. Dialling lived on
 * the lead's detail page, so logging a call meant navigating away from the list,
 * waiting for a page, and navigating back — which is why agents skipped the
 * disposition and why `call_count` read zero on records that had been called.
 *
 * The disposition buttons work whether or not a SIP trunk is connected. An agent
 * calling from a mobile still needs to record what happened, and blocking that on
 * registration would mean the queue could not be worked at all during an outage.
 */

const DTMF = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function callPhase(snapshot: SipEngineSnapshot): string {
  switch (snapshot.callState) {
    case "held":
      return "On hold";
    case "dialling":
    case "ringing":
      return snapshot.direction === "inbound" ? "Incoming" : "Dialling";
    case "active":
      return snapshot.direction === "inbound" ? "Inbound call" : "On call";
    default:
      return "Ready";
  }
}

interface DialPanelProps {
  lead: Lead | null;
  snapshot: SipEngineSnapshot;
  account: SipAccount | null;
  /** Persist the disposition. Resolves once the write has landed. */
  onDisposition: (outcome: CallOutcome, notes: string) => Promise<void>;
  onStatusAction: (status: LeadStatus) => Promise<void> | void;
  saving: boolean;
}

export function DialPanel({
  lead,
  snapshot,
  account,
  onDisposition,
  onStatusAction,
  saving,
}: DialPanelProps) {
  const { user } = useAuth();
  const [notes, setNotes] = useState("");
  const [keypadOpen, setKeypadOpen] = useState(false);

  const { target, inCall, registered, canDial, dial, hangup, reasonDisabled } = useDialControl(
    lead,
    account,
    snapshot,
  );

  const nowMs = useNowMs(inCall);
  const seconds = elapsedSeconds(snapshot, nowMs);

  const chosen =
    snapshot.callState === "ended" ? impliedOutcome(snapshot.startedAtMs) : null;

  // A different lead is a different record: the notes belong to whoever is on
  // screen now, and the keypad should not still be open from the last call.
  useEffect(() => {
    setNotes("");
    setKeypadOpen(false);
  }, [lead?.id]);

  const handleDisposition = useCallback(
    async (value: CallOutcome) => {
      await onDisposition(value, notes);
      setNotes("");
    },
    [onDisposition, notes],
  );

  return (
    <section
      className="pane flex-none border-t border-line lg:w-[21rem] lg:shrink-0 lg:border-l lg:border-t-0"
      aria-label="Call controls"
    >
      <div className="pane-head">
        <span className="pane-title">Dial</span>
        <span className={`chip !text-2xs ${registered ? chipClass("success") : chipClass("warning")}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${dotClass(registered ? "success" : "warning")}`} />
          {registered ? "Trunk ready" : "No trunk"}
        </span>
      </div>

      <div className="pane-body">
        <div className="space-y-4 p-3">
          {/* Live call state */}
          <div
            className={`card relative overflow-hidden p-4 transition-colors duration-200 ${
              inCall ? "border-success/40" : ""
            }`}
          >
            {snapshot.callState === "active" ? (
              <span className="absolute inset-x-0 top-0 h-0.5 bg-success" aria-hidden="true" />
            ) : null}

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-2xs font-semibold uppercase tracking-wider text-faint">
                  {inCall ? callPhase(snapshot) : "Ready"}
                </p>
                <p className="mt-1 truncate text-base font-semibold text-ink">
                  {inCall
                    ? snapshot.remoteName || snapshot.remoteNumber || "Unknown"
                    : lead
                      ? "No active call"
                      : "No lead selected"}
                </p>
                {inCall ? (
                  <p className="tabular mt-0.5 truncate font-mono text-xs text-muted">
                    {snapshot.remoteNumber ?? ""}
                  </p>
                ) : lead?.phone ? (
                  <p className="tabular mt-0.5 truncate font-mono text-xs text-muted">
                    {target.display || lead.phone}
                  </p>
                ) : null}
              </div>

              <span
                className={`tabular shrink-0 rounded-lg px-2 py-1 font-mono text-lg font-semibold ${
                  inCall ? "bg-inset text-ink" : "text-faint"
                }`}
              >
                {formatDuration(seconds)}
              </span>
            </div>

            {/* What the number will be dialled as, and why it cannot be. */}
            {!inCall && lead ? (
              target.warning ? (
                <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-warning/12 px-2.5 py-2 text-2xs leading-relaxed text-warning">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>{target.warning}</span>
                </p>
              ) : target.target ? (
                <p className="mt-3 truncate text-2xs text-faint">
                  Will dial <span className="font-mono text-muted">{target.target}</span>
                </p>
              ) : (
                <p className="mt-3 text-2xs text-faint">This lead has no phone number.</p>
              )
            ) : null}
          </div>

          {/* Primary control */}
          {inCall ? (
            <button
              type="button"
              onClick={hangup}
              className="btn btn-danger w-full animate-ring-pulse !py-3 !text-base font-semibold"
            >
              <PhoneOff className="h-5 w-5" />
              End call
              <span className="kbd ml-1 !border-inverse/30 !bg-overlay/20 !text-inverse/90">d</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void dial()}
              disabled={!canDial}
              title={reasonDisabled ?? `Call ${lead?.phone ?? "this lead"}`}
              className="btn btn-primary w-full !py-3 !text-base font-semibold transition-transform duration-100 ease-spring active:scale-[0.99]"
            >
              {snapshot.status === "connecting" || snapshot.status === "registering" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Phone className="h-5 w-5" />
              )}
              {lead ? "Call lead" : "No lead selected"}
              <span className="kbd ml-1 !border-inverse/30 !bg-overlay/20 !text-inverse/90">d</span>
            </button>
          )}

          {!registered && !inCall ? (
            <p className="flex items-start gap-1.5 rounded-lg bg-warning/12 px-2.5 py-2 text-2xs leading-relaxed text-warning">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                {snapshot.failure?.hint ??
                  (user?.role === "admin" ? (
                    <>
                      No SIP trunk is connected, so calls cannot be placed from the browser.{" "}
                      <Link to="/phone" className="font-semibold underline underline-offset-2">
                        Configure one
                      </Link>
                      . You can still record dispositions below.
                    </>
                  ) : (
                    <>
                      No SIP trunk is connected. Ask an administrator to configure one on the Phone
                      page. You can still record dispositions below.
                    </>
                  ))}
              </span>
            </p>
          ) : null}

          {/* A failure the operator has to act on */}
          {snapshot.failure && registered ? (
            <p className="flex items-start gap-1.5 rounded-lg bg-danger/12 px-2.5 py-2 text-2xs leading-relaxed text-danger">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                <strong className="font-semibold">{snapshot.failure.message}</strong>
                {snapshot.failure.hint ? ` ${snapshot.failure.hint}` : ""}
              </span>
            </p>
          ) : null}

          {/* In-call secondary controls */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => sipEngine.setMuted(!snapshot.muted)}
              disabled={!inCall}
              aria-pressed={snapshot.muted}
              className={`btn btn-secondary flex-col !gap-1 !py-2.5 !text-2xs ${
                snapshot.muted ? `${borderClass("warning")} ${textClass("warning")}` : ""
              }`}
            >
              {snapshot.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {snapshot.muted ? "Unmute" : "Mute"}
              <span className="kbd">m</span>
            </button>

            <button
              type="button"
              onClick={() => void sipEngine.setHeld(snapshot.callState !== "held")}
              disabled={!inCall}
              aria-pressed={snapshot.callState === "held"}
              className={`btn btn-secondary flex-col !gap-1 !py-2.5 !text-2xs ${
                snapshot.callState === "held" ? `${borderClass("info")} ${textClass("info")}` : ""
              }`}
            >
              {snapshot.callState === "held" ? (
                <Play className="h-4 w-4" />
              ) : (
                <Pause className="h-4 w-4" />
              )}
              {snapshot.callState === "held" ? "Resume" : "Hold"}
              <span className="kbd">h</span>
            </button>

            <button
              type="button"
              onClick={() => setKeypadOpen((open) => !open)}
              disabled={!inCall}
              aria-expanded={keypadOpen}
              className="btn btn-secondary flex-col !gap-1 !py-2.5 !text-2xs"
            >
              <Keyboard className="h-4 w-4" />
              Keypad
            </button>
          </div>

          {keypadOpen && inCall ? (
            <div className="grid animate-scale-in grid-cols-3 gap-1.5">
              {DTMF.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  onClick={() => void sipEngine.sendDtmf(tone)}
                  className="tabular rounded-lg border border-line bg-inset py-2 font-mono text-sm font-semibold text-ink transition-colors hover:bg-hover active:bg-accent/12"
                >
                  {tone}
                </button>
              ))}
            </div>
          ) : null}

          {/* Disposition */}
          <div className="space-y-2 border-t border-line pt-3">
            <div className="flex items-baseline justify-between">
              <h3 className="pane-title">Disposition</h3>
              <span className="text-2xs text-faint">
                {chosen ? `last call: ${chosen.replace(/_/g, " ")}` : "or press 1–7"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {OUTCOMES.map((option) => {
                const isChosen = chosen === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => void handleDisposition(option.value)}
                    disabled={saving || !lead}
                    title={option.hint}
                    aria-pressed={isChosen}
                    className={`group flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-2xs font-semibold transition-all duration-100 ${
                      isChosen
                        ? `${chipClass(option.tone)} ${borderClass(option.tone)}`
                        : "border-line bg-panel text-muted hover:border-line-strong hover:bg-hover hover:text-ink"
                    } disabled:pointer-events-none disabled:opacity-50`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(option.tone)}`} />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    <span className="kbd shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      {option.key}
                    </span>
                  </button>
                );
              })}
            </div>

            <div>
              <label htmlFor="workspace-notes" className="label !mb-1">
                Notes
              </label>
              <textarea
                id="workspace-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                placeholder="What was said, what happens next"
                className="input resize-y !text-sm leading-relaxed"
              />
            </div>
          </div>

          {/* Status without a call */}
          <div className="space-y-2 border-t border-line pt-3">
            <div className="flex items-baseline justify-between">
              <h3 className="pane-title">Lead status</h3>
              <span className="text-2xs text-faint">no call needed</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {STATUS_ACTIONS.map((action) => (
                <button
                  key={action.value}
                  type="button"
                  onClick={() => void onStatusAction(action.value)}
                  disabled={saving || !lead}
                  title={action.hint}
                  className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1.5 text-left text-2xs font-semibold text-muted transition-colors hover:border-line-strong hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-50"
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(action.tone)}`} />
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  <span className="kbd shrink-0">{action.key}</span>
                </button>
              ))}
            </div>
          </div>

          {user?.role === "admin" ? (
            <Link
              to="/phone"
              className="flex items-center gap-1.5 text-2xs text-faint transition-colors hover:text-muted"
            >
              <Settings className="h-3 w-3" />
              Phone and trunk settings
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
