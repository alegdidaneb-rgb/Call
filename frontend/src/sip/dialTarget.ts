import { diallingCodeFor } from "@/data/countries";

/** Digits a SIP server can route: a leading `+` and nothing else but numbers. */
export function toDialDigits(value: string): string {
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
}

export interface DialTargetResult {
  /** A `sip:` URI ready to hand to the engine, or null when it cannot be built. */
  target: string | null;
  /** The number in international format, for display. */
  display: string;
  /**
   * Set when the number cannot be dialled safely. Surfaced to the operator
   * instead of silently placing a call to the wrong country.
   */
  warning: string | null;
}

/**
 * Build the SIP target for a lead.
 *
 * A stored number may be local (`07700 900123`) or already international
 * (`+447700900123`). When it is local we prefix the dialling code for the lead's
 * country — which is why leads carry an ISO country code at all. Shared dialling
 * codes are never guessed: if the country is ambiguous or missing, we return a
 * warning rather than dialling a number that could land in another country.
 *
 * This lives apart from `config.ts` on purpose. `config.ts` is on the eager path
 * (the app shell registers the softphone on load), and the country table it
 * would drag in is only needed by the lead page that actually dials.
 */
export function buildDialTarget(
  phone: string | null | undefined,
  countryCode: string | null | undefined,
  sipDomain: string,
): DialTargetResult {
  const raw = (phone ?? "").trim();
  if (!raw || !sipDomain) return { target: null, display: raw, warning: null };

  if (raw.startsWith("+")) {
    const digits = toDialDigits(raw);
    return {
      target: digits ? `sip:${digits}@${sipDomain}` : null,
      display: digits,
      warning: digits ? null : "This number has no digits in it.",
    };
  }

  const digits = toDialDigits(raw);
  if (!digits) return { target: null, display: raw, warning: "This number has no digits in it." };

  if (!countryCode) {
    return {
      target: null,
      display: raw,
      warning:
        "This number is not in international format and the lead has no country set. " +
        "Add the country, or enter the number with a leading +.",
    };
  }

  const dial = diallingCodeFor(countryCode);
  if (!dial) {
    return {
      target: null,
      display: raw,
      warning:
        "This number is not in international format and its country shares a dialling " +
        "code with other countries, so the prefix cannot be inferred. Enter the number " +
        "with a leading +.",
    };
  }

  // A leading trunk zero is dropped when converting to international format
  // (`07700 900123` -> `+447700900123`), which is how every such country writes it.
  const national = digits.replace(/^0+/, "");
  if (!national) {
    return { target: null, display: raw, warning: "This number has no digits in it." };
  }

  const international = `${dial}${national}`;
  return { target: `sip:${international}@${sipDomain}`, display: international, warning: null };
}
