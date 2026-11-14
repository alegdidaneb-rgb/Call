import type { Database } from "@/types/database";

/**
 * Disposition codes, and what each one means for the lead.
 *
 * These lived as a bare `<select>` of strings inside the softphone, which made
 * three things impossible: the queue could not know whether a disposition should
 * move the agent on, the lead's status was guessed with a single ternary, and
 * there was no place to hang a hotkey. Defining them once, with their
 * consequences attached, is what lets the calling workspace behave like a dialer
 * instead of a form.
 *
 * This module is deliberately the single source of truth: making dispositions
 * editable per tenant later means replacing these arrays with rows and keeping
 * the same shape.
 */

export type CallOutcome = Database["public"]["Tables"]["call_logs"]["Row"]["outcome"];
export type LeadStatus = Database["public"]["Tables"]["leads"]["Row"]["status"];

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "alt";

/*
 * Full class strings rather than composed fragments, because Tailwind can only
 * see what is written literally in source. A `bg-${tone}/12` template would
 * compile to nothing at all.
 */
const CHIP: Record<Tone, string> = {
  neutral: "bg-hover text-muted",
  accent: "bg-accent/12 text-accent",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
  info: "bg-info/12 text-info",
  alt: "bg-alt/12 text-alt",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-steel",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  alt: "bg-alt",
};

const TEXT: Record<Tone, string> = {
  neutral: "text-muted",
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  alt: "text-alt",
};

const BORDER: Record<Tone, string> = {
  neutral: "border-line-strong",
  accent: "border-accent",
  success: "border-success",
  warning: "border-warning",
  danger: "border-danger",
  info: "border-info",
  alt: "border-alt",
};

export function chipClass(tone: Tone): string {
  return CHIP[tone];
}
export function dotClass(tone: Tone): string {
  return DOT[tone];
}
export function textClass(tone: Tone): string {
  return TEXT[tone];
}
export function borderClass(tone: Tone): string {
  return BORDER[tone];
}

export interface OutcomeDefinition {
  value: CallOutcome;
  label: string;
  /**
   * The lead status this disposition implies, or `null` when it says nothing
   * about the lead — a ring-out on a third attempt must not erase the fact that
   * somebody answered the first two.
   */
  leadStatus: LeadStatus | null;
  /** Hotkey in the disposition row. */
  key: string;
  tone: Tone;
  /** What pressing this actually does, shown until the agent has learned it. */
  hint: string;
  /** Whether the queue should move on to the next lead afterwards. */
  advances: boolean;
}

export const OUTCOMES: OutcomeDefinition[] = [
  {
    value: "answered",
    label: "Answered",
    leadStatus: "contacted",
    key: "1",
    tone: "success",
    hint: "Reached a person. Use the status buttons if the call went further.",
    advances: true,
  },
  {
    value: "no_answer",
    label: "No answer",
    leadStatus: null,
    key: "2",
    tone: "neutral",
    hint: "Rang out. The lead stays in the queue for another attempt.",
    advances: true,
  },
  {
    value: "busy",
    label: "Busy",
    leadStatus: "callback",
    key: "3",
    tone: "warning",
    hint: "Line engaged. Comes back as a callback.",
    advances: true,
  },
  {
    value: "voicemail",
    label: "Voicemail",
    leadStatus: "contacted",
    key: "4",
    tone: "info",
    hint: "Answering machine, or a message was left.",
    advances: true,
  },
  {
    value: "dnc",
    label: "Do not contact",
    leadStatus: "do_not_contact",
    key: "5",
    tone: "danger",
    hint: "Asked not to be called. Removed from every queue permanently.",
    advances: true,
  },
  {
    value: "wrong_number",
    label: "Wrong number",
    leadStatus: "do_not_contact",
    key: "6",
    tone: "danger",
    hint: "Not this person. Stops the queue re-dialling a dead number.",
    advances: true,
  },
  {
    value: "disconnected",
    label: "Disconnected",
    leadStatus: null,
    key: "7",
    tone: "neutral",
    hint: "Call dropped before it could be finished.",
    advances: true,
  },
];

