export type SipProvider = "signalwire" | "telnyx" | "twilio" | "bitcall" | "custom";

export const SIP_PROVIDERS: SipProvider[] = [
  "signalwire",
  "telnyx",
  "twilio",
  "bitcall",
  "custom",
];

export interface SipPreset {
  label: string;
  /** Port used only to derive a WSS URL when the administrator leaves it blank. */
  wsPort: number;
  /** Seconds between registration refreshes. */
  registrationInterval: number;
  stunServers: string[];
  example: { sipUri: string; wsUrl: string };
  /**
   * Whether this provider's own documentation points at a TURN relay.
   *
   * Only a hint for the form: an operator can always enter TURN servers for any
   * provider, and a provider that ships a relay does not make entering one
   * unnecessary. It exists so the preset can say where the relay comes from
   * instead of leaving the operator to guess which of the eight fields matter.
   */
  turnNote?: string;
  /**
   * Whether the provider itself answers SIP over WebSocket, so a browser can
   * register to it directly.
   *
   * When this is false the provider only speaks SIP on 5060/udp or 5061/tls,
   * which a browser cannot send: the WebSocket URL must then point at a PBX or
   * a WebRTC-to-SIP gateway that the operator runs, and the provider's own SIP
   * domain belongs only in the SIP URI field.
   */
  browserReady: boolean;
  /** Explains, in the form, what to enter when `browserReady` is false. */
  browserNote?: string;
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
    browserReady: false,
    browserNote:
      "SignalWire's SIP Credential documentation lists TLS, TCP and UDP as the supported transports, and points browser calling at SignalWire's own Browser SDK rather than at SIP over WebSocket. Register this softphone against a PBX or gateway you run, or confirm SIP-over-WebSocket support with SignalWire before relying on it.",
    example: {
      sipUri: "sip:1001@pbx.example.com",
      wsUrl: "wss://pbx.example.com:8089/ws",
    },
  },
  telnyx: {
    label: "Telnyx",
    // Verified against sip.telnyx.com: the US region serves SIP over WebSocket on
    // 7443, and Telnyx's own SIP.js wrapper (@telnyx/rtc-sipjs) uses the same
    // host and port. Other regions are listed at https://sip.telnyx.com/voice.json.
    wsPort: 7443,
    registrationInterval: 600,
    stunServers: ["stun:stun.telnyx.com:3843", ...DEFAULT_STUN_SERVERS],
    browserReady: true,
    example: {
      sipUri: "sip:your-connection@sip.telnyx.com",
      wsUrl: "wss://sip.telnyx.com:7443",
    },
  },
  twilio: {
    label: "Twilio",
    wsPort: 8089,
    registrationInterval: 600,
    stunServers: DEFAULT_STUN_SERVERS,
    browserReady: false,
    browserNote:
      "Twilio does not offer SIP over WebSocket. Its SIP Domains accept registration over UDP, TCP and TLS only, and browser calling on Twilio uses the proprietary Voice JS SDK instead of SIP.js. To use this softphone, register it against a PBX or gateway you run and give that PBX the Twilio trunk.",
    example: {
      sipUri: "sip:1001@pbx.example.com",
      wsUrl: "wss://pbx.example.com:8089/ws",
    },
  },
  bitcall: {
    label: "Bitcall (through its WebRTC-SIP gateway)",
    // The gateway is installed with a TLS certificate for a domain the operator
    // chooses, so it answers on 443 rather than on an Asterisk-style 8089.
    wsPort: 443,
    registrationInterval: 600,
    stunServers: DEFAULT_STUN_SERVERS,
    browserReady: false,
    browserNote:
      "Bitcall publishes SIP on gateway.bitcall.io:5060/udp only, and a browser cannot send UDP SIP. Bitcall's own bridge, @bitcall/webrtc-sip-gateway, runs on a Linux host you control and answers SIP over WebSocket on a domain such as sip.example.com. Enter that gateway's wss:// address here — not gateway.bitcall.io. Bitcall is outbound-only, so a call from the PSTN never rings this softphone. See docs/bitcall-gateway.md.",
    turnNote:
      "The gateway's installer offers to set up coturn on the same host. Take it: it is what makes calls connect for agents behind a symmetric NAT or a corporate firewall, where STUN alone produces a call with no audio. Enter the coturn host in the TURN servers field with the static user it created.",
    example: {
      sipUri: "sip:1001@sip.example.com",
      wsUrl: "wss://sip.example.com",
    },
  },
  custom: {
    label: "Other (Asterisk, FreeSWITCH, 3CX, ...)",
    wsPort: 8089,
    registrationInterval: 600,
    stunServers: DEFAULT_STUN_SERVERS,
    // True in the sense that whatever the operator names here is expected to
    // answer SIP over WebSocket: their own PBX, or a provider-supplied gateway
    // such as Bitcall's @bitcall/webrtc-sip-gateway.
    browserReady: true,
    turnNote:
      "Asterisk and FreeSWITCH can both run a built-in TURN-ish relay, but most deployments put coturn beside them. Add its address here if agents call from behind a restrictive firewall.",
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
  /**
   * TURN relays, and the credential used with them.
   *
   * STUN only tells a browser its own public address; when both ends are behind a
   * symmetric NAT, or a firewall drops inbound UDP, the addresses they exchange are
   * unreachable and the call connects with silence in one or both directions. A TURN
   * relay carries the media instead. Every relay requires authentication, so the
   * username and credential are part of the same setting and are meaningless
   * without each other — `turnProblem` rejects a half-configured one rather than
   * letting the browser discover it mid-call.
   */
  turnUrls: string[];
  turnUsername?: string;
  turnCredential?: string;
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
  // Deriving a URL from a provider that has no SIP-over-WebSocket listener can
  // only produce an address that cannot connect -- this is how a browser ends up
  // pointed at a 5060/udp trunk. Leave the field empty so the operator has to
  // name the PBX or gateway the browser should actually talk to.
  if (!preset.browserReady) return "";
  const port = preset.wsPort === 443 ? "" : `:${preset.wsPort}`;
  return `wss://${domain}${port}`;
}

