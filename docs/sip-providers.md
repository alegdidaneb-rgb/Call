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

### Asterisk, FreeSWITCH, 3CX and other PBXs

Enable the WebSocket transport and a WSS listener, then create an extension with
`webrtc=yes` (Asterisk) or the equivalent.

- SIP URI: `sip:<extension>@<pbx-host>`
- WebSocket URL: `wss://<pbx-host>:8089/ws` (Asterisk's default `ws` path)

A self-signed certificate will fail silently in the browser. Serve the PBX's
WebSocket endpoint from a certificate the browser already trusts.

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