const OUTCOME_BY_VALUE = new Map<CallOutcome, OutcomeDefinition>(
  OUTCOMES.map((outcome) => [outcome.value, outcome]),
);

export function outcomeDefinition(value: string | null | undefined): OutcomeDefinition | undefined {
  if (!value) return undefined;
  return OUTCOME_BY_VALUE.get(value as CallOutcome);
}

export function outcomeLabel(value: string | null | undefined): string {
  return outcomeDefinition(value)?.label ?? value?.replace(/_/g, " ") ?? "—";
}

export function outcomeTone(value: string | null | undefined): Tone {
  return outcomeDefinition(value)?.tone ?? "neutral";
}

/** Statuses an operator can set directly, without a call having taken place. */
export interface StatusAction {
  value: LeadStatus;
  label: string;
  key: string;
  tone: Tone;
  hint: string;
}

export const STATUS_ACTIONS: StatusAction[] = [
  {
    value: "interested",
    label: "Interested",
    key: "i",
    tone: "success",
    hint: "Wants to hear more. Stays in the queue, at the front of it.",
  },
  {
    value: "callback",
    label: "Callback",
    key: "c",
    tone: "warning",
    hint: "Call back later. Stays in the queue.",
  },
  {
    value: "not_interested",
    label: "Not interested",
    key: "x",
    tone: "neutral",
    hint: "Declined. Leaves the queue; the record is kept.",
  },
  {
    value: "converted",
    label: "Converted",
    key: "v",
    tone: "accent",
    hint: "Won. Leaves the queue.",
  },
];

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  interested: "Interested",
  not_interested: "Not interested",
  callback: "Callback",
  converted: "Converted",
  do_not_contact: "Do not contact",
};

const STATUS_TONES: Record<LeadStatus, Tone> = {
  new: "accent",
  contacted: "info",
  interested: "success",
  not_interested: "neutral",
  callback: "warning",
  converted: "alt",
  do_not_contact: "danger",
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return STATUS_LABELS[status as LeadStatus] ?? status.replace(/_/g, " ");
}

export function statusTone(status: string | null | undefined): Tone {
  return STATUS_TONES[status as LeadStatus] ?? "neutral";
}

/**
 * How far a status has progressed. Used to stop a disposition from walking a
 * lead backwards.
 */
const STATUS_RANK: Record<LeadStatus, number> = {
  new: 0,
  contacted: 1,
  callback: 2,
  not_interested: 3,
  interested: 4,
  converted: 5,
  do_not_contact: 6,
};

/** True when the lead should no longer appear in a dialling queue. */
export function isQueueFinished(status: LeadStatus | string | null | undefined, dnc?: boolean): boolean {
  if (dnc) return true;
  return status === "do_not_contact" || status === "converted" || status === "not_interested";
}

/**
 * Resolve the status a lead should end up with after a disposition.
 *
 * Two rules matter and both are the kind of thing that silently destroys data if
 * nobody writes them down:
 *
 * - A disposition never walks a lead backwards. Logging "answered" on a lead
 *   that is already `interested` must not demote it to `contacted`.
 * - `do_not_contact` and `converted` are terminal. Nothing resurrects them,
 *   because re-dialling somebody who asked you to stop is a compliance problem,
 *   not a UI bug.
 */
export function nextLeadStatus(current: LeadStatus | null, desired: LeadStatus | null): LeadStatus | null {
  if (!desired) return current;
  if (!current) return desired;
  if (desired === "do_not_contact") return desired;
  if (current === "do_not_contact" || current === "converted") return current;
  return STATUS_RANK[desired] > STATUS_RANK[current] ? desired : current;
}

/**
 * The outcome the UI should preselect once a call has finished, derived from
 * what the engine actually observed rather than left at a default.
 *
 * A call that was answered has a `startedAtMs`; one that rang out does not. That
 * is the only honest signal available in the browser, so it is the one used.
 */
export function impliedOutcome(startedAtMs: number | null): CallOutcome {
  return startedAtMs ? "answered" : "no_answer";
}
