import { useNavigate } from "react-router-dom";
import { Headset, Mic, MicOff, Pause, PhoneOff, Play } from "lucide-react";
import { useNowMs, useSipEngineSnapshot } from "@/hooks/useSip";
import { elapsedSeconds, sipEngine } from "@/sip/engine";

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * A live call indicator that follows the agent around the app.
 *
 * Registration and the call itself live in a module-level engine, deliberately
 * independent of any page: an agent who navigates away while a call is ringing
 * must not lose it, and must still be able to see and end it. This bar renders
 * only while a call is actually in progress — disposition belongs to the
 * workspace, where the notes and the outcome are.
 *
 * It stays a dark pill in both themes on purpose. `--c-overlay` is dark in the
 * light theme too, so a floating control keeps the same contrast wherever it is,
 * the way a media player's controls do. Everything on it is `inverse` rather than
 * `white` so that stays true by token rather than by luck.
 */
export function CallBar() {
  const snapshot = useSipEngineSnapshot();
  const navigate = useNavigate();

  const inCall =
    snapshot.callState === "dialling" ||
    snapshot.callState === "ringing" ||
    snapshot.callState === "active" ||
    snapshot.callState === "held";
  const nowMs = useNowMs(inCall);

  if (!inCall) return null;

  const seconds = elapsedSeconds(snapshot, nowMs);
  const label =
    snapshot.callState === "dialling"
      ? "Dialling"
      : snapshot.callState === "ringing"
        ? snapshot.direction === "inbound"
          ? "Incoming"
          : "Ringing"
        : snapshot.callState === "held"
          ? "On hold"
          : "In call";
  const controllable = snapshot.callState === "active" || snapshot.callState === "held";

  return (
    <div className="fixed bottom-4 left-1/2 z-40 w-[min(94vw,32rem)] -translate-x-1/2 animate-rise-in">
      <div className="flex items-center gap-3 rounded-xl bg-overlay px-4 py-3 shadow-floating">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
            snapshot.callState === "active"
              ? "bg-success animate-pulse"
              : snapshot.callState === "held"
                ? "bg-warning"
                : "bg-inverse/70 animate-pulse"
          }`}
          aria-hidden="true"
        />

        {/* The identity doubles as the way back to the call's controls. An agent
            who has navigated elsewhere mid-call otherwise has to find the
            workspace through the sidebar while talking. */}
        <button
          type="button"
          onClick={() => navigate("/workspace")}
          className="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-inverse/10 focus-visible:bg-inverse/10"
          title="Open the workspace to disposition this call"
        >
          <span className="block truncate text-sm font-medium text-inverse">
            {snapshot.remoteName || snapshot.remoteNumber || "Unknown"}
          </span>
          <span className="tabular block truncate font-mono text-xs text-inverse/60" aria-live="off">
            {label}
            {snapshot.startedAtMs ? ` · ${formatDuration(seconds)}` : ""}
          </span>
        </button>

        {controllable ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => sipEngine.setMuted(!snapshot.muted)}
              aria-pressed={snapshot.muted}
              className={`rounded-lg p-2 transition-colors ${
                snapshot.muted
                  ? "bg-warning text-inverse"
                  : "bg-inverse/10 text-inverse hover:bg-inverse/20"
              }`}
              title={snapshot.muted ? "Unmute" : "Mute"}
            >
              {snapshot.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => void sipEngine.setHeld(snapshot.callState !== "held")}
              aria-pressed={snapshot.callState === "held"}
              className="rounded-lg bg-inverse/10 p-2 text-inverse transition-colors hover:bg-inverse/20"
              title={snapshot.callState === "held" ? "Resume" : "Hold"}
            >
              {snapshot.callState === "held" ? (
                <Play className="h-4 w-4" />
              ) : (
                <Pause className="h-4 w-4" />
              )}
            </button>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void sipEngine.hangup()}
          className="shrink-0 rounded-lg bg-danger p-2 text-inverse transition-colors hover:bg-danger/90"
          title="End call"
          aria-label="End call"
        >
          <PhoneOff className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => navigate("/workspace")}
          className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-inverse/10 px-2.5 py-2 text-xs font-semibold text-inverse transition-colors hover:bg-inverse/20 sm:flex"
          title="Open the workspace"
        >
          <Headset className="h-3.5 w-3.5" />
          Workspace
        </button>
      </div>
    </div>
  );
}
