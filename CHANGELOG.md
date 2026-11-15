# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Administrators can assign leads to agents.** The Lead list grows an *Owner*
  column with a picker in each row, an owner filter, and *Assign to…* in the bulk
  bar for a selection of any size; the lead detail page grows an Assignment card.
  Clearing the owner returns a lead to the unassigned pool, which everybody can see
  and claim. Restricted to administrators and managers — the roles the row-level
  policies already treated as privileged — and shown to agents as a name rather than
  a control they would be refused
- `POST /api/leads/assign` takes `{lead_ids, assigned_to}` and assigns in one
  statement, reporting how many rows actually changed so a selection that partly
  vanished is reported honestly rather than as a clean success
- **Migration 007** adds `public.protect_lead_assignment()`, so an agent may claim
  an unassigned lead and release one of their own, but may not name another person
  or move a lead that is already somebody's. The Express API has always refused
  that; production runs against row-level security, where `WITH CHECK` passed for a
  lead on `created_by = auth.uid()` whatever `assigned_to` was set to, so the
  stricter rule existed only in the deployment nobody uses. The trigger governs
  `anon` and `authenticated` and leaves direct server connections alone — a
  self-hosted API has no JWT claims, and gating on `is_service_role()` would have
  refused every assignment an administrator made through it
- **TURN relay support** — migration 006 adds `turn_urls`, `turn_username` and
  `turn_credential` to `sip_accounts`, and the softphone now offers them to WebRTC
  alongside STUN. STUN only reports a browser's public address, so when both ends
  sit behind a symmetric NAT, or a firewall drops inbound UDP, the call connects
  and there is no audio in one or both directions — while the call log records it as
  answered with a real duration. A relay is the only thing that fixes that, and
  there was previously no way to configure one
- **Check microphone and audio path** on the Phone page: gathers ICE candidates
  against the settings in the form and reports which kinds came back (`host`,
  `srflx`, `relay`). An account with TURN servers that gathers no relay candidate is
  reported as a failure naming the cause. Needs no SIP credentials and places no
  call, so it can be run before saving — registration succeeding says nothing about
  whether anybody would hear anything
- **Bitcall** is a named provider preset rather than something to file under
  "Other". It carries the fact that Bitcall publishes SIP on
  `gateway.bitcall.io:5060/udp` only, so a browser needs
  `@bitcall/webrtc-sip-gateway` on a host the operator controls, and that the
  gateway's installer offers coturn — see `docs/bitcall-gateway.md`
- `VITE_SIP_TURN_URLS`, `VITE_SIP_TURN_USERNAME` and `VITE_SIP_TURN_CREDENTIAL` for
  deployments that configure the softphone at build time
- Accounts are addressed by **username** instead of email, everywhere: first-run
  setup, the team roster and sign-in. No screen collects an email address any
  more, and no account has a mailbox behind it
- `profiles.username`, unique case-insensitively, with a shape constraint and a
  reserved-name list (`admin`, `root`, `support`, …) so a name the product cannot
  honour is never issued — migration 005, plus `public.resolve_login_email` for
  sign-in and `public.derive_username` for the backfill
- **Team → Reset password**: an administrator can set a new password for any
  account (`admin-users` `reset-password` action; `POST /api/users/:id/password`
  in API mode). This is required rather than convenient — a synthetic address
  cannot receive a reset link, so without it a forgotten password is permanent
- `lib/username.ts` (client) and `backend/src/lib/username.ts`, so a bad username
  is rejected in the form rather than after a round trip


- One page header (`components/common/PageHeader.tsx`), now used by every page.
  Eleven screens each hand-rolled their own title, at four different sizes, with
  the description sometimes present and the actions variously beside, below or
  missing — inconsistency that is invisible one page at a time and obvious the
  moment somebody clicks between them
- A product mark (`components/common/Brand.tsx`), drawn inline rather than
  borrowed from an icon set, and a shared `AuthScreen` shell behind both
  unauthenticated screens
- A password field with a reveal toggle and a requirement checklist that updates
  on every keystroke, so the policy is visible while the operator types instead of
  being reported as a refusal afterwards
- `lib/passwordPolicy.ts`: the policy had three independent definitions — two
  near-identical zod schemas and a checklist — so validation and display could
  disagree. Both schemas and the checklist now derive from one list of rules
- CSV import matches columns automatically, exactly first then by alias, so an
  import no longer begins with thirteen empty dropdowns. It names the chosen file
  and its row count, warns when no column maps to a phone number, splits a single
  "Full name" column, previews the first three rows as they will be saved, and can
  attribute the import to a campaign
- `/leads?campaign=<id>`, so a campaign card links to its own leads rather than to
  the same unfiltered page it would have opened anyway
- An administration page that administers: seven readiness checks (trunk, secure
  origin, data path, accounts, leads, calls, scripts) each stating what was found
  and what to do about it, plus a plain-language account of how the deployment
  handles SIP credentials
