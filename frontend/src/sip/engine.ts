// Types only: erased at build time, so importing them costs nothing. The
// runtime module is loaded on demand inside connect() and testSipAccount().
import type * as SipJs from "sip.js";

type SipSessionManager = SipJs.Web.SessionManager;
type SipSession = SipJs.Session;
import {
  isUsableAccount,
  resolveStunUrls,
  usernameFromSipUri,
  type SipAccount,
} from "./config";

/**
 * Why a call could not be placed, as a machine-readable code.
 *
 * The previous softphone swallowed every failure and animated a fake call
 * instead, which meant an operator could not tell "not configured" from "wrong
 * password" from "microphone blocked" — and every one of those logged an
 * `answered` call record for a call that never happened. Failures are therefore
 * classified here and shown verbatim in the UI.
 */
export type SipFailureCode =
  | "not_configured"
  | "insecure_context"
  | "mic_denied"
  | "mic_unavailable"
  | "invalid_target"
  | "transport_failed"
  | "registration_rejected"
  | "registration_timeout"
  | "call_failed"
  | "already_in_call";

export interface SipFailure {
  code: SipFailureCode;
  message: string;
  /** What the operator can actually do about it. */
  hint?: string;
}

export type SipConnectionStatus =
  | "unconfigured"
  | "disconnected"
  | "connecting"
  | "registering"
  | "registered"
  | "error";

export type SipCallState = "idle" | "dialling" | "ringing" | "active" | "held" | "ended";

export interface SipEngineSnapshot {
  status: SipConnectionStatus;
  callState: SipCallState;
  muted: boolean;
  /** SIP Call-ID of the current or last call, for reconciling with provider CDRs. */
  callId: string | null;
  remoteNumber: string | null;
  remoteName: string | null;
  direction: "outbound" | "inbound";
  /** Epoch ms the call was answered; null until then, so ring time is not billed as talk time. */
  startedAtMs: number | null;
  endedAtMs: number | null;
  failure: SipFailure | null;
  /** Label of the account in use, shown so an agent knows which extension dialled. */
  accountLabel: string | null;
}

const INITIAL_SNAPSHOT: SipEngineSnapshot = {
  status: "unconfigured",
  callState: "idle",
  muted: false,
  callId: null,
  remoteNumber: null,
  remoteName: null,
  direction: "outbound",
  startedAtMs: null,
  endedAtMs: null,
  failure: null,
  accountLabel: null,
};

const REGISTER_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, failure: SipFailure): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(failure.message), { sipFailure: failure })), ms);
    }),
  ]);
}

function asFailure(error: unknown, fallback: SipFailure): SipFailure {
  if (error && typeof error === "object" && "sipFailure" in error) {
    return (error as { sipFailure: SipFailure }).sipFailure;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message ? { ...fallback, message: `${fallback.message} (${message})` } : fallback;
}

/**
 * The remote party's audio.
 *
 * Created once at module scope rather than rendered by a component: the element
 * must outlive the lead page, because navigating to the next lead while a call
 * is up would otherwise unmount the element carrying the call audio.
 */
let remoteAudioEl: HTMLAudioElement | null = null;

function remoteAudio(): HTMLAudioElement {
  if (!remoteAudioEl) {
    const el = document.createElement("audio");
    el.autoplay = true;
    // Safari will not play remote audio without these.
    el.setAttribute("playsinline", "");
    el.setAttribute("aria-hidden", "true");
    el.style.display = "none";
    document.body.appendChild(el);
    remoteAudioEl = el;
  }
  return remoteAudioEl;
}

async function acquireMicrophone(): Promise<void> {
  if (!window.isSecureContext) {
    throw Object.assign(new Error("insecure context"), {
      sipFailure: {
        code: "insecure_context",
        message: "Calls need a secure origin.",
        hint: "Browsers only allow microphone and WebRTC access over HTTPS (or localhost). Serve this app over HTTPS.",
      } satisfies SipFailure,
    });
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("getUserMedia unavailable"), {
      sipFailure: {
        code: "mic_unavailable",
        message: "This browser cannot access a microphone.",
        hint: "Use a current Chrome, Edge, Firefox or Safari over HTTPS.",
      } satisfies SipFailure,
    });
  }
  try {
    // Ask before dialling so a denial produces a clear message instead of a
    // half-established call with no audio.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    const failure: SipFailure =
      name === "NotAllowedError" || name === "SecurityError"
        ? {
            code: "mic_denied",
            message: "Microphone access was blocked.",
            hint: "Allow the microphone for this site in your browser's address bar, then dial again.",
          }
        : {
            code: "mic_unavailable",
            message: "No microphone could be opened.",
            hint:
              name === "NotFoundError"
                ? "Connect a microphone and try again."
                : "Close other apps that may be holding the microphone, then try again.",
          };
    throw Object.assign(new Error(failure.message), { sipFailure: failure });
  }
}

