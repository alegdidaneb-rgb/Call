# Connecting Cold Dialer to Bitcall

Bitcall is an outbound-only wholesale SIP trunk. It serves `gateway.bitcall.io` on
**5060/udp** and has no SIP-over-WebSocket listener, and a browser can only send SIP over
WebSocket. So the browser cannot register to Bitcall directly — there is no port, no
scheme and no field value that changes this.

Bitcall publishes the missing piece themselves:
[`@bitcall/webrtc-sip-gateway`](https://www.npmjs.com/package/@bitcall/webrtc-sip-gateway),
a CLI that installs Kamailio plus rtpengine and coturn in Docker, obtains a Let's Encrypt
certificate, and serves SIP over WSS on 443.

```
Browser (Cold Dialer)  --wss-->  your gateway  --5060/udp-->  Bitcall  -->  PSTN
```

Everything below was read out of the gateway package itself (`v0.3.12`), not out of
marketing copy.

## What you need

1. **A Linux VPS** with a public IPv4 address and root. Ubuntu 22.04 or 24.04 is the safe
   choice. 1 vCPU / 1 GB is enough for a handful of agents; media is the only real load.
2. **A hostname that resolves to it.** Let's Encrypt will not issue a certificate for a
   bare IP, so this is not optional.
3. **Bitcall SIP credentials** — username, password and the caller ID assigned to your
   account, all from `panel.bitcall.io` → SIP Account.
4. **Bitcall balance.** Registration can succeed with an empty balance and every INVITE
   can still be rejected.

### Getting a server and hostname for nothing

Both are free if that matters:

| Need | Free option | Caveat |
| --- | --- | --- |
| VPS | Google Cloud `e2-micro` free tier, or Oracle Cloud Always Free (Ampere A1) | Both need a card for identity checks. Oracle frequently reports "out of capacity" — retry, or switch region |
| Hostname | DuckDNS (`yourname.duckdns.org`), pointed at the VPS IP | Fine for Let's Encrypt HTTP-01. For anything long-lived, buy a domain |

Paid and simpler: Hetzner (≈€4/mo), DigitalOcean, Linode or Vultr (≈$5–6/mo) plus a
$10/year domain.

## The step people get stuck on: cloud-level firewall

The installer configures **ufw** on the box, but it cannot touch your cloud provider's
network firewall. On Oracle that firewall blocks *everything* inbound by default, and on
GCP you need an explicit VPC rule. If you skip this, Let's Encrypt cannot reach port 80,
`init` fails to obtain a certificate, and nothing tells you why.

Open these inbound, at the cloud level **and** in ufw. This is the exact list the
installer prints and allows for a default standalone install with coturn enabled:

| Port | Why |
| --- | --- |
| `22/tcp` | SSH |
| `80/tcp` | ACME HTTP-01 challenge (certificate issue and renewal) |
| `443/tcp` | **SIP over WSS** — what the browser connects to |
| `5060/udp` | SIP to and from Bitcall |
| `5060/tcp` | SIP over TCP |
| `10000:20000/udp` | RTP media (rtpengine) |
| `3478/udp` and `3478/tcp` | TURN |
| `5349/tcp` | TURNS |
| `49152:49252/udp` | TURN relay |

Add `5061/tcp` only if you choose TLS as the upstream transport.

## Install

Point your hostname at the VPS **first** and wait for DNS to resolve, then:

```bash
sudo apt-get update && sudo apt-get install -y curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Docker Engine from the official apt repos, plus the compose plugin.
# The snap docker-compose is NOT supported: it cannot access /opt/bitcall-gateway.
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

sudo npm i -g @bitcall/webrtc-sip-gateway
sudo bitcall-gateway init --advanced
```

`--advanced` matters. Without it the wizard hardcodes permissive values and never asks
about the provider or the origin allowlist, leaving `WEBPHONE_ORIGIN=*` — an open relay
that anyone on the internet can use to spend your Bitcall balance.

## Exactly what to answer

| Prompt | Answer |
| --- | --- |
| Gateway domain | `sip.yourdomain.com` — must already resolve to this box |
| Public IPv4 | auto-detected; only asked if detection fails |
| TLS certificate mode | `letsencrypt` |
| Let's Encrypt email | a real address — renewal notices go there |
| Enable built-in TURN (coturn)? | **yes** |
| Restrict to single SIP provider? | **yes** |
| SIP provider host | `gateway.bitcall.io` |
| SIP provider transport | `udp` |
| SIP provider port | `5060` |
| SIP domain allowlist | `gateway.bitcall.io` |
| Webphone origin restriction | `https://cold-dialer-one.vercel.app` |
| SIP trusted source IPs | leave blank — agents are behind changing NAT |
| TURN API token | leave blank |
| Customize RTP/TURN ports? | **no** |
| Proceed with provisioning | yes |

The origin restriction is the important one. Set it to the exact origin your agents load
the app from, with no trailing slash. If you use a custom domain later, add it and run
`sudo bitcall-gateway reconfigure`.

Single-provider routing writes `SIP_PROVIDER_URI=sip:gateway.bitcall.io:5060;transport=udp`
and pins the upstream, so the gateway cannot be persuaded to relay to some other
provider's trunk using your certificate.

## Verify before touching Cold Dialer

```bash
sudo bitcall-gateway status
sudo bitcall-gateway cert status
```

The WebSocket handshake must return `101`:

```bash
DOMAIN="$(grep '^DOMAIN=' /opt/bitcall-gateway/.env | cut -d= -f2)"
curl -k -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Protocol: sip" "https://${DOMAIN}/" | head -n 5
# Expect: HTTP/1.1 101 Switching Protocols

sudo ss -ltnup | grep -E ':(443|5060|5061)\b'
```

If the handshake returns a TLS error instead, open
`https://<your-domain>/` in a browser once and accept the certificate — a browser that
does not trust the WSS certificate fails the socket silently, which is the single most
common cause of *"Could not reach the SIP server"*.

## Cold Dialer → Phone

| Field | Value |
| --- | --- |
| Provider | Other (Asterisk, FreeSWITCH, 3CX, Bitcall gateway, ...) |
| SIP URI | `sip:<bitcall-username>@gateway.bitcall.io` |
| Password | your Bitcall SIP password |
| WebSocket URL | `wss://sip.yourdomain.com/` |
| Caller ID | the caller ID assigned in your Bitcall panel |
| STUN / ICE | leave blank for the defaults |

Note the two different hosts, which is the part that trips everyone up: the **SIP URI**
names Bitcall, because that is the identity being registered; the **WebSocket URL** names
*your* gateway, because that is the socket the browser opens. `gateway.bitcall.io` must
never appear in the WebSocket URL field.

Click **Test connection**. `Registered` means the browser reached the gateway over WSS
*and* Bitcall answered the REGISTER with 200 OK.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `init` cannot obtain a certificate | port 80 blocked at the cloud level | open 80/tcp in the provider firewall, then `sudo bitcall-gateway cert renew` |
| *Could not reach the SIP server* | untrusted certificate, or WSS not listening | open `https://<domain>/` in a browser and accept it; check `cert status` and `ss -ltnup` |
| *Could not reach the SIP server* | wrong origin | the gateway rejects a browser whose `Origin` is not in `WEBPHONE_ORIGIN`; add it and `reconfigure` |
| *Could not register — check the SIP URI and password* | Bitcall rejected the credentials | `sudo bitcall-gateway sip-trace` and read the 401/403 exchange |
| Registered, but every call fails | no balance, or no caller ID assigned | top up and assign a caller ID in `panel.bitcall.io` |
| Registered, call connects, **no audio** | NAT — no TURN relay in use | see the limitation below |
| Audio works for one agent and not another | that agent is behind symmetric NAT | TURN; see below |

Debugging tools that ship with the image: `sudo bitcall-gateway sip-trace` (live SIP
capture via sngrep), `sudo bitcall-gateway logs -f`, `sudo bitcall-gateway media status`.

## Known limitation: TURN is not wired up yet

The gateway runs coturn and exposes rotating HMAC credentials at
`https://<domain>/turn-credentials`, which is how Bitcall's own webphone consumes them.
**Cold Dialer does not fetch that endpoint.** Its `stun_urls` field accepts bare STUN and
unauthenticated ICE URLs only, and coturn credentials expire, so they cannot simply be
pasted in.

In practice most agents sit behind cone NAT and connect fine with STUN alone. If an agent
gets a call that connects with no audio in both directions, that agent needs a relay. The
fix is to have the softphone fetch `/turn-credentials` before it builds its ICE server
list — that is not implemented, and it is the first thing to add if you hit it.

## Things Bitcall cannot do here

- **Inbound calls.** Bitcall offers no inbound DIDs yet, so the incoming-call prompt in
  Cold Dialer will never ring from the PSTN. Outbound dialling is unaffected.
- **Direct browser registration.** No documented WebSocket listener on
  `gateway.bitcall.io`. Only 5060/udp, with TCP and TLS via the domain (never via the raw
  IP).

See [SIP Providers Guide](sip-providers.md) for the browser-compatibility table covering
the other providers, and for what a generic PBX needs.
