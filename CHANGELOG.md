# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A calling workspace at `/workspace`: the lead queue, the lead being called and
  the call controls in three independently scrolling panes, so working a list
  never costs a navigation. It is the landing route now, because it is the screen
  the job is done on
- The workspace is keyboard-driven end to end — `j`/`k` or arrows to move, `d` to
  dial or end, `m` mute, `h` hold, `1`–`7` to record an outcome, `i`/`c`/`x`/`v`
  to set a status, `f` to filter, `?` for the list — and a shortcut overlay that
  is generated from the same definitions the bindings come from, so it cannot
  drift out of date
- Disposition codes with their consequences attached (`lib/outcomes.ts`): each one
  knows the lead status it implies, whether it advances the queue, and its hotkey
- A rule that stops a disposition walking a lead backwards, and treats
  `do_not_contact` and `converted` as terminal. Re-dialling somebody who asked you
  to stop is a compliance problem, not a UI bug
- Selection that follows position rather than identity: when the lead you are on
  leaves the queue, you land on the row that took its place instead of the top of
  a four-thousand-lead list
- Hand-rolled chart primitives — sparkline, columns and a donut — reading their
  colours from the same CSS variables as everything else, so they follow a theme
  switch without a re-mount. No charting dependency was added
- A lead data grid: sortable on every column, windowed so a large list stays
  usable, multi-select with shift-click ranges, bulk status change, bulk
  do-not-contact, bulk delete, and inline status editing
- CSV export, which the previous Leads page had as an imported icon with no
  handler. It honours the current filters, or the selection when there is one, and
  quotes to RFC 4180 so free-text notes containing commas survive Excel
- Script editing: `call_scripts` can now be created, edited, deleted and attached
  to a campaign, with an objections editor. The workspace shows the script
  resolved against the lead's campaign beside the dial button
- A motion system: five keyframes, one spring easing token, and short durations
  throughout. `prefers-reduced-motion` collapses all of it with a blanket rule, so
  no component can forget to opt out
- Loading skeletons that match the shape of what they replace, and an `EmptyState`
  that distinguishes "no data yet", "your filters are too narrow" and "the fetch
  failed" — three situations with three different remedies
- `lib/keys.ts`, which coordinates overlays so a keystroke cannot reach two
  listeners. Without it, pressing `d` behind a "delete this lead?" dialog would
  have dialled the lead
- Bulk CSV import as one statement instead of one round trip per row, each of
  which refetched the whole list

- A design-token layer in `src/index.css`: every colour is an RGB triplet on a
  CSS variable, so one token serves as a solid fill, a tinted chip background
  and a hairline border through Tailwind's opacity modifiers
- Dark and light themes, both complete, plus a "match system" mode that follows
  the OS live. The choice is applied by an inline script in `index.html` before
  first paint, so a returning agent never sees the wrong theme flash
- A density control. It scales the root font size, which scales every
  rem-based spacing and text value, so it applies across the whole app rather
  than only to surfaces that opt in
- A command palette on `Cmd/Ctrl+K` or `/`: jump to any page, find a lead by
  name, company, phone or email, and change theme or density without leaving
  the keyboard
- Live SIP registration status in the top bar, which opens the Phone page for
  administrators
- `vite.config.ts` now splits React into its own chunk, so a UI change no longer
  invalidates ~165 kB in every agent's cache
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
- `docs/bitcall-gateway.md`, a runbook for reaching Bitcall through its own
  `@bitcall/webrtc-sip-gateway`: free VPS and hostname options, the cloud-firewall
  ports, the exact installer answers, verification, and a failure table
- A Bitcall section in the SIP provider guide: the `gateway.bitcall.io:5060/udp`
  trunk, the self-hosted `@bitcall/webrtc-sip-gateway` WebRTC bridge, and the
  fact that Bitcall is outbound-only
- Comprehensive documentation
- Data seeder with sample leads

### Changed

- The dashboard measures a window the operator chooses (7, 14 or 30 days) and
  compares it with the window before it, rather than printing six lifetime totals.
  Call volume, connect rate, talk time and queue remaining, each with a trend;
  outcome mix; pipeline; per-campaign performance; recent activity
- The Leads page is a grid rather than a `<table>` with padding
- Toasts are themed from the tokens. `react-hot-toast` was mounted with its default
  styling, which is a white pill with dark text — in a dark app that read as a
  browser artefact that had escaped the design system
- The confirm dialog uses tokens instead of `bg-black/50` and `text-white`, which
  are absolute and so looked identical in both themes and matched neither. It now
  closes on Escape, announces itself as a dialog, and registers as an overlay
- The call bar rises into place, its hang-up button has a hover state that does
  something (`hover:bg-danger` on `bg-danger` did nothing), and clicking it opens
  the workspace to disposition the call
- The softphone's outcome `<select>` is superseded in the workspace by buttons that
  show their hotkey and what they will do

- Navigation is grouped into Work, Manage and Admin instead of one flat list of
  eight entries
- The accent is an indigo-violet rather than the framework's stock blue, and the
  default Tailwind palette is now removed from the config entirely so off-token
  colours cannot creep back in one utility at a time
- Inter is actually loaded; it was declared in the theme but never fetched, so
  every surface was rendering in the system fallback
- JetBrains Mono for phone numbers, timers and other digits, with tabular
  figures so they do not jitter as they change
- The stock Vite favicon is replaced with an application mark
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

- The hardcoded `SAMPLE_SCRIPT`, which was rendered by both the Scripts page and
  the script viewer out of `useState`. An agent following it was reading a script
  no administrator had written and could not change — worse than no script panel,
  because it looked authoritative
- A `slide-in-right` animation that was declared in the config and used nowhere.
  Tailwind only emits keyframes for animations in use, so it was generating nothing
  and only implying that something depended on it

- The header search input, which rendered and accepted typing but was never
  connected to anything, and the notification bell, which carried a hardcoded
  unread dot for a notification system that does not exist. Both are superseded
  by the command palette
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

- `call_count` and `last_called_at` are written from the workspace. They were
  rendered on the lead page and only ever written from there, so a lead dialled
  from anywhere else stayed at "0 calls / Never" however many attempts it had had
- Notes taken with no call are stored on the lead instead of being discarded: they
  previously had nowhere to go, because the only write path was the call log
- The do-not-contact flag and the `do_not_contact` status are set together. They are
  two representations of one decision, and leaving them out of step meant a lead
  stayed out of the queue while still looking callable in the list
- A failed inline status change reverts the control, rather than leaving it showing
  a value that was never written

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