type Listener = (snapshot: SipEngineSnapshot) => void;

/**
 * A one-line browser softphone over SIP.js's `SessionManager`.
 *
 * `SessionManager` is used rather than a hand-rolled `UserAgent` because it owns
 * registration refresh, transport reconnection and — critically — binding the
 * remote media stream to an audio element. Doing that by hand is where the
 * previous implementation failed: it never attached any audio, so even a
 * correctly configured call would have connected in silence.
 */
class SipEngine {
  private snapshot: SipEngineSnapshot = { ...INITIAL_SNAPSHOT };
  private listeners = new Set<Listener>();
  private manager: SipSessionManager | null = null;
  private session: SipSession | null = null;
  private account: SipAccount | null = null;
  /** Credentials currently connected, as a comparable key. */
  private connectedKey: string | null = null;
  private connecting: Promise<void> | null = null;
  private connectingKey: string | null = null;
  /** Resolved by the `onRegistered` delegate, i.e. by a real 200 OK. */
  private registeredResolve: (() => void) | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  get current(): SipEngineSnapshot {
    return this.snapshot;
  }

  get configured(): boolean {
    return isUsableAccount(this.account);
  }

  private emit(patch: Partial<SipEngineSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  private fail(failure: SipFailure): void {
    this.emit({ failure, status: this.manager ? "error" : "unconfigured" });
  }

  /**
   * Point the engine at an account and connect.
   *
   * Reconnecting with different credentials tears the old transport down first;
   * the previous implementation built a fresh user agent per call and never
   * stopped it, leaking a socket and a stale registration on every dial.
   */
  async configure(account: SipAccount | null): Promise<void> {
    const usable = isUsableAccount(account);
    if (!account || !usable) {
      await this.disconnect();
      this.account = null;
      this.emit({
        ...INITIAL_SNAPSHOT,
        status: "unconfigured",
        failure: account
          ? {
              code: "not_configured",
              message: "The SIP settings are incomplete.",
              hint: "A WebSocket URL must start with wss:// and the SIP URI must look like sip:extension@domain.",
            }
          : {
              code: "not_configured",
              message: "No SIP account is configured.",
              hint: "An administrator can add one on the Phone page. Until then, use the 'Open in phone' link to dial through your own softphone.",
            },
      });
      return;
    }

    const key = `${account.sipUri}|${account.password}|${account.wsUrl}`;
    if (this.manager && this.connectedKey === key) return;
    // React 18 StrictMode runs effects twice, and the shell re-renders whenever
    // the account query settles. Two concurrent attempts would register the same
    // extension twice, so an in-flight connection is shared.
    if (this.connecting && this.connectingKey === key) return this.connecting;

    await this.disconnect();
    this.account = account;
    this.connectingKey = key;
    this.connecting = this.connect(account, key);
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
      this.connectingKey = null;
    }
  }

