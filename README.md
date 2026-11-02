# Open Cold Dialer

A free, open-source browser-based cold calling dialer with SIP support. No install required — runs in your browser.

![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-20%2B-brightgreen)
![Stars](https://img.shields.io/github/stars/alegdidaneb-rgb/Call?style=social)
![Forks](https://img.shields.io/github/forks/alegdidaneb-rgb/Call?style=social)
![Last Commit](https://img.shields.io/github/last-commit/alegdidaneb-rgb/Call)
![Issues](https://img.shields.io/github/issues/alegdidaneb-rgb/Call)
![License](https://img.shields.io/github/license/alegdidaneb-rgb/Call)

---

## Demo

> **Coming soon** — Demo video and screenshots

<!-- Add screenshots here: -->
<!-- ![Dashboard](docs/screenshots/dashboard.png) -->
<!-- ![Softphone](docs/screenshots/softphone.png) -->
<!-- ![Leads](docs/screenshots/leads.png) -->

---

## Why Cold Dialer?

| Feature | Cold Dialer | RingCentral | Dialpad | Five9 |
|---------|------------|-------------|---------|-------|
| Price | **Free** | $30/user/mo | $25/user/mo | $150+/user/mo |
| Self-hosted | Yes | No | No | No |
| Open Source | Yes | No | No | No |
| SIP Provider | Any | Locked | Locked | Locked |
| Browser-based | Yes | Yes | Yes | Yes |
| Lead Management | Yes | Extra | Extra | Extra |
| CSV Import | Yes | No | No | Yes |
| Call Scripts | Yes | No | No | Yes |

**Cold Dialer** = Free forever, self-hosted, works with any SIP provider.

---

## Features

- **Browser Softphone** — SIP.js integration, no desktop app needed
- **Multi-Provider SIP** — Works with SignalWire, Telnyx, Twilio, or any SIP server
- **Lead Management** — CRUD, CSV import, search, filter by status, international
  addresses (250 countries, dialling codes derived from the country)
- **Web Softphone** — real SIP/WebRTC calling in the browser: registration, mute,
  hold, DTMF, inbound calls, and call disposition written back to the lead
- **Campaign Management** — Create and track outbound calling campaigns
- **Call Scripts** — Script templates with objection handling responses
- **Call History** — Log every call with outcome, duration, and notes
- **Dashboard** — Real-time stats on leads, calls, and conversion rates
- **Auth** — User accounts with role-based access
- **Self-Hosted Backend** — SQLite database, no cloud dependencies required
- **Supabase Support** — Optional cloud database backend
- **Docker Ready** — One-command deployment
- **REST API** — Full API for integrations

---

## Quick Start (5 Minutes)

### Option 1: Self-Hosted (Recommended)

```bash
git clone https://github.com/alegdidaneb-rgb/Call.git
cd Call

# Backend
cd backend
npm install
npm run seed
npm run dev

# Frontend (new terminal)
cd frontend
npm install
cp .env.example .env.local
# Edit .env.local → set VITE_API_URL=http://localhost:4000
npm run dev
```

Open http://localhost:3000 — 20 sample leads pre-loaded.

**Seeded login:** `admin@example.com`. The seed script uses the well-known
development password `password123` unless `SEED_ADMIN_PASSWORD` is set, and warns
when it does. Never run the seed against a reachable deployment without setting it.

### Option 2: Docker

```bash
git clone https://github.com/alegdidaneb-rgb/Call.git
cd Call
cp .env.example .env.local
docker compose up -d
docker compose exec backend npm run seed
```

### Option 3: Supabase (Cloud)

```bash
git clone https://github.com/alegdidaneb-rgb/Call.git
cd Open-Cold-Dialer/frontend
npm install
cp .env.example .env.local
# Add your Supabase URL and anon key to .env.local
npm run dev
```

---

## Countries and Dialling Codes

`leads.country` holds an ISO 3166-1 alpha-2 code (`GB`, `US`, `AE`). The dialling
prefix is derived from it, so the two can never disagree — there is no separate
prefix control to set incorrectly.

The country list is **generated, not hand-written**: `scripts/generate-countries.mjs`
reads the [`world-countries`](https://www.npmjs.com/package/world-countries) ISO
3166-1 dataset and emits `frontend/src/data/countries.ts`. That package is ~20 MB
unpacked, so it is a build-time source rather than a dependency; the generated
module is committed and Vite code-splits it into its own ~18 KB chunk that only
loads with the lead screens.

```bash
npm i --no-save world-countries   # deliberately not in package.json
npm run gen:countries
```

Regenerate when a country is renamed, gains independence, or is reassigned a
dialling code.

Dialling prefixes are shared, and the generator resolves them by preferring the
single sovereign UN member state in each group: `+44` resolves to the United
Kingdom rather than Guernsey, Jersey or the Isle of Man, and `+61` to Australia
rather than Christmas Island. Where several sovereign states genuinely share a
prefix — `+1` (the US, Canada and the Caribbean) and `+7` (Russia and Kazakhstan)
— nothing is guessed. That matters because leads saved before `country` existed
have it inferred from the stored number, and a wrong country on a calling list is
a compliance problem, not a cosmetic one.

## SIP Configuration

Calls are placed from the browser over WebRTC, through a SIP provider that
connects them to the telephone network. A browser cannot reach a phone number on
its own, so **without provider credentials there is nothing to call with** — and
the app says so on every lead page instead of pretending to dial.

Sign in as an administrator and open **Phone** in the sidebar to add credentials.
They take effect immediately, on every open session, with no rebuild:

| Field | Example |
| --- | --- |
| SIP URI | `sip:1001@pbx.example.com` |
| WebSocket URL | `wss://pbx.example.com:8089/ws` |
| Password | the extension's digest password |
| Assign to | shared trunk default, or one specific agent |

**Test connection** registers and then unregisters without placing a call, and
waits for the server to *confirm* the registration — so a wrong password is
caught before a campaign starts rather than in the middle of one.

Build-time `VITE_SIP_*` variables remain supported as a fallback (see
`.env.example`), but they are compiled into the bundle, so changing one needs a
redeploy.

Works with SignalWire, Telnyx, Twilio, Asterisk, FreeSWITCH, 3CX, or any SIP
server that accepts WebSocket clients.

See [SIP Providers Guide](docs/sip-providers.md)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS |
| Backend | Express.js + SQLite (better-sqlite3) |
| Auth | JWT (bcryptjs) |
| SIP/Telephony | SIP.js (WebRTC) |
| Data Fetching | TanStack React Query |
| Validation | Zod |
| CSV Import | PapaParse |

---

## Project Structure

```
Open-Cold-Dialer/
├── frontend/                # React SPA
│   └── src/
│       ├── components/      # UI components
│       ├── hooks/           # Data fetching hooks
│       ├── lib/             # Supabase, auth, API client
│       ├── pages/           # Route pages
│       ├── sip/             # SIP configuration
│       └── types/           # TypeScript types
├── backend/                 # Express API server
│   └── src/
│       ├── db/              # SQLite schema + seed
│       ├── middleware/      # Auth middleware
│       └── routes/          # API routes
├── docs/                    # Documentation
├── docker/                  # Docker configuration
├── supabase/                # Database migrations
└── scripts/                 # Deploy scripts
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | Sign in |
| GET | /api/auth/me | Get current user |
| GET | /api/auth/status | Whether first-run setup is still available |
| POST | /api/auth/bootstrap | Create the first admin (empty database only) |
| GET | /api/users | List accounts *(admin)* |
| POST | /api/users | Create an account *(admin)* |
| GET | /api/leads | List leads |
| POST | /api/leads | Create lead |
| PATCH | /api/leads/:id | Update lead |
| DELETE | /api/leads/:id | Delete lead |
| POST | /api/leads/import | Import CSV |
| GET | /api/campaigns | List campaigns |
| POST | /api/campaigns | Create campaign |
| GET | /api/call-logs | List call logs |
| POST | /api/call-logs | Create call log |
| GET | /api/scripts | List scripts |

---

## Roadmap

- [ ] Audio device selector (mic/speaker)
- [ ] Call recording
- [ ] Parallel dialing (power dialer)
- [ ] Voicemail detection
- [ ] DNC list management
- [ ] Appointment scheduling
- [ ] Webhook integrations
- [ ] AI call summary

See [Open Issues](https://github.com/alegdidaneb-rgb/Call/issues) for more.

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
# Fork the repo
# Create your feature branch
git checkout -b feature/amazing-feature
# Commit your changes
git commit -m "Add amazing feature"
# Push to the branch
git push origin feature/amazing-feature
# Open a Pull Request
```

---

## License

MIT License — see [LICENSE](LICENSE)

---

## Deploying (Vercel + Supabase)

The frontend is a static Vite SPA, so it hosts on Vercel. Persistence and auth come
from Supabase, and **Row Level Security is the access control layer** — see
[SECURITY.md](SECURITY.md).

1. **Supabase** — apply both files in `supabase/migrations/` in order (SQL editor,
   or `supabase db push`). `001_init.sql` creates the schema and enables RLS on
   every table; `002_admin_only_users.sql` makes account creation admin-only.
2. **Edge function** — deploy `supabase/functions/admin-users` (`supabase functions
   deploy admin-users --no-verify-jwt`). It holds the service role key server-side
   and is the only thing that can create an account.
3. **First account** — open `/setup` and create the first administrator. That
   screen works only while the database has no accounts; the server rejects it
   afterwards. There is **no public sign-up** — from then on every account is
   created by an admin from **Team**.
4. **Vercel** — import this repository and set Root directory `frontend`, Framework
   `vite`, Build command `npm run build`, Output directory `dist`.
5. **Environment variables** (Vercel → Project → Settings → Environment Variables):

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | publishable/anon key (public by design) |

   Leave `VITE_API_URL` **empty**. Setting it switches the app to self-hosted API
   mode, which needs a Node server with a writable disk and will not work on Vercel.

5. **SIP** — add `VITE_SIP_URI`, `VITE_SIP_PASSWORD`, `VITE_SIP_WS_URL` and
   `VITE_SIP_CALLER_ID` to place real calls. These are compiled into the browser
   bundle, so issue one low-privilege extension per agent and rotate on suspicion.

> The Express + SQLite backend is for self-hosting (Docker or a VPS). It requires
> `JWT_SECRET` and refuses to start in production without it.

---

## Attribution

Derived from [Open Cold Dialer](https://github.com/6t9xstar/Open-Cold-Dialer) by
[@6t9xstar](https://github.com/6t9xstar), used under the MIT License. The full
license text is preserved in [LICENSE](LICENSE).

---

## Contributors

<a href="https://github.com/6t9xstar">
  <img src="https://contrib.rocks/image?repo=alegdidaneb-rgb/Call" />
</a>

---

## Support

- [Documentation](docs/)
- [Quick Start Guide](docs/quick-start.md)
- [SIP Provider Guides](docs/sip-providers.md)
- [Deployment Guide](docs/deployment.md)
- [GitHub Issues](https://github.com/alegdidaneb-rgb/Call/issues)

---

## Star History

If you find this useful, please give it a star! It helps others discover the project.

[![Star History Chart](https://api.star-history.com/svg?repos=alegdidaneb-rgb/Call&type=Date)](https://star-history.com/#alegdidaneb-rgb/Call&Date)