- `ApiError`, carrying the HTTP status so a caller can tell a 409 from a 500

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

- ICE servers have one definition. They were built separately for a live call and
  for the configuration test, and two copies of an ICE list drift into a test that
  passes while real calls have no audio; both now call `resolveIceServers`
- A half-configured relay is refused rather than sent to the browser. TURN servers
  with no credential, or a credential with no server, are rejected by the form, by
  the API and by a check constraint: given servers it cannot authenticate to, a
  browser is refused an allocation and quietly falls back to a direct path, which
  reproduces the silence TURN exists to prevent behind a configuration that looks
  complete
- Sign-in now takes a username. An email address is still accepted and still
  resolves, because accounts created before this change keep the address they were
  created with — their `auth.users.email` was deliberately not rewritten, since
  that also means surgery on `auth.identities` on the only administrator a live
  deployment has
- The team roster shows usernames, and the trunk-assignment dropdown prefers a
  name or username over an address
- "An account with that email already exists" became "That username is already
  taken". Two people at two different companies who are both called Marco now
  collide on the username, and naming an address the administrator never typed
  would have been a message about nothing
- The self-hosted backend derives usernames for existing rows on boot, and the
  seeded administrator signs in as `seedadmin` rather than `admin@example.com`


- **The self-hosted backend runs on Postgres instead of SQLite**, which is what
  makes it deployable as a serverless function. Two separate problems, one fix:
  `better-sqlite3` is a native addon with no prebuilt binary for the Node version
  the platform runs, so `npm install` failed and the project had never once built;
  and even had it compiled, SQLite needs a writable durable file, which a
  serverless filesystem does not have — read-only outside `/tmp`, and `/tmp` does
  not survive an instance. `DATABASE_URL` is now **required**, with no default,
  because the file-backed store turned a typo'd environment into a working server
  full of empty tables rather than an error
- The backend's entrypoint is split in two: `src/app.ts` builds the Express app,
  `src/index.ts` listens on a port for Docker and a VPS, and `api/index.ts` is the
  Vercel handler. A module-scope `app.listen()` binds a port nothing routes to on a
  platform that calls a function per request
- `docker/Dockerfile.backend` no longer installs `python3`, `make` and `g++`. Those
  were there only to compile the native addon, and their absence is the visible part
  of why this build now succeeds where it did not
- Compose runs Postgres as a service with a healthcheck the API waits on, replacing
  the `backend-data` volume. Booting the API before the database accepts connections
  meant the first cold start lost a race and exited
- `npm run lint` now also runs `scripts/check-async-db.ts`, which looks for a
  `Promise` used in a boolean position and for database calls nobody awaits. Both
  are invisible to `tsc`: a Promise is an object, so `if (!row)` compiles and simply
  never fires — which, on an authorisation check, is an inverted one that reports
  success


- Type, corner-radius and elevation are now scales rather than whatever each
  component reached for: eight text sizes with the line height attached, five
  radii, three shadows reading `var(--shadow-*)`. `rounded-md`, `rounded-2xl` and
  the stock `shadow-sm`–`shadow-2xl` were removed from the config rather than
  aliased, so an off-scale value cannot be reintroduced without a build failure
- 191 hand-picked values across 29 files were migrated onto those scales —
  123 arbitrary `text-[Npx]` sizes, four `rounded-md`, three `rounded-2xl`,
  nineteen stock shadows, and 42 uses of absolute `white`/`black`, which were
  removed from the palette entirely because they ignored the theme
- Interface copy is sentence case throughout, with proper nouns and the product
  name excepted. 32 strings changed, including "Call History" → "Call history",
  "Avg Duration" → "Average duration" and "Do Not Contact" → "Do not contact"
- `StatusBadge` resolves its vocabulary from `lib/outcomes` instead of carrying
  its own 27-entry colour table, and the softphone uses the shared disposition
  definitions instead of a local copy of the same seven codes
- Campaign cards report what an operator actually wants to know about a campaign —
  leads, how far through them the team is, connect rate, conversions and when it
  was last worked — rather than a name, a type and a creation date
- The API client is typed end to end. All 32 `any` annotations are gone, and the
  types come from the same `types/database.ts` the Supabase path is checked
  against, so the two deployment modes cannot drift apart silently
- One definition of the deployment-mode flag, exported from `lib/apiClient`; five
  per-file copies of `const isApiMode = Boolean(...)` were removed

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

- The last hardcoded `SAMPLE_SCRIPT`. The workspace script panel was rewritten
  onto `useScriptFor(campaignId)` two turns after the scripts page was, and
  continued to show a fictional script for a lead whose campaign had none
- The campaign "Settings (JSON)" textarea. Nothing in the app reads
  `campaigns.settings`, so it asked operators to hand-write JSON no screen ever
  interpreted, and a syntax error in it blocked saving a campaign whose other
  fields were fine. Anything already stored is passed through untouched
