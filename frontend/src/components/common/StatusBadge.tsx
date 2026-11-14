import {
  chipClass,
  outcomeDefinition,
  outcomeLabel,
  outcomeTone,
  statusLabel,
  statusTone,
  type Tone,
} from "@/lib/outcomes";

/**
 * The pill that names a lead status, a call outcome or a campaign status.
 *
 * This used to carry its own 27-entry colour table, which is how the same word
 * ended up meaning two different colours in the same app: it painted `busy`
 * red and `wrong_number` grey, while `lib/outcomes` — the source the workspace
 * and call history read from — painted `busy` amber and `wrong_number` red. An
 * operator comparing the workspace chip to the lead record was being shown
 * contradictory information about the same call.
 *
 * The vocabulary now resolves against `lib/outcomes` and this file only adds the
 * campaign statuses, which are a genuinely separate enum.
 */

/** Campaign lifecycle — not a lead status and not a call outcome. */
const CAMPAIGN_TONES: Record<string, Tone> = {
  active: "success",
  paused: "warning",
  scheduled: "accent",
  completed: "info",
  cancelled: "danger",
};

const CAMPAIGN_LABELS: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
};

interface StatusBadgeProps {
  status: string | null | undefined;
  /**
   * Which vocabulary to read the value against. Omit it to resolve
   * automatically, which is right when the three vocabularies cannot collide —
   * they currently cannot, and every existing call site relies on that.
   */
  kind?: "lead" | "outcome" | "campaign";
}

function resolve(status: string, kind: StatusBadgeProps["kind"]): { tone: Tone; label: string } {
  if (kind === "campaign" || (!kind && status in CAMPAIGN_TONES)) {
    return {
      tone: CAMPAIGN_TONES[status] ?? "neutral",
      label: CAMPAIGN_LABELS[status] ?? statusLabel(status),
    };
  }
  if (kind === "outcome" || (!kind && outcomeDefinition(status))) {
    return { tone: outcomeTone(status), label: outcomeLabel(status) };
  }
  return { tone: statusTone(status), label: statusLabel(status) };
}

export function StatusBadge({ status, kind }: StatusBadgeProps) {
  if (!status) {
    return <span className="chip bg-hover text-faint">Not set</span>;
  }

  const { tone, label } = resolve(status, kind);

  return (
    <span className={`chip ${chipClass(tone)}`} title={label}>
      {label}
    </span>
  );
}
