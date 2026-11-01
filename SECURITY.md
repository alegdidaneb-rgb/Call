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

### Self-hosted API mode (Express + SQLite)

- `JWT_SECRET` is **required** in production. The server exits at startup if it
  is missing, shorter than 32 characters, or set to a value published in this
  repository's history. See `backend/src/config/env.ts`.
- Passwords are stored as bcrypt hashes (`BCRYPT_ROUNDS`, default 12) in
  `profiles.password_hash`. The hash is never returned by any endpoint.
- Login and signup are rate limited (20 requests / 15 min per IP), and failed
  logins return a generic message with uniform timing.
- Allowed browser origins come from `CORS_ORIGINS`; credentials are not sent.
- Every route is scoped to the authenticated user, and destructive operations
  (`DELETE /leads/:id`, `DELETE /campaigns/:id`, `DELETE /scripts/:id`) require
  the `admin` role.
- CSV import is capped at `MAX_IMPORT_ROWS` (default 1000) and reports per-row
  failures instead of silently dropping them.

### SIP credentials

`VITE_SIP_*` values are compiled into the browser bundle and are therefore
visible to anyone using the app. Treat them as per-agent, low-trust credentials:

- issue one SIP extension per agent rather than sharing one;
- restrict the provider account so an extension can only dial permitted
  destinations;
- rotate credentials if they may have leaked.

## Environment Variables

Never commit these files (they are git-ignored):

- `.env`, `.env.local`, `.env.development`, `.env.production`
- `backend/.env`
- `backend/data/*.db` (contains password hashes and lead PII)

Use `.env.example` and `backend/.env.example` as templates.

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
now the single source of truth for SQLite.

## Hardening Checklist for Production

- [ ] `JWT_SECRET` generated with `openssl rand -hex 32` (API mode)
- [ ] `CORS_ORIGINS` set to the exact frontend origin(s) (API mode)
- [ ] `SEED_ADMIN_PASSWORD` set, or the seeded admin removed entirely
- [ ] Supabase migrations applied and RLS verified with
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace;`
- [ ] HTTPS enforced; SIP over `wss://` only
- [ ] Filesystem permissions restrict access to the SQLite database file
- [ ] Dependencies audited (`npm audit`) and CodeQL enabled
