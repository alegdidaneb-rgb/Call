# Security Policy

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security problems.

Use GitHub's private vulnerability reporting instead:

1. Go to the **Security** tab of this repository.
2. Choose **Report a vulnerability** (Advisories → Report).
3. Include reproduction steps and the affected version or commit.

If private reporting is not enabled on this repository, contact the maintainers
through the email address listed on their GitHub profile.

We aim to acknowledge reports within 3 business days.

## Supported Versions

| Version | Supported |
|---------|-----------|
| `main`  | ✅ Yes    |

## Security Model

### Supabase mode (hosted frontend, e.g. Vercel)

The browser talks to Supabase directly with the **anon/publishable** key. That key
is public by design, so **Row Level Security is the only access control**:

- RLS is enabled on every table (`supabase/migrations/001_init.sql`).
- Policies are scoped per user: an agent sees their own leads, the leads they
  created, and the unassigned pool. Admins and managers see everything.
- `public.is_admin()` / `public.is_privileged()` are `SECURITY DEFINER` with a
  pinned `search_path`, so policies can consult `profiles` without recursing.
- Triggers normalise `created_by` / `user_id` to `auth.uid()` so a client cannot
  attribute rows to another user.
- A trigger prevents non-admins from changing their own `role`.
- The `anon` role has no table grants at all.

Never ship the `service_role` or `sb_secret_*` key to the browser. Only
`VITE_SUPABASE_URL` and the publishable/anon key belong in a `VITE_` variable.

### Self-hosted API mode (Express + Postgres)

- `DATABASE_URL` is **required**, in every environment including development, and
  there is no fallback. The server exits at startup if it is missing or is not a
  `postgres://` URL. This is deliberate: the SQLite store this replaced created a
  file wherever it was pointed, so a typo in the environment produced a *working*
  server full of empty tables rather than an error. Failing loudly is the safer
  default, and on a serverless platform there is no local file to fall back to.
  Use a role scoped to this application's tables rather than the database
  superuser, and keep the host off the public internet.
- `JWT_SECRET` is **required** in production. The server exits at startup if it
  is missing, shorter than 32 characters, or set to a value published in this
  repository's history. See `backend/src/config/env.ts`.
- Passwords are stored as bcrypt hashes (`BCRYPT_ROUNDS`, default 12) in
  `profiles.password_hash`. The hash is never returned by any endpoint.
- Login is rate limited (20 requests / 15 min per IP), and failed logins return
  a generic message with uniform timing. There is no public signup endpoint.
  **Caveat when deployed as a serverless function:** `express-rate-limit` counts
  in process memory, so each lambda instance keeps its own counter and an attacker
  who spreads requests across instances gets a multiple of the stated budget. It
  still throttles a single instance, and the platform reuses warm ones, but it is
  not the guarantee it was as one long-lived process. Closing the gap needs a
  shared store (`rate-limit-redis`, `@upstash/ratelimit`) and therefore
  infrastructure this deployment does not have. Recorded rather than papered over;
  Supabase mode is unaffected, as it enforces auth limits at the platform.
  The same applies to the 300/min global limiter.
- Data routes additionally require `requireProvisioned`, so an account that
  authenticated but was never created by an administrator gets `403` rather than
  an empty result set that looks like a successful load.
- Allowed browser origins come from `CORS_ORIGINS`; credentials are not sent.
- Every route is scoped to the authenticated user, and destructive operations
  (`DELETE /leads/:id`, `DELETE /campaigns/:id`, `DELETE /scripts/:id`) require
  the `admin` role.
- CSV import is capped at `MAX_IMPORT_ROWS` (default 1000) and reports per-row
  failures instead of silently dropping them.

### SIP credentials

A browser softphone performs SIP digest authentication itself, so the password
must reach the page. This is inherent to calling from a browser rather than a
server-side trunk, and no client-side design removes it. Treat these as
per-agent, low-trust credentials.

Credentials live in `public.sip_accounts`, readable only by the owning agent and
by administrators (`is_admin()`), and writable only by administrators. An agent
cannot edit their own row, because that would let them point the softphone at a
server they control. Unprovisioned accounts can read nothing, including the
shared trunk default. `anon` has no grants at all. A partial unique index allows
at most one trunk default, so the "which extension am I dialling from?" lookup
cannot become ambiguous.

