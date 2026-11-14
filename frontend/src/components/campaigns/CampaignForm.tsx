import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { bindShortcuts, keyName, pushOverlay } from "@/lib/keys";
import type { CampaignRow } from "@/lib/apiClient";

/**
 * The create/edit dialog for a campaign.
 *
 * Three changes beyond the styling. It now registers itself as an overlay and
 * closes on Escape, so the single-key shortcuts the workspace binds cannot fire
 * through it — the same defect `ConfirmDialog` had. The "Settings (JSON)"
 * textarea is gone: nothing in the app reads `campaigns.settings`, so it asked
 * operators to hand-write JSON that no screen ever interpreted, and a syntax
 * error in it blocked saving a campaign whose other fields were fine. Any
 * settings already stored are passed through untouched rather than cleared. And
 * the type and status are segmented controls showing the whole choice at once
 * instead of two dropdowns that hide their options until clicked.
 */

const TYPES = [
  { value: "outbound", label: "Outbound", hint: "Agents dial out" },
  { value: "inbound", label: "Inbound", hint: "Calls come in" },
  { value: "blended", label: "Blended", hint: "Both directions" },
] as const;

const STATUSES = [
  { value: "active", label: "Active", hint: "Open for calling" },
  { value: "paused", label: "Paused", hint: "Kept out of the queue" },
  { value: "completed", label: "Completed", hint: "Finished, kept for reporting" },
] as const;

type CampaignType = (typeof TYPES)[number]["value"];
type CampaignStatus = (typeof STATUSES)[number]["value"];

export interface CampaignFormValues {
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  /** Carried through from the existing row so an edit cannot erase it. */
  settings: CampaignRow["settings"];
}

interface CampaignFormProps {
  open: boolean;
  /** The campaign being edited, or null to create one. */
  campaign?: CampaignRow | null;
  onClose: () => void;
  onSubmit: (values: CampaignFormValues) => Promise<void>;
}

function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: readonly { value: T; label: string; hint: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-inset p-1" role="radiogroup" aria-label={name}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`rounded px-2 py-1.5 text-center transition-colors ${
              selected
                ? "bg-panel text-ink shadow-panel"
                : "text-muted hover:bg-hover hover:text-ink"
            }`}
          >
            <span className="block text-xs font-semibold">{option.label}</span>
            <span className="mt-0.5 block text-2xs leading-tight text-faint">{option.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

export function CampaignForm({ open, campaign = null, onClose, onSubmit }: CampaignFormProps) {
  const titleId = useId();
  const nameId = useId();
  const [name, setName] = useState("");
  const [type, setType] = useState<CampaignType>("outbound");
  const [status, setStatus] = useState<CampaignStatus>("active");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to the row being edited each time the dialog opens, so reopening it
  // after a cancel does not carry the previous attempt's values.
  useEffect(() => {
    if (!open) return;
    setName(campaign?.name ?? "");
    setType((campaign?.type as CampaignType) ?? "outbound");
    setStatus((campaign?.status as CampaignStatus) ?? "active");
    setError(null);
    setPending(false);
  }, [open, campaign]);

  useEffect(() => (open ? pushOverlay() : undefined), [open]);
  useEffect(
    () =>
      open
        ? bindShortcuts(
            (event) => {
              if (keyName(event) === "Escape") {
                event.preventDefault();
                onClose();
              }
            },
            { allowInOverlay: true },
          )
        : undefined,
    [open, onClose],
  );

  if (!open) return null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("A campaign needs a name.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      await onSubmit({
        name: trimmed,
        type,
        status,
        settings: campaign?.settings ?? null,
      });
    } catch (caught) {
      // Keep the dialog open with the values intact so the operator can correct
      // and retry rather than retype everything.
      setError(caught instanceof Error ? caught.message : "Could not save the campaign.");
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-line-strong bg-panel shadow-floating animate-scale-in"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {campaign ? "Edit campaign" : "New campaign"}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {campaign
                ? "Changes apply to every lead already assigned to this campaign."
                : "Leads can be assigned to it once it exists."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn btn-ghost btn-sm -mr-1.5 -mt-1 !px-1.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <div>
            <label className="label" htmlFor={nameId}>
              Campaign name
            </label>
            <input
              id={nameId}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              autoFocus
              placeholder="Q4 renewals — Milan"
              className="input"
              aria-invalid={Boolean(error && !name.trim())}
            />
          </div>

          <div>
            <span className="label">Direction</span>
            <Segmented name="Direction" value={type} options={TYPES} onChange={setType} />
          </div>

          <div>
            <span className="label">Status</span>
            <Segmented name="Status" value={status} options={STATUSES} onChange={setStatus} />
          </div>

          {error ? (
            <p className="rounded-lg border border-danger/30 bg-danger/12 px-3 py-2 text-xs text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button type="button" onClick={onClose} className="btn btn-secondary btn-sm" disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
              {pending ? "Saving…" : campaign ? "Save changes" : "Create campaign"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
