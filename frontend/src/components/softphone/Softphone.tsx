import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  Clock,
  ExternalLink,
  Keyboard,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneIncoming,
  PhoneOff,
  Play,
  RotateCcw,
  Settings,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useNowMs, useSipAccount, useSipEngineSnapshot } from "@/hooks/useSip";
import { flagEmoji } from "@/data/countries";
import { domainFromSipUri } from "@/sip/config";
import { buildDialTarget } from "@/sip/dialTarget";
import { elapsedSeconds, sipEngine } from "@/sip/engine";
import type { CallEndData } from "@/components/softphone/types";
import type { Database } from "@/types/database";

type Lead = Database["public"]["Tables"]["leads"]["Row"];

interface SoftphoneProps {
  lead: Lead | null;
  onCallEnd?: (data: CallEndData) => void;
}

const OUTCOMES = [
  { value: "answered", label: "Answered" },
  { value: "no_answer", label: "No Answer" },
  { value: "busy", label: "Busy" },
  { value: "voicemail", label: "Voicemail" },
  { value: "dnc", label: "DNC" },
  { value: "wrong_number", label: "Wrong Number" },
  { value: "disconnected", label: "Disconnected" },
] as const;

const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Connection state as a dot colour plus a word an operator can act on. */
const STATUS_VIEW = {
  unconfigured: { label: "Not configured", dot: "bg-gray-400", text: "text-gray-500" },
  disconnected: { label: "Disconnected", dot: "bg-gray-400", text: "text-gray-500" },
  connecting: { label: "Connecting", dot: "bg-amber-400 animate-pulse", text: "text-amber-600" },
  registering: { label: "Registering", dot: "bg-amber-400 animate-pulse", text: "text-amber-600" },
  registered: { label: "Ready to call", dot: "bg-green-500", text: "text-green-600" },
  error: { label: "Connection error", dot: "bg-red-500", text: "text-red-600" },
} as const;

