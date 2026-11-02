# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- International leads: `leads.country` (ISO 3166-1 alpha-2) in both the Supabase
  and SQLite schemas, a 250-country picker in the lead form, and a country column
  on the lead detail view
- `scripts/generate-countries.mjs` plus `npm run gen:countries`, which generates
  the committed country table from the ISO 3166-1 `world-countries` dataset
- `country` accepted in CSV imports and normalised (`"gb"` -> `GB`, `""` -> NULL)
  by a trigger in Postgres and by validation in the backend

### Changed
- The lead form's dialling prefix is derived from the selected country instead of
  being a separate control that offered only "+1 (US)"
- Lead address fields relabelled "State / Region" and "Postal code"

### Added
- Admin-only account provisioning: `admin-users` Supabase edge function,
  `POST /api/users` in the self-hosted backend, and a Team page for administrators
- First-run `/setup` screen, closed by the server once any account exists
- `profiles.invited_by` plus `is_provisioned()` / `is_service_role()` in Postgres,
  and a matching `requireProvisioned` middleware in the backend
- "Waiting for an administrator" screen for accounts that authenticated without
  being provisioned

### Removed
- Public self-service sign-up: `SignupPage`, `auth.signUp`, `POST /api/auth/signup`,
  and the unused `multer`, `papaparse` and Drizzle dependencies

### Changed
- Every agent-facing RLS policy now requires the caller to be provisioned, so an
  account created directly through the Supabase Auth API can read nothing
- New auth users are no longer auto-promoted: the first-admin bootstrap is now an
  explicit server-side action instead of a race on an empty table
- Self-hosted backend with SQLite database
- Express.js API server with JWT authentication
- Provider abstraction layer (Supabase or self-hosted backend)
- SIP configuration module with provider presets
- Docker Compose deployment
- GitHub Actions CI workflow
- Comprehensive documentation
- Data seeder with sample leads

### Changed
- Rebranded from "Apex Precision Billing" to "Cold Dialer"
- Refactored SIP configuration into separate module
- Updated hooks to support multiple data providers

### Fixed
- Removed hardcoded email from dev user
- Updated .env.example with all configuration options
- Expanded .gitignore for better security

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