- The duplicate `isTypingTarget` in `Layout.tsx`, now imported from `lib/keys`

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

- A self-hosted backend created before TURN support **refused every `sip_accounts`
  write** with `column "turn_urls" does not exist`. `ensureSchema()` builds the
  schema with `CREATE TABLE IF NOT EXISTS`, which never alters a table that already
  exists — so the routes referenced columns the only thing that creates the schema
  had already decided were unnecessary. It now runs a guarded repair block that
  adds the missing columns and constraints and widens the `provider` check to
  accept `bitcall`, which a table built before that preset would otherwise reject.
  Guarded rather than unconditional because it runs on every cold start, and a bare
  `ALTER TABLE ADD COLUMN` would fail the second time
- Administrators had **no way to assign a lead** to an agent. `leads.assigned_to`
  has existed since migration 001, the policies permitted writing it, and the API
  accepted it — but no `.tsx` file in the frontend referenced the column, so there
  was nothing to click and every lead sat in the shared pool
- The owner of a lead was invisible even to those who could see it. An agent cannot
  read the roster, so an owner's id resolves to nothing for them; the grid now says
  "You", "Assigned" or a real name according to what that reader is permitted to
  know, instead of labelling every assigned lead "Removed user"
- Creating an account failed with **"Failed to send a request to the Edge
  Function"** — the Supabase client's `FunctionsFetchError`, meaning `fetch` itself
  failed and no response was readable. The `admin-users` function imported the
  Supabase client from a CDN at module scope, so a cold start fetched a third-party
  registry before executing a line of code; if that failed the worker died with
  nothing running to log anything, and every request including the CORS preflight
  got the platform's own error page, which carries no `Access-Control-Allow-Origin`
  and so cannot be read cross-origin. The module now has no static imports, the
  dependency loads inside the request where a failure is caught and answered as
  `502` JSON naming it, and `Deno.serve` wraps the handler so no path — including
  one nobody anticipated — can respond without origin headers
- That specifier was also floating: `@supabase/supabase-js@2` resolves to whatever
  is newest when the worker boots, so one deploy could load different code on
  different days. Three sources are now tried in order — `npm:` pinned to 2.118.0,
  the same version through esm.sh, then the floating range as a last resort. `npm:`
  first also keeps a third-party CDN out of the path of code holding the service
  role key. A failure lists every source tried and why, which distinguishes a
  registry outage from a runtime that cannot resolve the specifier at all
- The ported backend's duplicate-account message had stopped working. It matched
  `"UNIQUE"`, which is how SQLite words it; Postgres says `duplicate key value
  violates unique constraint`, so saving a second trunk default returned a generic
  "Could not save the SIP account" instead of saying what was actually wrong. It now
  matches on the SQLSTATE, which does not depend on wording
- `PATCH /api/sip-accounts/:id` had no error handling, so a constraint violation
  reached the global handler as a 500 with a Postgres message in it. Refusing a
  half-configured relay now returns 400 with the reason
- The `admin-users` edge function rejected the deployment's own preview URLs. Its
  allowed origins were an enumerated list that had to be edited every time Vercel
  produced a new host, so each new branch silently lost the ability to create
  accounts — the failure looked like a broken form rather than a missing origin. It
  now matches this project's hosts by pattern (`cold-dialer-*.vercel.app`), which is
  safe because a Vercel subdomain is globally unique to the project that owns it;
  anything else goes in the `ADMIN_USERS_ALLOWED_ORIGINS` secret. A stale alias for a
  deployment that no longer exists was dropped at the same time. `*.vercel.app` was
  considered and rejected — over a shared domain it would let any project on the
  platform call this function with a stolen administrator token
- The same call outcome was two different colours depending on which screen you
  read it on: the badge painted `busy` red and `wrong_number` grey while
  `lib/outcomes` painted `busy` amber and `wrong_number` red
- Trunk assignment showed email addresses instead of names in API mode.
  `/api/users` has always returned `fullName`; the client declared the response a
  `profiles` row with `full_name` and cast it, so the property was undefined
- Choosing the same CSV file twice did nothing: "Change file" cleared the parsed
  rows without clearing the input, so the second selection fired no change event
- The Edit button on a campaign card set state that nothing ever read, so clicking
  it did nothing at all
- A bulk import through the API made one round trip per row — the exact cost the
  bulk endpoint exists to avoid — and dropped the `campaign_id` the server
  accepts, so an import could never be attributed to a campaign
- An import that partially failed reported the number submitted rather than the
  number written, sending the operator looking for leads that were never stored
- A rejected setup-status check became an unhandled promise rejection, and left
  the setup screen showing a spinner forever
- Sign-in labels were not associated with their inputs, and neither field carried
  `autoComplete`, so password managers could neither fill nor offer to save
- `text-${tone}` composed at runtime, which Tailwind cannot see and would have
  compiled to nothing — caught before it shipped by scanning the built CSS for
  every utility referenced in source

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