export function Softphone({ lead, onCallEnd }: SoftphoneProps) {
  const { user } = useAuth();
  const { account } = useSipAccount();
  const snapshot = useSipEngineSnapshot();

  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState<string>("no_answer");
  const [keypadVisible, setKeypadVisible] = useState(false);
  const [manualNumber, setManualNumber] = useState("");

  const inCall = snapshot.callState !== "idle" && snapshot.callState !== "ended";
  const nowMs = useNowMs(inCall);
  const seconds = elapsedSeconds(snapshot, nowMs);

  const domain = account ? domainFromSipUri(account.sipUri) : "";
  const configured = account !== null;

  // A lead's stored number, resolved to something the SIP server can route.
  const dial = useMemo(
    () => buildDialTarget(lead?.phone ?? manualNumber, lead?.country, domain),
    [lead?.phone, lead?.country, manualNumber, domain],
  );

  const canDial =
    configured &&
    snapshot.status === "registered" &&
    !inCall &&
    Boolean(dial.target) &&
    !dial.warning;

  // Reflect what actually happened instead of making the operator guess, while
  // still letting them correct it.
  useEffect(() => {
    if (snapshot.callState === "ended") {
      setOutcome(snapshot.startedAtMs ? "answered" : "no_answer");
    }
  }, [snapshot.callState, snapshot.startedAtMs]);

  const handleDial = useCallback(async () => {
    if (!dial.target) return;
    setNotes("");
    try {
      await sipEngine.call(dial.target, dial.display);
    } catch {
      // The engine has already recorded a classified failure; it renders below.
    }
  }, [dial.target, dial.display]);

  const handleHangup = useCallback(() => {
    void sipEngine.hangup();
  }, []);

  const handleSave = useCallback(() => {
    onCallEnd?.({
      outcome,
      duration: seconds,
      notes,
      direction: snapshot.direction,
      sipCallId: snapshot.callId,
      startedAt: snapshot.startedAtMs ? new Date(snapshot.startedAtMs).toISOString() : null,
      endedAt: snapshot.endedAtMs ? new Date(snapshot.endedAtMs).toISOString() : null,
    });
    sipEngine.reset();
    setNotes("");
    setOutcome("no_answer");
    setManualNumber("");
  }, [onCallEnd, outcome, seconds, notes, snapshot.direction, snapshot.callId, snapshot.startedAtMs, snapshot.endedAtMs]);

  const handleKeypad = useCallback(
    (digit: string) => {
      if (inCall) {
        // In-call tones go to the far end (IVR menus), not into the dial field.
        void sipEngine.sendDtmf(digit);
        return;
      }
      setManualNumber((previous) => previous + digit);
    },
    [inCall],
  );

  const status = STATUS_VIEW[snapshot.status];
  const telHref = dial.display ? `tel:${dial.display}` : null;
  const isIncoming = snapshot.direction === "inbound";

  if (!lead) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-center h-48 text-gray-400">
          <div className="text-center">
            <Phone className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">Select a lead to start a call</p>
            <p className="text-xs mt-1">Open a lead and use the dialer on its page</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div
        className={`px-5 py-4 ${
          snapshot.callState === "active" || snapshot.callState === "held"
            ? "bg-gradient-to-r from-green-600 to-green-700"
            : snapshot.callState === "ended"
              ? "bg-gradient-to-r from-red-600 to-red-700"
              : "bg-gradient-to-r from-brand-600 to-brand-700"
        }`}
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            {isIncoming && inCall ? (
              <PhoneIncoming className="w-5 h-5 text-white" />
            ) : (
              <Phone className="w-5 h-5 text-white" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold truncate">
              {lead.country ? `${flagEmoji(lead.country)} ` : ""}
              {lead.first_name} {lead.last_name}
            </p>
            <p className="text-white/80 text-sm truncate">
              {lead.company ?? lead.email ?? "No contact info"}
            </p>
          </div>
          <div className="text-right">
            {inCall || snapshot.callState === "ended" ? (
              <div className="flex items-center gap-1 text-white text-sm justify-end">
                <Clock className="w-3.5 h-3.5" />
                <span className="font-mono">{formatDuration(seconds)}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 justify-end text-white/85 text-xs">
                {snapshot.status === "registered" ? (
                  <Wifi className="w-3.5 h-3.5" />
                ) : (
                  <WifiOff className="w-3.5 h-3.5" />
                )}
                <span>{status.label}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Number being dialled */}
        <div className="text-center">
          <p className="text-2xl font-mono font-semibold text-gray-900 truncate">
            {dial.display || lead.phone || "—"}
          </p>
          <p
            className={`text-xs mt-1 font-medium ${
              snapshot.callState === "active"
                ? "text-green-600"
                : snapshot.callState === "ended"
                  ? "text-red-600"
                  : snapshot.callState === "held"
                    ? "text-amber-600"
                    : "text-gray-400"
            }`}
          >
            {snapshot.callState === "idle" && "Ready"}
            {snapshot.callState === "dialling" && "Dialling..."}
            {snapshot.callState === "ringing" && (isIncoming ? "Incoming call..." : "Ringing...")}
            {snapshot.callState === "active" && (isIncoming ? "In call" : "Connected")}
            {snapshot.callState === "held" && "On hold"}
            {snapshot.callState === "ended" && "Call ended"}
            {snapshot.startedAtMs === null && snapshot.callState === "ended" && " (never answered)"}
          </p>
          {account?.label && (
            <p className="text-[11px] text-gray-400 mt-0.5 truncate">via {account.label}</p>
          )}
        </div>

        {/* A number that cannot be dialled safely is reported, not guessed at. */}
        {dial.warning && !inCall && (
          <div className="flex gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">{dial.warning}</p>
          </div>
        )}

        {/* Engine failures, classified. Never replaced by a pretend call. */}
        {snapshot.failure && (
          <div className="flex gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="text-xs text-red-800">
              <p className="font-semibold">{snapshot.failure.message}</p>
              {snapshot.failure.hint && <p className="mt-0.5">{snapshot.failure.hint}</p>}
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-center gap-3">
          {snapshot.callState === "idle" && (
            <button
              type="button"
              onClick={handleDial}
              disabled={!canDial}
              title={
                canDial
                  ? "Call this lead"
                  : !configured
                    ? "No SIP account is configured"
                    : snapshot.status !== "registered"
                      ? "Not registered with the SIP server yet"
                      : "This number cannot be dialled as stored"
              }
              className="w-14 h-14 rounded-full bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center text-white shadow-lg shadow-green-500/30 transition hover:scale-105 disabled:hover:scale-100"
            >
              {snapshot.status === "connecting" || snapshot.status === "registering" ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <Phone className="w-6 h-6" />
              )}
            </button>
          )}

          {snapshot.callState === "ended" && (
            <button
              type="button"
              onClick={() => sipEngine.reset()}
              className="w-14 h-14 rounded-full bg-gray-500 hover:bg-gray-600 flex items-center justify-center text-white shadow-lg transition hover:scale-105"
              title="Clear the finished call"
            >
              <RotateCcw className="w-6 h-6" />
            </button>
          )}

          {inCall && (
            <>
              <button
                type="button"
                onClick={handleHangup}
                className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-lg shadow-red-500/30 transition hover:scale-105"
                title="Hang up"
              >
                <PhoneOff className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={() => sipEngine.setMuted(!snapshot.muted)}
                disabled={snapshot.callState !== "active" && snapshot.callState !== "held"}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition hover:scale-105 disabled:opacity-40 ${
                  snapshot.muted ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
                title={snapshot.muted ? "Unmute" : "Mute"}
              >
                {snapshot.muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              <button
                type="button"
                onClick={() => void sipEngine.setHeld(snapshot.callState !== "held")}
                disabled={snapshot.callState !== "active" && snapshot.callState !== "held"}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition hover:scale-105 disabled:opacity-40 ${
                  snapshot.callState === "held"
                    ? "bg-amber-100 text-amber-600"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
                title={snapshot.callState === "held" ? "Resume" : "Hold"}
              >
                {snapshot.callState === "held" ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
              </button>
            </>
          )}
        </div>

        {/* Keypad: manual entry when idle, real DTMF to the far end when in a call. */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setKeypadVisible((visible) => !visible)}
            className={`p-2 rounded-lg transition ${
              keypadVisible ? "bg-brand-100 text-brand-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
            title={inCall ? "Send DTMF tones" : "Dial a different number"}
          >
            <Keyboard className="w-4 h-4" />
          </button>
        </div>

        {keypadVisible && (
          <div className="space-y-2">
            {!inCall && (
              <div className="flex items-center gap-2 max-w-[220px] mx-auto">
                <input
                  value={manualNumber}
                  onChange={(event) => setManualNumber(event.target.value)}
                  placeholder={lead.phone ?? "Number"}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
                />
                {manualNumber && (
                  <button
                    type="button"
                    onClick={() => setManualNumber("")}
                    className="p-2 text-gray-400 hover:text-gray-600"
                    title="Clear"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 max-w-[220px] mx-auto">
              {KEYPAD.map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => handleKeypad(digit)}
                  className="w-full aspect-square flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-lg text-lg font-semibold text-gray-800 transition"
                >
                  {digit}
                </button>
              ))}
            </div>
            {inCall && <p className="text-center text-[11px] text-gray-400">Tones are sent to the call</p>}
          </div>
        )}

        {/* Post-call disposition */}
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <div>
            <label htmlFor="call-outcome" className="block text-xs font-medium text-gray-500 mb-1">
              Outcome
            </label>
            <select
              id="call-outcome"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none bg-white"
            >
              {OUTCOMES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="call-notes" className="block text-xs font-medium text-gray-500 mb-1">
              Notes
            </label>
            <textarea
              id="call-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none resize-none"
              placeholder="Add call notes..."
            />
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={snapshot.callState !== "ended"}
            className="w-full py-2.5 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition"
          >
            Save &amp; Next
          </button>
          {snapshot.callId && (
            <p className="text-[11px] text-gray-400 text-center font-mono truncate">
              call id {snapshot.callId}
            </p>
          )}
        </div>

        {/* Always-available escape hatch: dial with the operator's own phone. */}
        {telHref && !inCall && (
          <div className="border-t border-gray-100 pt-3 flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500">
              {configured ? "Prefer another phone?" : "No web phone set up yet."}
            </span>
            <a
              href={telHref}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:text-brand-800"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open in phone app
            </a>
          </div>
        )}
      </div>

      <ConnectionFooter status={snapshot.status} isAdmin={user?.role === "admin"} />
    </div>
  );
}

/**
 * Persistent line status, plus the route to fixing it.
 *
 * A softphone that says nothing about its registration state is the reason the
 * original looked broken: it rendered "Ready" with no credentials at all.
 */
function ConnectionFooter({
  status,
  isAdmin,
}: {
  status: keyof typeof STATUS_VIEW;
  isAdmin: boolean;
}) {
  const view = STATUS_VIEW[status];
  const needsAttention = status === "unconfigured" || status === "error";

  return (
    <div
      className={`px-5 py-2.5 border-t flex items-center justify-between gap-2 text-xs ${
        needsAttention ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"
      }`}
    >
      <span className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${view.dot}`} />
        <span className={needsAttention ? "text-amber-800" : view.text}>{view.label}</span>
      </span>
      {needsAttention &&
        (isAdmin ? (
          <Link to="/phone" className="inline-flex items-center gap-1 font-medium text-amber-900 hover:underline">
            <Settings className="w-3.5 h-3.5" />
            Set up phone
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1 text-amber-900">
            <Check className="w-3.5 h-3.5" />
            Ask an administrator
          </span>
        ))}
    </div>
  );
}