export function resolveStunUrls(provider: SipProvider, explicit?: string[] | null): string[] {
  if (explicit && explicit.length > 0) return explicit.filter(Boolean);
  return (SIP_PRESETS[provider] ?? SIP_PRESETS.custom).stunServers;
}

/**
 * Splits a whitespace- or comma-separated list of URLs.
 *
 * Build-time settings arrive as one string, and the settings form holds one URL
 * per line. Both mean the same thing, so they are parsed the same way rather than
 * each caller inventing a separator.
 */
export function splitUrlList(value: unknown): string[] {
  return String(value ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * A TURN URL, in either of the two shapes browsers take.
 *
 * RFC 7065 defines `turn:host:port`, and the `turn://host:port` form is also
 * accepted everywhere; `turns:` is the TLS variant on 5349. The port is optional
 * because it has a default, and `?transport=tcp` is what makes a relay reachable
 * through a firewall that drops UDP — which is most of the reason to run one.
 *
 * Deliberately strict about the port. `turn:host:99999999` would be accepted by a
 * permissive pattern and then fail during ICE gathering, several layers away from
 * the field somebody typed it into.
 */
const TURN_URL_PATTERN = /^(?:turns?):(?:\/\/)?[^\s/?:]+(?::\d{1,5})?(?:\?transport=(?:tcp|udp))?$/i;

export function isTurnUrl(value: string): boolean {
  return TURN_URL_PATTERN.test(value.trim());
}

/**
 * The ICE servers an account should be given.
 *
 * One definition, because this used to be written twice — once for a live call and
 * once for the configuration test — and two copies of an ICE list drift. The test
 * passing while real calls had no audio is exactly what that drift looks like.
 *
 * TURN entries are included only when the username and credential are both
 * present. Including them without credentials would not fail loudly: a relay
 * rejects the allocation, the browser quietly falls back to direct candidates, and
 * the call connects with silence. That is the failure TURN exists to prevent, so
 * `turnProblem` reports it in the form instead and this function stays quiet.
 */
export function resolveIceServers(
  account: Pick<SipAccount, "provider" | "stunUrls" | "turnUrls" | "turnUsername" | "turnCredential">
): RTCIceServer[] {
  const servers: RTCIceServer[] = resolveStunUrls(account.provider, account.stunUrls).map(
    (urls) => ({ urls })
  );

  const urls = (account.turnUrls ?? []).map((url) => url.trim()).filter(Boolean);
  const username = (account.turnUsername ?? "").trim();
  const credential = (account.turnCredential ?? "").trim();
  if (urls.length > 0 && username && credential) {
    servers.push({ urls, username, credential });
  }
  return servers;
}

/**
 * Why an account's TURN settings will not work, or null when they will.
 *
 * Returns a sentence an operator can act on rather than a boolean, because
 * "invalid" does not distinguish a mistyped URL from a relay entered without its
 * credential — and those have different fixes.
 */
export function turnProblem(
  account: Pick<SipAccount, "turnUrls" | "turnUsername" | "turnCredential">
): string | null {
  const urls = (account.turnUrls ?? []).map((url) => url.trim()).filter(Boolean);
  const username = (account.turnUsername ?? "").trim();
  const credential = (account.turnCredential ?? "").trim();

  // Nothing entered is a valid state: STUN alone works for most agents, and TURN
  // is an addition rather than a requirement.
  if (urls.length === 0 && !username && !credential) return null;

  const malformed = urls.find((url) => !isTurnUrl(url));
  if (malformed) {
    return `"${malformed}" is not a TURN server. Use turn:host:3478, or turns:host:5349 for TLS, and add ?transport=tcp if the network blocks UDP.`;
  }
  if (urls.length === 0) {
    return "A TURN username and credential need at least one TURN server to be used with.";
  }
  if (!username || !credential) {
    return "TURN servers are listed but the username or the credential is missing, so they will not be used. A relay refuses an unauthenticated allocation and the browser falls back to a direct connection, which is the silent-audio failure TURN exists to prevent.";
  }
  return null;
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
    turnUrls: splitUrlList(env.VITE_SIP_TURN_URLS),
    turnUsername: String(env.VITE_SIP_TURN_USERNAME ?? "").trim() || undefined,
    turnCredential: String(env.VITE_SIP_TURN_CREDENTIAL ?? "").trim() || undefined,
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
