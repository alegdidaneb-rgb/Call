/**
 * What the softphone reports when a call finishes.
 *
 * `sipCallId`, `startedAt` and `endedAt` were previously thrown away and written
 * to the call log as nulls. The SIP Call-ID is the only field that lets a logged
 * call be matched against the provider's own record — which is what you need
 * when a prospect disputes having been called, or when reconciling a bill.
 */
export interface CallEndData {
  outcome: string;
  /** Talk seconds only; ring time is excluded. */
  duration: number;
  notes: string;
  direction: "outbound" | "inbound";
  sipCallId: string | null;
  startedAt: string | null;
  endedAt: string | null;
}
