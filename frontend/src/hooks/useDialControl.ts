import { useCallback, useMemo } from "react";
import { domainFromSipUri, type SipAccount } from "@/sip/config";
import { buildDialTarget } from "@/sip/dialTarget";
import { sipEngine, type SipEngineSnapshot } from "@/sip/engine";
import type { Database } from "@/types/database";

type Lead = Database["public"]["Tables"]["leads"]["Row"];

/**
 * How to reach the lead on screen, and whether the browser is able to.
 *
 * This is a hook rather than logic inside the dial panel because two callers
 * need it and they must agree: the panel renders the button, and the workspace
 * binds `d` to it. Duplicating the "can I dial" test is how a button ends up
 * enabled while the shortcut does nothing.
 *
 * Deriving the target is deliberately separate from placing the call. The
 * warning `buildDialTarget` returns is the difference between dialling a number
 * and dialling the wrong country, so it is surfaced before the operator commits
 * rather than discovered from a provider error afterwards.
 */
export function useDialControl(
  lead: Lead | null,
  account: SipAccount | null,
  snapshot: SipEngineSnapshot,
) {
  const domain = account ? domainFromSipUri(account.sipUri) : "";

  const target = useMemo(
    () => buildDialTarget(lead?.phone ?? "", lead?.country, domain),
    [lead?.phone, lead?.country, domain],
  );

  const inCall = snapshot.callState !== "idle" && snapshot.callState !== "ended";
  const registered = snapshot.status === "registered";
  const canDial = Boolean(lead) && registered && !inCall && Boolean(target.target) && !target.warning;

  const dial = useCallback(async () => {
    if (!target.target) return false;
    try {
      await sipEngine.call(target.target, target.display);
      return true;
    } catch {
      // The engine has already classified the failure into the snapshot, which
      // the UI renders with its operator hint. Swallowing it here avoids a
      // second, less useful message for the same event.
      return false;
    }
  }, [target.target, target.display]);

  const hangup = useCallback(() => void sipEngine.hangup(), []);

  /** `d` means "end it" while a call is up and "place it" otherwise. */
  const toggle = useCallback(async () => {
    if (inCall) {
      hangup();
      return;
    }
    await dial();
  }, [inCall, hangup, dial]);

  const reasonDisabled = !lead
    ? "Select a lead first"
    : !registered
      ? "The SIP trunk is not registered"
      : inCall
        ? "Already on a call"
        : target.warning
          ? target.warning
          : !target.target
            ? "This lead has no diallable number"
            : null;

  return { target, inCall, registered, canDial, dial, hangup, toggle, reasonDisabled };
}
