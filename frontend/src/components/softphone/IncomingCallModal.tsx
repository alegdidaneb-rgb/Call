import { Check, PhoneIncoming, PhoneOff } from "lucide-react";
import { useSipEngineSnapshot } from "@/hooks/useSip";
import { sipEngine } from "@/sip/engine";

/**
 * Inbound call prompt.
 *
 * Rendered from the app shell rather than from a lead page: registration is
 * app-wide, so an inbound call has to be answerable from wherever the agent
 * happens to be. Kept in its own module because it must not drag the softphone
 * panel — and through it the country table — into the eager bundle.
 */
export function IncomingCallModal() {
  const snapshot = useSipEngineSnapshot();
  const isIncoming = snapshot.direction === "inbound" && snapshot.callState === "ringing";

  if (!isIncoming) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-panel rounded-xl shadow-xl max-w-sm w-full p-6 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-success/12 flex items-center justify-center mx-auto animate-pulse">
          <PhoneIncoming className="w-8 h-8 text-success" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-ink">Incoming call</h3>
          <p className="text-sm text-muted">{snapshot.remoteName || "Unknown"}</p>
          <p className="text-sm font-mono text-muted">{snapshot.remoteNumber}</p>
        </div>
        <div className="flex items-center justify-center gap-6">
          <button
            type="button"
            onClick={() => void sipEngine.decline()}
            className="w-14 h-14 rounded-full bg-danger hover:bg-danger flex items-center justify-center text-white transition"
            title="Decline"
          >
            <PhoneOff className="w-6 h-6" />
          </button>
          <button
            type="button"
            onClick={() => void sipEngine.answer()}
            className="w-14 h-14 rounded-full bg-success hover:bg-success flex items-center justify-center text-white transition"
            title="Answer"
          >
            <Check className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
}