  private async connect(account: SipAccount, key: string): Promise<void> {
    this.emit({ status: "connecting", failure: null, accountLabel: account.label ?? account.sipUri });

    try {
      const stunUrls = resolveStunUrls(account.provider, account.stunUrls);
      const { Web } = await import("sip.js");
      const manager = new Web.SessionManager(account.wsUrl, {
        aor: account.sipUri,
        // One line: a second inbound call is rejected automatically rather than
        // being answered into a conference nobody asked for.
        maxSimultaneousSessions: 1,
        registrationRetry: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 4,
        media: {
          constraints: { audio: true, video: false },
          remote: { audio: remoteAudio() },
        },
        registererOptions: { expires: account.registerExpiry },
        userAgentOptions: {
          authorizationUsername: usernameFromSipUri(account.sipUri),
          authorizationPassword: account.password,
          displayName: account.callerId || undefined,
          reconnectionAttempts: 3,
          reconnectionDelay: 4,
          sessionDescriptionHandlerFactoryOptions: {
            // Without STUN a browser behind NAT offers only host candidates and
            // the call connects with no audio in one or both directions.
            peerConnectionConfiguration: {
              iceServers: stunUrls.map((urls) => ({ urls })),
            },
          },
        },
        delegate: {
          onServerConnect: () => this.emit({ status: "registering", failure: null }),
          onServerDisconnect: (error?: Error) => {
            if (this.session) this.handleTerminated();
            this.manager = null;
            this.connectedKey = null;
            this.registeredResolve = null;
            this.emit({
              status: "disconnected",
              failure: error
                ? {
                    code: "transport_failed",
                    message: "Lost the connection to the SIP server.",
                    hint: `Could not stay connected to ${account.wsUrl}. Check the WebSocket URL and that the server accepts connections from this origin.`,
                  }
                : null,
            });
          },
          onRegistered: () => {
            this.registeredResolve?.();
            this.registeredResolve = null;
            this.emit({ status: "registered", failure: null });
          },
          onUnregistered: () => {
            if (this.snapshot.status === "registered") this.emit({ status: "disconnected" });
          },
          onCallCreated: (session: SipSession) => {
            this.session = session;
            this.emit({ callState: "dialling", failure: null, endedAtMs: null });
          },
          onCallReceived: (session: SipSession) => {
            this.session = session;
            const identity = session.remoteIdentity;
            this.emit({
              callState: "ringing",
              direction: "inbound",
              remoteNumber: identity?.uri?.user ?? null,
              remoteName: identity?.displayName ?? null,
              failure: null,
            });
          },
          onCallAnswered: (session: SipSession) => {
            this.session = session;
            this.emit({
              callState: "active",
              startedAtMs: Date.now(),
              endedAtMs: null,
              callId: session.dialog?.callId ?? this.snapshot.callId,
            });
            // Browsers need this even with autoplay set; the dial click is the
            // user gesture that makes it allowed.
            void remoteAudio()
              .play()
              .catch(() => {
                this.emit({
                  failure: {
                    code: "call_failed",
                    message: "Audio playback was blocked by the browser.",
                    hint: "Click anywhere on the page once, then the call audio will start.",
                  },
                });
              });
          },
          onCallHold: (_session: SipSession, held: boolean) => {
            this.emit({ callState: held ? "held" : "active" });
          },
          onCallHangup: () => this.handleTerminated(),
        },
      });

      this.manager = manager;

      // Set up the confirmation listener before registering: `register()`
      // resolves when the REGISTER request has merely been *sent*, so awaiting it
      // alone would report a rejected password as a successful connection. Only
      // the server's 200 OK, surfaced through onRegistered, counts.
      const confirmed = new Promise<void>((resolve) => {
        this.registeredResolve = resolve;
      });

      await withTimeout(manager.connect(), CONNECT_TIMEOUT_MS, {
        code: "transport_failed",
        message: "Could not reach the SIP server.",
        hint: `Nothing answered at ${account.wsUrl}. Check the WebSocket URL, and that the provider allows browser (WSS) registration.`,
      });

      this.emit({ status: "registering" });

      await manager.register();

      await withTimeout(confirmed, REGISTER_TIMEOUT_MS, {
        code: "registration_rejected",
        message: "The server did not confirm registration.",
        hint: "Usually a wrong SIP URI or password, or an extension that is not enabled for WebRTC. The server accepted the connection but never confirmed the registration.",
      });

      this.connectedKey = key;
      this.emit({ status: "registered", failure: null });
    } catch (error) {
      const failure = asFailure(error, {
        code: "registration_timeout",
        message: "Registration timed out.",
        hint: "The SIP server did not answer in time. Check the WebSocket URL and your network.",
      });
      await this.teardown();
      this.emit({ status: "error", failure });
      throw error;
    }
  }

