# SIP Provider Setup

A browser cannot reach the telephone network on its own. It registers with a SIP
provider over a secure WebSocket (`wss://`) and exchanges audio with it over
WebRTC; the provider is what actually places the call. **Without provider
credentials there is nothing to call with** — the app says so plainly on every
lead page and offers an *Open in phone app* link instead of pretending to dial.

## Where to enter credentials

Sign in as an administrator and open **Phone** in the sidebar. Credentials saved
there take effect immediately, on every open session — no rebuild and no
redeploy.

| Field | What to enter |
| --- | --- |
| Provider | Picks sensible defaults for the WebSocket URL and STUN servers |
| SIP URI | Your address of record, e.g. `sip:1001@pbx.example.com` |
| Password | The digest password for that extension |
| WebSocket URL | Must start with `wss://` — a page served over HTTPS cannot open an insecure `ws://` socket |
| Outbound caller ID | Optional; the number the lead sees |
| Assign to | *Shared trunk default* (everyone), or one specific agent |

Press **Test connection** before saving. It registers and then unregisters, and
places no call. It waits for the server to *confirm* registration, so a wrong
password fails here rather than later, mid-campaign.

Build-time `VITE_SIP_*` variables still work and are used when no database
account exists — see `.env.example`. They are compiled into the bundle, so
changing one requires a redeploy; the Phone page is the better path.

## Per-agent extensions

Give each agent their own extension wherever your provider allows it. A browser
softphone must hold the password in the page to answer the SIP digest challenge,
so any credential in this app is readable by whoever can sign in. Per-agent
extensions mean one leaked password cannot be used to dial on the whole trunk,
and a provider-side block can be applied to one extension instead of shutting
down a campaign.

Restrict each extension at the provider as well: cap concurrent calls, limit
permitted destinations, and block premium-rate ranges. Cold calling has legal
exposure that no client-side code can reduce.

## Providers

Exact endpoints change; treat the values below as a starting point and confirm
them in your provider's console, then verify with **Test connection**.

### SignalWire

Create a SIP endpoint in your Space and use its credentials.

- SIP URI: `sip:<extension>@<your-space>.sip.signalwire.com`
- WebSocket URL: `wss://<your-space>.sip.signalwire.com:5066`

### Telnyx

Registration from a browser needs a **SIP Credential Connection** in Mission
Control, not an IP-based one. An IP connection authenticates by source address,
which a browser cannot offer.

- SIP URI: `sip:<connection-user>@sip.telnyx.com`
- WebSocket URL: `wss://sip.telnyx.com`

### Twilio

Use a **SIP Domain** with credential-based registration (a Credential List or
Auth Username/Password), not an ACL-only trunk. Note that Twilio Voice JS is a
separate product with its own access-token authentication; this app speaks
standard SIP and does not use it.

- SIP URI: `sip:<username>@<your-domain>.sip.twilio.com`
- WebSocket URL: `wss://<your-domain>.sip.twilio.com`

### Your own PBX: Asterisk, FreeSWITCH, 3CX

A PBX has three settings that decide whether a browser can register, and getting
any one of them wrong produces the same vague symptom: the softphone reports
*"Could not reach the SIP server"* or *"The server did not confirm
registration"*. Work through them in this order.

#### 1. The WebSocket endpoint must have a certificate the browser trusts

This is the failure that wastes the most time. A browser refuses a `wss://`
connection whose certificate it does not trust, and it does so **silently** — SIP.js
sees only a socket that never opened, so the app cannot tell "self-signed
certificate" apart from "nothing listening".

Self-signed will not work. Either issue a real certificate for the PBX (Let's
Encrypt is free), or terminate TLS at a reverse proxy in front of it. The proxy
is usually easier, because it also gives you a stable hostname:

```
# Caddyfile -- Caddy obtains and renews the certificate automatically
# and proxies WebSocket upgrades without extra configuration.
sip.example.com {
    reverse_proxy /ws* 127.0.0.1:8088
}
```

The WebSocket URL you then enter in the app is `wss://sip.example.com/ws`.

Verify the endpoint from a browser tab before touching the app: opening
`https://sip.example.com/ws` should not produce a certificate warning. If it
does, no browser softphone will ever connect.

#### 2. The extension must be WebRTC-capable

