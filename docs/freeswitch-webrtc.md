# Running FreeSWITCH as Cold Dialer's PBX

FreeSWITCH is the one route to a working softphone that costs nothing for the
platform itself: it is free software (MPL-1.1), it answers SIP over WebSocket in
its default configuration, and it ships with test destinations that let you prove
the whole media path — registration, WSS, SRTP, OPUS, ICE, relay — without a
single paid call.

Read this before you start, because the word "free" needs splitting in two:

| | Cost |
| --- | --- |
| FreeSWITCH | Free |
| Testing against its built-in destinations | Free |
| Two agents calling each other through it | Free |
| A TURN relay (coturn) | Free |
| A hostname and a TLS certificate | Free |
| A virtual machine to run it on | Free, with caveats — see below |
| **Calling a real phone number** | **Never free.** Needs a paid trunk |

There is no free PSTN. What FreeSWITCH gives you for nothing is a complete,
verifiable calling platform; the minutes to a customer's mobile are somebody's
revenue and you will pay for them, per minute, through a trunk. Everything below
up to [Adding a trunk](#adding-a-trunk-later) is genuinely £0.

Every FreeSWITCH fact in this document was read out of the vanilla configuration
the project ships (`conf/vanilla/` in
[signalwire/freeswitch](https://github.com/signalwire/freeswitch)), not out of a
third-party guide, because the defaults are what decide whether this works.

## What you need

- A Linux host with a public IPv4 address and root access.
- A hostname pointing at it, and a TLS certificate for that hostname. This is not
  optional and it is not a nicety: the browser will not open an insecure
  WebSocket from an HTTPS page, and it will not hand over the microphone from an
  insecure origin either. No certificate, no calls.
- UDP ports for media. SIP over WebSocket is the easy half; RTP is the half that
  produces one-way audio when it is wrong.

## Getting a host and a name for nothing

**Host.** Oracle Cloud's Always Free tier is the usual answer and it is real, but
it is more conditional than the guides claim, and two of the conditions matter
here specifically:

- The Arm (Ampere A1) allowance is now **2 OCPUs / 12 GB**, not the 4/24 older
  articles quote. Signup asks for a credit card and rejects prepaid and virtual
  ones, though it is not charged while you stay inside the allowance.
- **Idle instances get reclaimed.** Oracle's policy is to take back Always Free
  compute whose CPU, network and (on A1) memory all stay under ~20% over seven
  days. A dialler you use a few hours a week is exactly that profile. If you go
  this way, expect to rebuild it, and keep your configuration in a script.

The two free AMD micro VMs (1/8 OCPU, 1 GB each) are x86, which avoids any Arm
packaging questions, and 1 GB is enough for FreeSWITCH with a handful of
concurrent calls.

Anything you already own works too — an old laptop on a port-forwarded router is
a fine development PBX. **So is your own machine**, which is the fastest path and
has no caveats at all: browsers treat `localhost` as a secure context, so you can
run FreeSWITCH locally, accept one self-signed certificate exception, and even
point the deployed Vercel app at `wss://localhost:7443` — the browser resolves
that to your own machine.

**Name.** DuckDNS gives you a free subdomain. **Certificate.** Let's Encrypt via
`certbot` is free; HTTP-01 needs port 80 reachable, or use DNS-01.

The only thing that genuinely costs money in the whole free path is a domain name
if you refuse to use a free subdomain — roughly £10 a year, and you do not need it.

## Install

Use SignalWire's official repository and package install for your distribution:
<https://developer.signalwire.com/freeswitch/FreeSWITCH-Explained/Installation>.
Note two things before you start:

- The repository requires a **SignalWire Personal Access Token**, which is free
  but needs an account. This surprises people who expect a plain `apt install`.
- The official Docker image needs the same token as a build argument.

Install `freeswitch` plus `freeswitch-meta-default`, which brings the vanilla
configuration this document refers to. On Debian/Ubuntu the files then live under
`/etc/freeswitch/`, and certificates go in `/etc/freeswitch/tls/`.

## Change the default password before you expose anything

This is not a footnote. `conf/vanilla/vars.xml` contains:

```xml
<X-PRE-PROCESS cmd="set" data="default_password=1234"/>
```

with FreeSWITCH's own comment above it warning you to change it. The vanilla
directory ships **twenty accounts, `1000.xml` through `1019.xml`**, and every one
of them authenticates with `1234`. On a host with a public IP and 5060/udp open,
that is an invitation — toll fraud is the standard outcome, and it is your bill.

Set a strong `default_password` in `vars.xml`, and if you do not need SIP on UDP
from the internet, do not open 5060 at all: this app connects over WSS on 7443,
and nothing else needs to be reachable.

## The four settings that decide whether it works

The vanilla configuration is closer to working than most guides suggest. Two of
these need no change at all.

**1. WebSockets are already bound.** In `conf/vanilla/sip_profiles/internal.xml`,
live and uncommented:

```xml
<!-- for sip over websocket support -->
<param name="ws-binding"  value=":5066"/>

<!-- for sip over secure websocket support -->
<!-- You need wss.pem in $${certs_dir} for wss or one will be created for you -->
<param name="wss-binding" value=":7443"/>
```

**7443 is the port this app needs.** If you selected a PBX provider and left the
WebSocket field blank, the form derives the URL from the preset's port — which is
why FreeSWITCH has its own preset. The generic "Other" entry derives 8089, which
is Asterisk's port, and pointing a browser there produces a transport failure
that says nothing about the port being wrong.

**2. Codecs already include what a browser offers.** In `vars.xml`:

```xml
<X-PRE-PROCESS cmd="set" data="global_codec_prefs=OPUS,G722,PCMU,PCMA,H264,VP8"/>
```

OPUS is first, and `internal.xml` inherits it for both directions. Nothing to do.

**3. `domain` must be your hostname.** It defaults to `$${local_ip_v4}`. The app
dials into whatever domain its SIP URI names, so set:

```xml
<X-PRE-PROCESS cmd="set" data="domain=pbx.example.com"/>
```

**4. The NAT settings, which are the usual cause of one-way audio.** Both default
to a public STUN service:

```xml
<X-PRE-PROCESS cmd="stun-set" data="external_rtp_ip=stun:stun.freeswitch.org"/>
<X-PRE-PROCESS cmd="stun-set" data="external_sip_ip=stun:stun.freeswitch.org"/>
```

Replace both with your actual public address (an IP literal or the hostname).
Leave them and FreeSWITCH advertises an address it learned from a third party at
startup, which may be stale, and media goes somewhere it cannot come back from.

## The certificate

FreeSWITCH will generate a self-signed `wss.pem` for you if none exists — which is
why WSS appears to work and the browser still refuses it. A self-signed certificate
is rejected by a page served over HTTPS with no prompt the operator can act on.

Build `wss.pem` from a real certificate by concatenating the chain and the key
into one file:

```bash
sudo mkdir -p /etc/freeswitch/tls
sudo cat /etc/letsencrypt/live/pbx.example.com/fullchain.pem \
         /etc/letsencrypt/live/pbx.example.com/privkey.pem \
  | sudo tee /etc/freeswitch/tls/wss.pem >/dev/null
sudo chown -R freeswitch:freeswitch /etc/freeswitch/tls
sudo chmod 600 /etc/freeswitch/tls/wss.pem
```

Then reload rather than restart, so you do not drop anything registered:

```bash
fs_cli -x 'sofia profile internal restart'
```

Let's Encrypt certificates expire every 90 days and `wss.pem` is a *copy*, not a
symlink — so renewal silently stops working unless you re-run the concatenation.
Put it in a `--deploy-hook`:

```bash
sudo certbot renew --deploy-hook \
  'cat /etc/letsencrypt/live/pbx.example.com/fullchain.pem /etc/letsencrypt/live/pbx.example.com/privkey.pem > /etc/freeswitch/tls/wss.pem && fs_cli -x "sofia profile internal restart"'
```

## Firewall

| Port | Protocol | Purpose |
| --- | --- | --- |
| 7443 | TCP | SIP over secure WebSocket — what the browser connects to |
| 16384–32768 | UDP | RTP media. Open the whole range or you get audio on some calls and not others |
| 80, 443 | TCP | Only for `certbot` renewal |
| 5066 | TCP | Plain WS. Useful for debugging, do not leave open to the internet |
| 5060 | UDP | SIP. Not needed by this app; see the password warning above |

On a cloud host there are usually **two** firewalls: the provider's security list
and the OS's. Opening only one is the most common reason a setup that looks
correct still cannot connect.

## coturn

FreeSWITCH has no TURN server. STUN tells a browser its own public address, which
is enough when both ends are reachable — and not enough when an agent is behind a
symmetric NAT or a corporate firewall. In that case the call connects, there is no
audio in one or both directions, and **Cold Dialer still logs it as answered with
a real duration**, because from the browser's point of view the call succeeded.
A relay is the only thing that fixes it.

Install coturn on the same host, give it a static user, and enter it in the TURN
fields on the Phone page. Cold Dialer supports long-term-credential TURN
(`turn:`/`turns:` with a username and credential), and the audio-path check on
that page reports whether a `relay` candidate actually arrived — run it before you
blame anything else.

## The dialplan hook Cold Dialer needs

This is specific to this app and you will hit it within a minute of your first
test call.

`buildDialTarget` in `frontend/src/sip/dialTarget.ts` always produces an
international number: a stored `+393406729832` becomes `sip:+393406729832@domain`,
and a local number has its country's dialling code prefixed. **There is always a
leading `+`.** So a lead whose phone is `+9196` arrives at FreeSWITCH as
destination `+9196`, which does not match the vanilla dialplan's `^9196$`.

Add this to `conf/dialplan/default.xml`, above the extensions it should feed:

```xml
<extension name="cold_dialer_short_codes">
  <condition field="destination_number" expression="^\+(\d{3,6})$">
    <action application="transfer" data="$1 XML default"/>
  </condition>
</extension>
```

It strips the `+` from **3–6 digit** destinations only and re-enters the dialplan,
so `+9196` reaches the echo test and `+1001` reaches a directory user, while real
E.164 numbers (7+ digits) pass through untouched to whatever trunk you add later.
Narrowing the length is what keeps this from swallowing a real call.

## Verify before touching Cold Dialer

```bash
# WSS is listening, and it is a TLS port rather than a plain one.
sudo ss -ltnp | grep -E ':7443|:5066'

# From another machine: a TLS handshake must succeed and print your certificate.
openssl s_client -connect pbx.example.com:7443 -servername pbx.example.com </dev/null 2>/dev/null | head -20

# The WebSocket upgrade must be accepted. Expect: HTTP/1.1 101 Switching Protocols
curl -sSi -o - \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  https://pbx.example.com:7443/ | head -3

# FreeSWITCH agrees its own media address is the public one.
fs_cli -x 'global_getvar external_rtp_ip'
fs_cli -x 'sofia status profile internal'
```

If `openssl s_client` shows a self-signed certificate, the browser will refuse it
however correct the rest is. Fix that first.

## Cold Dialer → Phone

Phone → SIP accounts → add, and choose **FreeSWITCH (your own PBX)**.

| Field | Value |
| --- | --- |
| Provider | `FreeSWITCH (your own PBX)` |
| SIP URI | `sip:1000@pbx.example.com` — the directory user, and the domain you set in `vars.xml` |
| Password | That user's directory password, not `1234` |
| WebSocket URL | Leave blank: with this provider selected the form derives `wss://pbx.example.com:7443` from the SIP URI's domain |
| Caller ID | Whatever your trunk will later allow you to present |
| STUN | Leave the defaults unless you have your own |
| TURN | Your coturn host, plus its username and credential — both or neither |

Then run **Check microphone and audio path** on that page before you dial anything.
It gathers ICE candidates against the settings in the form and reports which kinds
came back. It places no call and needs no trunk, so it separates "the PBX is
unreachable" from "your microphone is blocked" from "there is no relay" — three
failures that otherwise look identical.

## Free test destinations

All verified against the vanilla `conf/dialplan/default.xml`. With the short-code
hook above, dial them by creating a lead whose phone is `+9196` and so on.

| Dial | Name | What it proves |
| --- | --- | --- |
| **9196** | `echo` | Your audio returns to you. **Both directions work** — the real media test |
| **9197** | `milliwatt` | A 1 kHz tone, played in a loop. Audio arrives without depending on your microphone |
| **9195** | `delay_echo` | Echo with delay; useful for spotting jitter |
| **9198** | `tone_stream` | Plays tetris. Playback path |
| **9664** | `hold_music` | Answers **only when `rtp_has_crypto` is AES_CM_128_HMAC_SHA1_32 or _80** — so silence here means SRTP did not negotiate |
| **9191** | `ClueCon` | A real outbound SIP call to cluecon.com. Free, and it proves routing beyond your own box |
| **9192** | `show_info` | Dumps channel variables into the log |
| **1000–1019** | directory users | Two browsers registered as different users calling each other |
| **9180–9184** | ringback tests | Early-media and ringback behaviour |

The cheapest complete validation: register two Cold Dialer agents as `1000` and
`1001`, have them call each other, then have one call `9196` and confirm they hear
themselves. That exercises registration, WSS, TLS, SRTP, OPUS, ICE and — with
coturn configured — relay, for nothing.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| Transport failure immediately | Wrong port: 8089 is Asterisk's, FreeSWITCH is 7443 | Select the FreeSWITCH provider, or type `wss://host:7443` |
| Transport failure, port correct | Self-signed or expired `wss.pem` | Rebuild it from Let's Encrypt; check with `openssl s_client` |
| Registers, then no audio either way | `external_rtp_ip` still pointing at `stun:stun.freeswitch.org` | Set it to your public address |
| Audio one way only | RTP port range not open, or two firewalls and only one opened | Open 16384–32768/udp in both |
| Connects, no audio, agent behind a corporate network | No TURN relay | Run coturn and enter it; confirm with the audio-path check |
| Registration rejected | Directory password, or `domain` mismatch with the SIP URI | The URI's domain must equal `vars.xml`'s `domain` |
| Call connects to nothing recognisable | Destination arrived as `+9196` and matched no extension | Add the short-code dialplan hook |
| Microphone permission never appears | Page not a secure context | Serve the app over HTTPS, or use `localhost` |

## Adding a trunk later

Nothing above changes when you add PSTN. You define a FreeSWITCH gateway to your
trunk provider (Bitcall, Telnyx, VoIP.ms — see `docs/bitcall-gateway.md` and
`docs/sip-providers.md`), then route long destinations to it in the dialplan:

```xml
<extension name="cold_dialer_pstn">
  <condition field="destination_number" expression="^\+\d{7,15}$">
    <action application="bridge" data="sofia/gateway/mytrunk/${destination_number}"/>
  </condition>
</extension>
```

Order matters: put the short-code hook first so 3–6 digit test numbers never reach
the trunk, and keep the PSTN pattern to 7+ digits so it cannot catch them either.
From that point Cold Dialer dials real customers unchanged — the app was already
producing international numbers, which is what a trunk expects.