  /** Connect if needed, then place the call. Returns once dialling has started. */
  async call(target: string, remoteNumber: string): Promise<void> {
    if (!this.account) {
      this.fail({
        code: "not_configured",
        message: "No SIP account is configured.",
        hint: "An administrator can add one on the Phone page.",
      });
      throw new Error("not_configured");
    }
    if (!target.startsWith("sip:")) {
      this.fail({
        code: "invalid_target",
        message: "That number cannot be dialled.",
        hint: "Enter the number in international format with a leading +.",
      });
      throw new Error("invalid_target");
    }
    if (this.session && this.snapshot.callState !== "ended" && this.snapshot.callState !== "idle") {
      this.fail({
        code: "already_in_call",
        message: "A call is already in progress.",
        hint: "Hang up the current call first.",
      });
      throw new Error("already_in_call");
    }

    this.emit({
      callState: "dialling",
      direction: "outbound",
      remoteNumber,
      remoteName: null,
      startedAtMs: null,
      endedAtMs: null,
      callId: null,
      muted: false,
      failure: null,
    });

    try {
      if (!this.manager) await this.configure(this.account);
      await acquireMicrophone();
      const manager = this.manager;
      if (!manager) throw new Error("not_connected");
      const session = await manager.call(target);
      this.session = session;
    } catch (error) {
      const failure = asFailure(error, {
        code: "call_failed",
        message: "The call could not be placed.",
        hint: "Check that the number is diallable by your provider and that the extension is registered.",
      });
      this.emit({ callState: "ended", endedAtMs: Date.now(), failure });
      throw error;
    }
  }

  async answer(): Promise<void> {
    const manager = this.manager;
    const session = this.session;
    if (!manager || !session) return;
    try {
      await acquireMicrophone();
      await manager.answer(session);
    } catch (error) {
      this.fail(asFailure(error, { code: "call_failed", message: "The call could not be answered." }));
    }
  }

  async decline(): Promise<void> {
    const manager = this.manager;
    const session = this.session;
    if (!manager || !session) return;
    try {
      await manager.decline(session);
    } catch {
      // Already gone.
    }
    this.handleTerminated();
  }

  async hangup(): Promise<void> {
    const manager = this.manager;
    const session = this.session;
    if (!manager || !session) {
      this.handleTerminated();
      return;
    }
    try {
      await manager.hangup(session);
    } catch {
      try {
        await manager.decline(session);
      } catch {
        // Nothing left to do; the state is already ended.
      }
    }
    this.handleTerminated();
  }

  setMuted(muted: boolean): void {
    const manager = this.manager;
    const session = this.session;
    if (!manager || !session) return;
    try {
      if (muted) manager.mute(session);
      else manager.unmute(session);
      this.emit({ muted });
    } catch {
      // The session ended between the click and the call.
    }
  }

  async setHeld(held: boolean): Promise<void> {
    const manager = this.manager;
    const session = this.session;
    if (!manager || !session) return;
    try {
      if (held) await manager.hold(session);
      else await manager.unhold(session);
    } catch (error) {
      this.fail(
        asFailure(error, {
          code: "call_failed",
          message: held ? "The call could not be placed on hold." : "The call could not be resumed.",
          hint: "Some providers reject a re-INVITE while the call is still being set up.",
        }),
      );
    }
  }

  /** RFC 2833 / SIP INFO tone for IVR menus. */
  async sendDtmf(tone: string): Promise<void> {
    const manager = this.manager;
    const session = this.session;
    if (!manager || !session) return;
    try {
      await manager.sendDTMF(session, tone);
    } catch {
      // A tone lost mid-teardown is not worth interrupting the operator for.
    }
  }

  /**
   * Drop the registration but keep the credentials, so the softphone can be
   * reconnected without another round trip to the database.
   */
  async disconnect(): Promise<void> {
    const manager = this.manager;
    if (!manager) return;
    this.manager = null;
    this.connectedKey = null;
    try {
      await manager.unregister();
    } catch {
      // Already disconnected.
    }
    try {
      await manager.disconnect();
    } catch {
      // Already disconnected.
    }
    this.session = null;
    this.emit({ status: "disconnected", callState: "idle" });
  }

