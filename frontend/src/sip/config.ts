export type SipProvider = "signalwire" | "telnyx" | "twilio" | "custom";

export const SIP_PROVIDERS: SipProvider[] = ["signalwire", "telnyx", "twilio", "custom"];

export interface SipPreset {
  label: string;
  /** Port used only to derive a WSS URL when the administrator leaves it blank. */
  wsPort: number;
  /** Seconds between registration refreshes. */
  registrationInterval: number;
  stunServers: string[];
  example: { sipUri: string; wsUrl: string };
}

/** STUN servers that work for every provider; used unless the account overrides them. */
export const DEFAULT_STUN_SERVERS = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
];

export const SIP_PRESETS: Record<SipProvider, SipPreset> = {
  signalwire: {
    label: "SignalWire",
    wsPort: 5066,
    registrationInterval: 600,
    stunServers: ["stun:stun.signalwire.com", ...DEFAULT_STUN_SERVERS],
    example: {
      sipUri: "sip:1001@your-space.sip.signalwire.com",
      wsUrl: "wss://your-space.sip.signalwire.com:5066",
    },
  },
  telnyx: {
    label: "Telnyx",
    wsPort: 443,
    registrationInterval: 600,
    stunServers: ["stun:stun.telnyx.com", ...DEFAULT_STUN_SERVERS],
    example: {
      sipUri: "sip:your-connection@sip.telnyx.com",
      wsUrl: "wss://sip.telnyx.com",
    },
  },
  twilio: {
    label: "Twilio",
    wsPort: 443,
    registrationInterval: 600,
    stunServers: DEFAULT_STUN_SERVERS,
    example: {
      sipUri: "sip:your-client@your-domain.sip.twilio.com",
      wsUrl: "wss://your-domain.sip.twilio.com",
    },
  },
  custom: {
    label: "Other (Asterisk, FreeSWITCH, 3CX, ...)",
    wsPort: 8089,
    registrationInterval: 600,
    stunServers: DEFAULT_STUN_SERVERS,
    example: { sipUri: "sip:1001@pbx.example.com", wsUrl: "wss://pbx.example.com:8089/ws" },
  },
};

/**
 * A resolved set of credentials the softphone can register with.
 *
 * `source` records where they came from so the UI can explain why a change needs
 * a redeploy (build-time environment variables) or not (database settings).
 */
export interface SipAccount {
  source: "database" | "env";
  id?: string;
  label?: string;
  provider: SipProvider;
  sipUri: string;
  password: string;
  wsUrl: string;
  callerId?: string;
  stunUrls: string[];
  registerExpiry: number;
  /** True when this row is the shared trunk default rather than a per-agent one. */
  isTrunkDefault?: boolean;
}

export interface ParsedSipUri {
  user: string;
  domain: string;
}

/**
 * Accepts `sip:1001@host`, `sips:1001@host`, `1001@host` and returns the parts.
 * Returns null rather than guessing when the input is not a usable AOR.
 */
export function parseSipUri(input: string): ParsedSipUri | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /^(?:sips?:)?([^@;\s]+)@([^;\s]+)$/i.exec(trimmed);
  if (!match) return null;
  const [, user, domain] = match;
  if (!user || !domain || !domain.includes(".")) return null;
  return { user, domain };
}

/** Canonical `sip:user@domain` form, or null if the input cannot be parsed. */
export function normaliseSipUri(input: string): string | null {
  const parsed = parseSipUri(input);
  return parsed ? `sip:${parsed.user}@${parsed.domain}` : null;
}

export function usernameFromSipUri(input: string): string {
  return parseSipUri(input)?.user ?? "";
}

export function domainFromSipUri(input: string): string {
  return parseSipUri(input)?.domain ?? "";
}

/**
 * Best-effort WSS URL for a provider when the administrator does not supply one.
 * Returns a `wss://` URL because a page served over HTTPS is not allowed to open
 * an insecure `ws://` socket.
 */
export function deriveWsUrl(provider: SipProvider, domain: string): string {
  if (!domain) return "";
  const preset = SIP_PRESETS[provider] ?? SIP_PRESETS.custom;
  const port = preset.wsPort === 443 ? "" : `:${preset.wsPort}`;
  return `wss://${domain}${port}`;
}

export function resolveStunUrls(provider: SipProvider, explicit?: string[] | null): string[] {
  if (explicit && explicit.length > 0) return explicit.filter(Boolean);
  return (SIP_PRESETS[provider] ?? SIP_PRESETS.custom).stunServers;
}

/** Credentials baked in at build time. Kept working for existing deployments. */
export function envSipAccount(): SipAccount | null {
  const env = import.meta.env;
  const sipUri = normaliseSipUri(String(env.VITE_SIP_URI ?? ""));
  const password = String(env.VITE_SIP_PASSWORD ?? "").trim();
  if (!sipUri || !password) return null;

  const provider = (SIP_PROVIDERS.includes(env.VITE_SIP_PROVIDER as SipProvider)
    ? env.VITE_SIP_PROVIDER
    : "custom") as SipProvider;
  const domain = domainFromSipUri(sipUri);
  const wsUrl = String(env.VITE_SIP_WS_URL ?? "").trim() || deriveWsUrl(provider, domain);

  return {
    source: "env",
    provider,
    sipUri,
    password,
    wsUrl,
    callerId: String(env.VITE_SIP_CALLER_ID ?? "").trim() || undefined,
    stunUrls: resolveStunUrls(provider),
    registerExpiry: SIP_PRESETS[provider].registrationInterval,
  };
}

/** An account is only usable once it can both register and be reached. */
export function isUsableAccount(account: SipAccount | null): boolean {
  if (!account) return false;
  return Boolean(
    parseSipUri(account.sipUri) &&
      account.password &&
      /^wss:\/\/[^\s]+$/i.test(account.wsUrl.trim()),
  );
}