In self-hosted API mode the same rules are enforced by `requireRole("admin")` on
every write and by `requireProvisioned` on every read.

`VITE_SIP_*` values, if used, are compiled into the browser bundle and visible to
anyone who can load the app. Whichever path is used:

- issue one SIP extension per agent rather than sharing one, so a leak can be
  contained and a provider-side block applied without ending a campaign;
- restrict each extension at the provider: cap concurrent calls, limit permitted
  destinations, and block premium-rate ranges;
- rotate credentials if they may have leaked, and remember that a browser
  extension or a shared workstation can read them at any time.

Cold calling carries legal exposure — consent, time-of-day and do-not-call rules
— that no amount of client-side validation reduces. The `dnc_list` table and the
per-lead country are the app's contribution; the operator's obligations are not
discharged by them.

## Environment Variables

Never commit these files (they are git-ignored):

- `.env`, `.env.local`, `.env.development`, `.env.production`
- `backend/.env`
- `backend/data/*.db` (contains password hashes and lead PII)

Use `.env.example` and `backend/.env.example` as templates.

## User Provisioning

There is no public sign-up. An account exists only because an administrator
created it, and this is enforced at three independent layers so that removing any
one of them does not reopen registration.

1. **No client path.** `SignupPage` and `auth.signUp` are gone. The only
   provisioning UI is `/team`, route-guarded to `admin`.
2. **Server-side authorisation.** Creating a Supabase user needs the service role
   key, which lives only in the `admin-users` edge function. That function
   verifies the caller's JWT and requires `profiles.role = 'admin'` before it will
   create anything; a non-admin calling it directly gets `403`. The self-hosted
   backend mirrors this with `POST /api/users` behind `requireRole("admin")`.
3. **Database.** `profiles.invited_by` records who onboarded an account. Every
   agent-facing RLS policy is gated on `public.is_provisioned()`, and
   `protect_profile_fields()` stops a non-admin from changing `role`, `invited_by`
   or `username` — including on their own row. `username` is in that set because
   it is an identity: without it an agent could rename themselves to a colleague's
   username and let the unique index decide who keeps it.

The consequence is that an account created by calling `auth.signUp()` directly
with the public anon key **authenticates but can read nothing**: `role = 'agent'`,
`invited_by = null`, zero rows from every table. Verified against the live
database — such an account saw 0 of 1 unassigned leads, its attempt to set
`role = 'admin'` and `invited_by` on its own profile was reverted by the trigger,
and once an administrator set `invited_by` the same account saw the lead pool.

**Why not just set Supabase's `disable_signup`?** This project's Supabase instance
is shared with another application, and that flag is global — turning it off would
break the other application's registration too. The database-level control above
achieves the same guarantee for Cold Dialer without touching shared
configuration. If Cold Dialer ever moves to its own project, set
`disable_signup = true` as well; it is defence in depth, not a replacement.

**First-run bootstrap.** `/setup` creates the first administrator and is refused
by the server as soon as any account exists, so it cannot mint a second admin.
Provision a fresh deployment promptly: while `profiles` is empty, bootstrap is
open to anyone who can reach the site.

**Handover.** Accounts are created already confirmed, with a temporary password
the admin sets. There is no email confirmation step and no mailbox behind the
account, so the username and password must be passed over a secure channel and
the password rotated by the new user.

### Usernames and sign-in

Accounts are created from a **username** and signed into with one. Nobody types an
email address anywhere in the product: not on `/setup`, not on `/team`, not on
`/login`.

Supabase Auth has no username identity — `auth.admin.createUser` accepts an email
or a phone, and `profiles.email` is `not null unique` — so the email cannot be
removed, only made irrelevant. It is kept as the internal identity:

- Accounts created since migration 005 get a synthetic address,
  `<username>@agents.cold-dialer.internal`. That domain is not routable and is not
  owned by anyone, so no mail is ever sent or bounced. It exists purely to satisfy
  a `not null unique` column.
- Accounts that predate it **keep the real address they were created with**. Their
  `auth.users.email` was deliberately not rewritten: doing so also requires
  matching surgery on `auth.identities`, on a deployment whose only account is its
  only administrator, with no recovery path if it went wrong. They sign in with a
  username derived from their address, and their address still works.
- Sign-in resolves a username to its address through
  `public.resolve_login_email`, one path for both kinds of account.