A plain SIP extension negotiates RTP in the clear. A browser only offers
DTLS-SRTP with ICE and RTCP multiplexing, so an extension configured for
ordinary desk phones will register and then fail to carry audio.

**Asterisk** (PJSIP). Enable TLS on the built-in HTTP server, add a `ws`
transport, and set `webrtc=yes` on the endpoint — that one line turns on
DTLS-SRTP, ICE, RTCP-mux and AVPF together:

```ini
; http.conf
[general]
enabled = yes
bindaddr = 0.0.0.0
bindport = 8088
tlsenable = yes
tlsbindaddr = 0.0.0.0:8089
tlscertfile = /etc/letsencrypt/live/sip.example.com/fullchain.pem
tlsprivatekey = /etc/letsencrypt/live/sip.example.com/privkey.pem

; pjsip.conf
[transport-wss]
type = transport
protocol = ws
bind = 0.0.0.0

[1001]
type = endpoint
context = from-internal
transport = transport-wss
auth = auth-1001
aors = 1001
webrtc = yes
disallow = all
allow = opus
allow = ulaw

[auth-1001]
type = auth
auth_type = userpass
username = 1001
password = <a strong password>

[1001]
type = aor
max_contacts = 5
remove_existing = yes
```

**FreeSWITCH.** The internal profile listens for WSS on port 7443 by default;
confirm `wss-binding` is set and that `/etc/freeswitch/tls/wss.pem` holds a
trusted certificate rather than the shipped self-signed one.

**3CX.** Its own web client uses WebRTC, but a *third-party* browser softphone is
a different matter and several editions restrict which clients may register. If
**Test connection** never confirms registration on 3CX, check whether the
extension is allowed to use a generic SIP client at all before debugging further.

#### 3. The dialplan must route numbers in international format

The app dials `sip:+393406729832@your-pbx`, derived from the lead's country.
Registration succeeding only proves you can talk to the PBX; the call still has
to be routed.

Many default dialplans match national formats or expect an outbound trunk prefix
such as `9` or `00`, and will reject a leading `+` with `404 Not Found` or simply
ring nothing at all. Add a route that matches E.164 and strips the `+` before
handing the call to your trunk — in Asterisk, something like:

```ini
; extensions.conf
[from-internal]
exten => _+X.,1,NoOp(Outbound E.164 call to ${EXTEN})
 same => n,Dial(PJSIP/outbound-trunk/${EXTEN:1})
```

If you cannot change the dialplan, say so and an outbound prefix option can be
added to the app instead.

#### Codecs

Browsers offer Opus, G.711 (PCMU/PCMA) and G.722. If the extension is restricted
to something a browser cannot do — G.729 is the usual culprit — the call connects
with no audio or fails at INVITE. Allow Opus or ulaw.

#### NAT

Media flows directly between the browser and the PBX. If the PBX is behind NAT it
needs its external addresses declared (`external_signaling_address` and
`external_media_address` on the Asterisk transport), or ICE will negotiate an
address the browser cannot reach and the call will be silent in one or both
directions. The app sends Google's public STUN servers by default, which covers
the browser side.

## When a call does not work

The softphone reports a specific reason rather than a generic failure. What each
one usually means:

| Message | Likely cause | Fix |
| --- | --- | --- |
| Could not reach the SIP server | Wrong `wss://` URL, or the server does not accept browser clients | Check the URL and port; confirm the provider supports SIP over WebSocket |
| The server did not confirm registration | Wrong SIP URI or password, or the extension is not WebRTC-enabled | Re-check both; on Telnyx, confirm it is a Credential Connection |
| Microphone access was blocked | Browser permission denied | Allow the microphone for the site, then dial again |
| Calls need a secure origin | App served over plain HTTP | WebRTC and the microphone require HTTPS (or localhost) |
| Connected, but one-way or no audio | No STUN/ICE servers, or a firewall blocking RTP | Keep the default STUN servers; open the provider's RTP media range |
| Audio playback was blocked | Browser autoplay policy | Click anywhere on the page once; the dial click normally satisfies this |

## Audio requirements

- A microphone is required, and headphones are strongly recommended: without
  them the far end hears its own voice echoed back.
- Only one call at a time. A second inbound call is rejected automatically.
- Duration counts talk time from the moment the call is answered, so ring time is
  not recorded as a conversation.