  private async teardown(): Promise<void> {
    const manager = this.manager;
    this.manager = null;
    this.session = null;
    this.connectedKey = null;
    this.registeredResolve = null;
    if (!manager) return;
    try {
      await manager.disconnect();
    } catch {
      // Already gone.
    }
  }

  private handleTerminated(): void {
    this.session = null;
    const endedAtMs = Date.now();
    this.emit({ callState: "ended", endedAtMs });
  }

  /** Clear a finished call so the UI returns to "ready". */
  reset(): void {
    if (this.snapshot.callState !== "ended") return;
    this.emit({
      callState: "idle",
      startedAtMs: null,
      endedAtMs: null,
      remoteNumber: null,
      remoteName: null,
      callId: null,
      muted: false,
      direction: "outbound",
      failure: null,
    });
  }
}

export const sipEngine = new SipEngine();

/**
 * Try a set of credentials without disturbing the live softphone.
 *
 * Registration is the part that fails on a bad password, a wrong WebSocket URL
 * or a provider that does not allow browser clients, and it can be verified
 * without placing a call or spending money. An administrator saving credentials
 * should be able to find that out immediately rather than discovering it when an
 * agent tries to dial.
 */
export async function testSipAccount(
  account: SipAccount,
): Promise<{ ok: boolean; failure: SipFailure | null }> {
  if (!isUsableAccount(account)) {
    return {
      ok: false,
      failure: {
        code: "not_configured",
        message: "These settings are incomplete.",
        hint: "The SIP URI must look like sip:extension@domain and the WebSocket URL must start with wss://.",
      },
    };
  }

  const stunUrls = resolveStunUrls(account.provider, account.stunUrls);
  let resolveRegistered: (() => void) | null = null;
  // Never rejects on its own, so abandoning it on timeout cannot produce an
  // unhandled rejection.
  const confirmed = new Promise<void>((resolve) => {
    resolveRegistered = resolve;
  });

  // No audio element: registration never negotiates media, so there is no
  // reason to touch the microphone during a configuration test.
  const { Web } = await import("sip.js");
  const manager = new Web.SessionManager(account.wsUrl, {
    aor: account.sipUri,
    maxSimultaneousSessions: 1,
    media: { constraints: { audio: false, video: false } },
    registererOptions: { expires: account.registerExpiry },
    delegate: {
      onRegistered: () => {
        resolveRegistered?.();
        resolveRegistered = null;
      },
    },
    userAgentOptions: {
      authorizationUsername: usernameFromSipUri(account.sipUri),
      authorizationPassword: account.password,
      sessionDescriptionHandlerFactoryOptions: {
        peerConnectionConfiguration: { iceServers: stunUrls.map((urls) => ({ urls })) },
      },
    },
  });

  try {
    await withTimeout(manager.connect(), CONNECT_TIMEOUT_MS, {
      code: "transport_failed",
      message: "Could not reach the SIP server.",
      hint: `Nothing answered at ${account.wsUrl}. Check the URL, and that the provider allows browser (WSS) connections from this origin.`,
    });
    await manager.register();
    await withTimeout(confirmed, REGISTER_TIMEOUT_MS, {
      code: "registration_rejected",
      message: "The server did not confirm registration.",
      hint: "Check the SIP URI and password, and that this extension is enabled for WebRTC browser clients.",
    });
    return { ok: true, failure: null };
  } catch (error) {
    return {
      ok: false,
      failure: asFailure(error, {
        code: "registration_timeout",
        message: "Registration timed out.",
        hint: "The server did not answer in time. Check the WebSocket URL and the network path to it.",
      }),
    };
  } finally {
    try {
      await manager.unregister();
    } catch {
      // Never registered.
    }
    try {
      await manager.disconnect();
    } catch {
      // Already disconnected.
    }
  }
}

/** Talk seconds, excluding ring time and continuing to run while muted or held. */
export function elapsedSeconds(snapshot: SipEngineSnapshot, nowMs: number): number {
  if (!snapshot.startedAtMs) return 0;
  const end = snapshot.endedAtMs ?? nowMs;
  return Math.max(0, Math.round((end - snapshot.startedAtMs) / 1000));
}
