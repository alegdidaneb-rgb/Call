import { useEffect } from "react";
import { X } from "lucide-react";
import { bindShortcuts, keyName, pushOverlay } from "@/lib/keys";
import { OUTCOMES, STATUS_ACTIONS } from "@/lib/outcomes";

/**
 * Every key the workspace binds, in one place.
 *
 * A keyboard-driven screen is only faster than a mouse-driven one if the
 * operator can find the keys, so this is reachable from a button in the header
 * and from `?` — and it is generated from the same definitions the shortcuts are
 * bound to, so it cannot drift out of date when a disposition is added.
 */

interface ShortcutsOverlayProps {
  onClose: () => void;
}

const NAVIGATION: Array<[string, string]> = [
  ["↑ / k", "Previous lead in the queue"],
  ["↓ / j", "Next lead in the queue"],
  ["n", "Skip to the next lead"],
  ["f", "Filter the queue"],
  ["Esc", "Clear the filter"],
];

const CALLING: Array<[string, string]> = [
  ["d", "Call the selected lead, or end the call"],
  ["m", "Mute and unmute"],
  ["h", "Hold and resume"],
];

function Group({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div>
      <h3 className="pane-title mb-2">{title}</h3>
      <dl className="space-y-1">
        {rows.map(([key, description]) => (
          <div key={key} className="flex items-baseline justify-between gap-4">
            <dt className="shrink-0">
              <span className="kbd">{key}</span>
            </dt>
            <dd className="flex-1 text-right text-[12px] leading-relaxed text-muted">{description}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ShortcutsOverlay({ onClose }: ShortcutsOverlayProps) {
  // Announce the overlay so the workspace's own shortcuts stand down, and so
  // Escape closes this rather than also clearing the filter behind it.
  useEffect(() => pushOverlay(), []);
  useEffect(
    () =>
      bindShortcuts(
        (event) => {
          if (keyName(event) === "Escape" || keyName(event) === "?") {
            event.preventDefault();
            onClose();
          }
        },
        { allowInOverlay: true },
      ),
    [onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-line-strong bg-raised shadow-floating animate-scale-in"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-4">
          <Group title="Moving through the queue" rows={NAVIGATION} />
          <Group title="Calling" rows={CALLING} />
          <Group
            title="Recording an outcome"
            rows={OUTCOMES.map((outcome) => [outcome.key, outcome.label] as [string, string])}
          />
          <Group
            title="Setting a status without a call"
            rows={STATUS_ACTIONS.map((action) => [action.key, action.label] as [string, string])}
          />

          <p className="rounded-lg bg-inset px-3 py-2 text-[11px] leading-relaxed text-faint">
            Shortcuts are ignored while you are typing in a field, and while a
            dialog is open. <span className="kbd">⌘K</span> opens the command
            palette from anywhere in the app.
          </p>
        </div>
      </div>
    </div>
  );
}
