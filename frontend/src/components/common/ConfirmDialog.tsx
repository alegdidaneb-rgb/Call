import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { bindShortcuts, keyName, pushOverlay } from "@/lib/keys";

/**
 * A destructive-action confirmation.
 *
 * Two things were wrong with this beyond the styling. It read `bg-black/50` and
 * `text-white`, which are absolute colours that ignore the theme — so it looked
 * identical in light mode and dark mode and matched neither. And it registered no
 * way for the rest of the app to know it was open, which matters now that several
 * screens bind single-key shortcuts: pressing `d` behind a "delete this lead?"
 * dialog would have dialled the lead.
 */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Hooks run before the early return so the dialog can mount and unmount
  // without changing how many hooks the component calls.
  useEffect(() => (open ? pushOverlay() : undefined), [open]);
  useEffect(
    () =>
      open
        ? bindShortcuts(
            (event) => {
              if (keyName(event) === "Escape") {
                event.preventDefault();
                onCancel();
              }
            },
            { allowInOverlay: true },
          )
        : undefined,
    [open, onCancel],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm space-y-4 rounded-xl border border-line-strong bg-panel p-6 shadow-floating animate-scale-in"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span
            className={`shrink-0 rounded-lg p-2 ${
              variant === "danger" ? "bg-danger/12 text-danger" : "bg-warning/12 text-warning"
            }`}
          >
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 id="confirm-title" className="text-base font-semibold text-ink">
              {title}
            </h3>
            <p id="confirm-message" className="mt-1 text-sm leading-relaxed text-muted">
              {message}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="btn btn-secondary btn-sm">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`btn btn-sm ${variant === "danger" ? "btn-danger" : "btn-primary"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
