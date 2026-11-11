# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- A working browser softphone: SIP registration over WSS, WebRTC audio, mute,
  hold, DTMF, inbound call handling, and one call at a time
- `sip_accounts` in both the Supabase and SQLite schemas, with row-level security
  restricting reads to the owner and to administrators and writes to
  administrators only
- A **Phone** page where an administrator saves credentials at runtime, so a
  change needs no rebuild and no redeploy
- **Test connection**: registers and waits for the server to *confirm* it, then
  unregisters without placing a call
- Per-agent extensions — an agent's own account takes precedence over the shared
  trunk default
- An app-wide call bar and inbound-call prompt, so a live call survives
  navigating between leads
- Toast notifications for failed saves; `react-hot-toast` was already a
  dependency but was never mounted, so a failure was invisible
- International leads: `leads.country` (ISO 3166-1 alpha-2) in both the Supabase
  and SQLite schemas, a 250-country picker in the lead form, and a country column
  on the lead detail view
- `scripts/generate-countries.mjs` plus `npm run gen:countries`, which generates
  the committed country table from the ISO 3166-1 `world-countries` dataset
- `country` accepted in CSV imports and normalised (`"gb"` -> `GB`, `""` -> NULL)
  by a trigger in Postgres and by validation in the backend
- Admin-only account provisioning: `admin-users` Supabase edge function,
  `POST /api/users` in the self-hosted backend, and a Team page for administrators
- First-run `/setup` screen, closed by the server once any account exists
- `profiles.invited_by` plus `is_provisioned()` / `is_service_role()` in Postgres,
  and a matching `requireProvisioned` middleware in the backend
- "Waiting for an administrator" screen for accounts that authenticated without
  being provisioned
- Self-hosted backend with SQLite database
- Express.js API server with JWT authentication
- Provider abstraction layer (Supabase or self-hosted backend)
- Docker Compose deployment
- A Bitcall section in the SIP provider guide: the `gateway.bitcall.io:5060/udp`
  trunk, the self-hosted `@bitcall/webrtc-sip-gateway` WebRTC bridge, and the
  fact that Bitcall is outbound-only
- Comprehensive documentation
- Data seeder with sample leads

### Changed
- Numbers are dialled in international format, derived from the lead's country.
  A local number whose country shares a dialling code is reported to the operator
  rather than guessed at
- Call logs record the SIP Call-ID and the real start and end times, so a logged
  call can be matched against the provider's own record
- `call_count` and `last_called_at` are written when a call is saved
- Registration happens once at app-shell level rather than per dial, so inbound
  calls ring on any page
- Duration counts talk time from the moment the call is answered
- The lead form's dialling prefix is derived from the selected country instead of
  being a separate control that offered only "+1 (US)"
- Lead address fields relabelled "State / Region" and "Postal code"
- Every agent-facing RLS policy now requires the caller to be provisioned, so an
  account created directly through the Supabase Auth API can read nothing
- New auth users are no longer auto-promoted: the first-admin bootstrap is now an
  explicit server-side action instead of a race on an empty table
- Rebranded from "Apex Precision Billing" to "Cold Dialer"
- Refactored SIP configuration into a separate module
- Updated hooks to support multiple data providers

### Removed
- **The simulated call.** With no credentials configured the softphone animated
  "Connecting -> Ringing -> Connected" and then logged an `answered` call with a
  fabricated duration for a call that had never been placed. SIP errors were
  swallowed into the same fake. A cold-calling tool that invents call records is
  a compliance liability, so the dialer now states plainly that it is not
  configured
- Public self-service sign-up: `SignupPage`, `auth.signUp`,
  `POST /api/auth/signup`, and the unused `multer`, `papaparse` and Drizzle
  dependencies
- The `sync-forks` and `webpack` GitHub Actions workflows, which did not describe
  this project

### Fixed
- No audio element was ever attached to a call, so even correct credentials would
  have connected in silence
- No STUN servers were configured — `SIP_PRESETS` defined them and nothing read
  them — so a browser behind NAT could not be reached
- The provider presets advertised endpoints that cannot work. Telnyx serves SIP
  over WebSocket on **7443**, not 443. Twilio has no WebSocket listener at all —
  its SIP Domains take UDP, TCP and TLS only — and SignalWire documents
  TLS/TCP/UDP for SIP Credentials while steering browser calling to its own
  proprietary SDK. The Phone page now marks those two as not browser-ready,
  leaves the WebSocket URL blank instead of deriving an unreachable one, and
  says plainly that a PBX or gateway is required
- Mute and hold were cosmetic: they changed React state without disabling the
  audio track or sending a re-INVITE
- The DTMF keypad sent no tones, and was ignored entirely whenever a lead was
  selected
- The call timer stopped while muted, so the recorded duration was wrong
- A new user agent was created per call and never stopped, leaking a socket and a
  stale registration each time
- `registerer.register()` was awaited as though it confirmed registration; it only
  reports that the request was sent
- An inbound call could be terminated by an unrelated change of call state
- `session.reject(486)` was called with a status code the API does not accept
- An unanchored `data/` rule in `.gitignore`, intended for the SQLite directory,
  silently swallowed `frontend/src/data/` and would have kept the generated
  country table out of the repository
- Removed hardcoded email from dev user
- Updated `.env.example` with all configuration options
- Expanded `.gitignore` for better security

## [1.0.0] - 2026-01-XX

### Added
- Initial release
- React + Vite + TypeScript frontend
- Supabase integration for data storage
- SIP.js softphone with SignalWire support
- Lead management with CSV import
- Campaign management
- Call scripts with objection handling
- Call history and logging
- Dashboard with analytics
- Admin panel
