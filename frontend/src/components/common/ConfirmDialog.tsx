import React from "react";
import { AlertTriangle, X } from "lucide-react";

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
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-panel rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div
            className={`p-2 rounded-lg ${
              variant === "danger" ? "bg-danger/12" : "bg-warning/12"
            }`}
          >
            <AlertTriangle
              className={`w-5 h-5 ${
                variant === "danger" ? "text-danger" : "text-warning"
              }`}
            />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-ink">{title}</h3>
            <p className="text-sm text-muted mt-1">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-ink bg-hover hover:bg-line rounded-lg transition"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition ${
              variant === "danger"
                ? "bg-danger hover:bg-danger/90"
                : "bg-accent hover:bg-accent-strong"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
