import { Mic, MicOff, Pause, PhoneOff, Play } from "lucide-react";
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
 * independent of any page: an agent who clicks through to the next lead while a
 * call is ringing must not lose the call, and must still be able to see and end
 * it. This bar renders only while a call is actually in progress — disposition
 * of a finished call belongs to the lead page, where the notes and outcome are.
 */
export function CallBar() {
  const snapshot = useSipEngineSnapshot();
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

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(94vw,32rem)]">
      <div className="bg-gray-900 text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3">
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            snapshot.callState === "active"
              ? "bg-green-400 animate-pulse"
              : snapshot.callState === "held"
                ? "bg-amber-400"
                : "bg-white/70 animate-pulse"
          }`}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {snapshot.remoteName || snapshot.remoteNumber || "Unknown"}
          </p>
          <p className="text-xs text-white/60">
            {label}
            {snapshot.startedAtMs ? ` · ${formatDuration(seconds)}` : ""}
          </p>
        </div>

        {(snapshot.callState === "active" || snapshot.callState === "held") && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => sipEngine.setMuted(!snapshot.muted)}
              className={`p-2 rounded-lg transition ${
                snapshot.muted ? "bg-red-500/90 text-white" : "bg-white/10 hover:bg-white/20 text-white"
              }`}
              title={snapshot.muted ? "Unmute" : "Mute"}
            >
              {snapshot.muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => void sipEngine.setHeld(snapshot.callState !== "held")}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition"
              title={snapshot.callState === "held" ? "Resume" : "Hold"}
            >
              {snapshot.callState === "held" ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => void sipEngine.hangup()}
          className="p-2 rounded-lg bg-red-500 hover:bg-red-600 text-white transition shrink-0"
          title="Hang up"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