**Accepted trade: usernames are enumerable.** `resolve_login_email` is
`security definer` and granted to `anon`, because sign-in happens before there is
a session and an unauthenticated caller has no row-level access to `profiles` at
all. An unauthenticated caller can therefore confirm that a username exists. It
returns the address and nothing else — no role, no name, no other account — and
password guessing remains rate limited by Supabase. The alternative was rewriting
`auth.users.email` on the sole administrator of a live deployment, which was
judged a worse risk than leaking the existence of a username.

**There is no self-service recovery, by construction.** A synthetic address cannot
receive a reset link, so "forgot password" is not offered and cannot be added
without reintroducing email collection. Administrators set passwords instead, from
**Team → Reset password**, via the edge function's `reset-password` action
(`POST /api/users/:id/password` in API mode). Two limits are stated rather than
hidden:

- An administrator can reset another administrator's password and so act as them.
  Every administrator already has full authority over all data, so this grants no
  new reach, but it does defeat per-account attribution.
- Sessions already issued to the old password keep working until their token
  expires. Nothing in this schema can revoke them. If an account is suspected
  compromised, deleting it is the only complete remedy.

**If the sole administrator forgets their password**, the app cannot help: there is
no address to mail and no second administrator to reset it. Recovery is through the
Supabase dashboard (or `SEED_ADMIN_PASSWORD` on a self-hosted deployment), not
through this product.

**Break-glass: restoring a real address.** Because `profiles.email` still holds the
original address for migrated accounts, and `auth.users.email` was never touched,
an older account can be reverted to email sign-in with no data change at all — the
address simply still works. For an account created with a synthetic address,
restoring a deliverable one means `auth.admin.updateUserById` with a new email
*plus* a matching update to `auth.identities`, and `mailer_secure_email_change_enabled`
is on, so expect a confirmation round trip. Do this on a throwaway account first.

## Dependency Advisories

`npm audit` is run as part of any dependency change. Current state:

- **Backend: 0 known vulnerabilities.** Express 4 pins `proxy-addr ~2.0.7`,
  `body-parser ~1.20.5` and `qs ~6.16.0`, all of which have published
  advisories. The critical one, `proxy-addr` IP spoofing via IPv4-mapped IPv6
  trust subnets, directly undermined IP-based rate limiting, so
  `overrides` in `backend/package.json` force `proxy-addr ^2.0.8`,
  `body-parser ^1.20.9` and `qs ^6.16.2`. These are patch-level and avoid an
  Express 5 migration. Re-check the overrides on every Express bump.
- **Frontend: 7 moderate advisories, 0 high or critical**, all accepted:
  - `eslint` and its `minimatch` / `@eslint/*` chain — development-only linter,
    never shipped to the browser. No fix exists within ESLint 9; ESLint 10 drops
    `.eslintrc` support, which this project uses, so upgrading means migrating to
    flat config first.
  - `react-router` / `react-router-dom` — an open redirect via a backslash in
    `<Link to>` / `navigate()`. **Not reachable here**: every navigation target
    in this codebase is a static literal or `/leads/${lead.id}`, where `lead.id`
    is a server-generated UUID primary key (`default gen_random_uuid()`) and never
    client-controlled. The fix requires React Router 7, whose
    `v7_relativeSplatPath` default changes relative resolution for the
    `path="/*"` + nested `<Routes>` pattern used in `App.tsx`. Revisit when that
    routing is flattened.

Unused dependencies are removed rather than patched: `multer`, `papaparse` and
the whole Drizzle layer (`drizzle-orm`, `drizzle-kit`, `src/db/schema.ts`) were
declared but never imported by runtime code. Dropping Drizzle also removes a
second, competing definition of the schema — the DDL in `src/db/database.ts` is
now the single source of truth for the self-hosted Postgres schema.

## Hardening Checklist for Production

- [ ] `JWT_SECRET` generated with `openssl rand -hex 32` (API mode)
- [ ] `CORS_ORIGINS` set to the exact frontend origin(s) (API mode)
- [ ] `SEED_ADMIN_PASSWORD` set, or the seeded admin removed entirely
- [ ] Supabase migrations applied and RLS verified with
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace;`
- [ ] HTTPS enforced; SIP over `wss://` only
- [ ] `DATABASE_URL` credentials are not the database superuser, and the host is
      not reachable from the public internet (API mode)
- [ ] Dependencies audited (`npm audit`) and CodeQL enabled
