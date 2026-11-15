/**
 * Schema and boot-time migration for the self-hosted API.
 *
 * Ported from SQLite to Postgres so this backend can run where a process cannot
 * own a durable file — Vercel's serverless filesystem is read-only outside
 * `/tmp`, and `/tmp` does not survive an instance. It also removes the native
 * `better-sqlite3` dependency, which had no prebuilt binary for the platform's
 * Node version and failed `npm install` outright.
 *
 * Two deliberate choices that keep the API's behaviour identical:
 *
 *   - IDs stay `text`, not `uuid`. Every caller passes UUID *strings*, and `uuid`
 *     columns would turn a malformed id from a client into a 500 (`invalid input
 *     syntax for type uuid`) instead of the 404 the routes already return.
 *   - Flags stay `integer` 0/1, not `boolean`. The client reads `dnc`, `is_active`
 *     and `enabled` as numbers, and `pg` would otherwise hand back `true`/`false`.
 *
 * The SQLite-era additive migrations (`PRAGMA table_info` column backfills, the
 * derived-username backfill, the unique-index probes) are gone on purpose: no
 * Postgres deployment predates this file, so there is nothing to upgrade. A
 * future column addition needs a real migration — `ALTER TABLE ... ADD COLUMN IF
 * NOT EXISTS` guarded by an `information_schema.columns` check — rather than the
 * introspection helpers that used to live here.
 */

import { db } from "./pool.js";

/**
 * Idempotent DDL. Safe to run on every cold start, which serverless makes
 * frequent; IF NOT EXISTS means a warm pool pays one round trip and nothing
 * else.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS profiles (
    id text PRIMARY KEY,
    -- What an account signs in with. Unique case-insensitively, matching the
    -- Supabase deployment's migration 005 so the two modes agree about identity.
    username text NOT NULL,
    -- Supabase Auth has no username identity, so an account's address is derived
    -- from its username under a domain that receives no mail. Kept NOT NULL
    -- UNIQUE because it predates usernames and other code still reads it.
    email text NOT NULL UNIQUE,
    full_name text,
    password_hash text,
    role text NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent', 'manager')),
    invited_by text REFERENCES profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id text PRIMARY KEY,
    name text NOT NULL,
    type text NOT NULL DEFAULT 'outbound' CHECK (type IN ('outbound', 'inbound', 'blended')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
    settings text,
    created_by text REFERENCES profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS leads (
    id text PRIMARY KEY,
    first_name text,
    last_name text,
    company text,
    phone text,
    email text,
    website text,
    address text,
    city text,
    state text,
    zip text,
    country text,
    status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'interested', 'not_interested', 'callback', 'converted', 'do_not_contact')),
    source text,
    campaign_id text REFERENCES campaigns(id) ON DELETE SET NULL,
    assigned_to text REFERENCES profiles(id) ON DELETE SET NULL,
    created_by text REFERENCES profiles(id) ON DELETE SET NULL,
    tags text,
    notes text,
    dnc integer NOT NULL DEFAULT 0,
    last_called_at timestamptz,
    call_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS call_scripts (
    id text PRIMARY KEY,
    title text NOT NULL,
    category text,
    content text,
    objection_responses text,
    campaign_id text REFERENCES campaigns(id) ON DELETE SET NULL,
    created_by text REFERENCES profiles(id) ON DELETE SET NULL,
    is_active integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS call_logs (
    id text PRIMARY KEY,
    lead_id text REFERENCES leads(id) ON DELETE CASCADE,
    user_id text REFERENCES profiles(id) ON DELETE SET NULL,
    campaign_id text REFERENCES campaigns(id) ON DELETE SET NULL,
    direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
    outcome text NOT NULL CHECK (outcome IN ('no_answer', 'answered', 'busy', 'voicemail', 'dnc', 'wrong_number', 'disconnected')),
    duration_seconds integer NOT NULL DEFAULT 0,
    recording_url text,
    notes text,
    transcript text,
    sip_call_id text,
    started_at timestamptz,
    ended_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id text PRIMARY KEY,
    lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    scheduled_at timestamptz NOT NULL,
    duration_minutes integer NOT NULL DEFAULT 30,
    type text NOT NULL CHECK (type IN ('sales_call', 'demo', 'follow_up', 'consultation', 'check_in')),
    status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS dnc_list (
    id text PRIMARY KEY,
    phone text NOT NULL UNIQUE,
    reason text,
    source text,
    created_by text REFERENCES profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS sip_accounts (
    id text PRIMARY KEY,
    -- NULL means this is the shared trunk default rather than somebody's own.
    user_id text REFERENCES profiles(id) ON DELETE CASCADE,
    label text,
    provider text NOT NULL DEFAULT 'custom'
      CHECK (provider IN (
        'signalwire', 'telnyx', 'twilio', 'bitcall', 'freeswitch', 'custom'
      )),
    sip_uri text NOT NULL,
    -- Stored in plaintext, as it is in the Supabase deployment: the browser needs
    -- it to register a SIP session, so it cannot be hashed. Documented in
    -- SECURITY.md rather than pretended away.
    password text NOT NULL,
    ws_url text NOT NULL,
    caller_id text,
    stun_urls text NOT NULL DEFAULT '["stun:stun.l.google.com:19302"]',
    -- A relay is what carries media when STUN cannot: both ends behind a symmetric
    -- NAT, or a firewall dropping inbound UDP. Empty means no relay, which is a
    -- valid configuration for agents on open networks.
    turn_urls text NOT NULL DEFAULT '[]',
    turn_username text,
    -- Plaintext, as the SIP password is: the browser must send it to the relay.
    turn_credential text,
    -- Half a relay credential is worse than none. With no username the browser
    -- would be given TURN servers it cannot authenticate to, the allocation would
    -- be refused, and the call would silently fall back to a direct path that does
    -- not work -- the failure TURN exists to prevent, now invisible.
    CONSTRAINT sip_accounts_turn_credential_pairs CHECK (
      (turn_username IS NULL AND turn_credential IS NULL)
      OR (COALESCE(BTRIM(turn_username), '') <> '' AND COALESCE(BTRIM(turn_credential), '') <> '')
    ),
    -- A credential with no server to use it on is a configuration mistake too.
    --
    -- Compared as text rather than parsed, because a CHECK constraint may not
    -- contain a subquery and every JSON array function is one. Safe here because
    -- this column is only ever written through JSON.stringify, which produces
    -- exactly '[]' for an empty list and never adds whitespace.
    CONSTRAINT sip_accounts_turn_needs_server CHECK (
      turn_username IS NULL OR BTRIM(turn_urls) NOT IN ('[]', '', 'null')
    ),
    register_expiry integer NOT NULL DEFAULT 600 CHECK (register_expiry BETWEEN 60 AND 3600),
    enabled integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
  CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);
  CREATE INDEX IF NOT EXISTS idx_leads_created_by ON leads(created_by);
  CREATE INDEX IF NOT EXISTS idx_call_logs_lead ON call_logs(lead_id);
  CREATE INDEX IF NOT EXISTS idx_call_logs_user ON call_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_call_logs_created_at ON call_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_appointments_lead ON appointments(lead_id);
  CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(user_id);
  CREATE INDEX IF NOT EXISTS idx_dnc_phone ON dnc_list(phone);

  -- Case-insensitive, so Marco and marco cannot be two accounts. Matches
  -- profiles_username_key in the Supabase deployment's migration 005.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username ON profiles(lower(username));

  -- At most one shared trunk default. Postgres, like SQLite, treats NULLs as
  -- distinct in a unique index, so the sentinel is what makes this enforceable.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sip_accounts_owner
    ON sip_accounts(COALESCE(user_id, '__trunk_default__'));

  -- Repair a table that already existed.
  --
  -- CREATE TABLE IF NOT EXISTS never alters anything, so a database created before
  -- a column was added keeps running with the old shape while the routes above
  -- reference the new one. That is not hypothetical: the deployed API's database
  -- was built before TURN support and then refused every sip_accounts write with
  -- "column turn_urls does not exist", because the only thing that creates the
  -- schema had already decided the table was fine.
  --
  -- The guarded block is the same convention supabase/migrations/006_sip_turn.sql
  -- uses, so both deployments converge on one shape from two different starting
  -- points. Guarded rather than unconditional because this runs on every cold
  -- start, and a bare ALTER TABLE ADD COLUMN would fail the second time.
  DO $repair$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'sip_accounts'
                      AND column_name = 'turn_urls') THEN
      ALTER TABLE sip_accounts
        ADD COLUMN turn_urls text NOT NULL DEFAULT '[]',
        ADD COLUMN turn_username text,
        ADD COLUMN turn_credential text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'sip_accounts_turn_credential_pairs') THEN
      ALTER TABLE sip_accounts
        ADD CONSTRAINT sip_accounts_turn_credential_pairs CHECK (
          (turn_username IS NULL AND turn_credential IS NULL)
          OR (COALESCE(BTRIM(turn_username), '') <> '' AND COALESCE(BTRIM(turn_credential), '') <> '')
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'sip_accounts_turn_needs_server') THEN
      ALTER TABLE sip_accounts
        ADD CONSTRAINT sip_accounts_turn_needs_server CHECK (
          turn_username IS NULL OR BTRIM(turn_urls) NOT IN ('[]', '', 'null')
        );
    END IF;

    -- 'bitcall' and 'freeswitch' are named provider presets in the app, so a table
    -- built before either has to start accepting it. Both are tested rather than
    -- just the newest: a database can be missing one and not the other, depending
    -- on which revision created it, and testing only 'freeswitch' would leave a
    -- table that never received 'bitcall' rejecting it forever.
    IF EXISTS (SELECT 1 FROM pg_constraint c
                WHERE c.conname = 'sip_accounts_provider_check'
                  AND c.conrelid = 'sip_accounts'::regclass
                  AND (pg_get_constraintdef(c.oid) NOT LIKE '%bitcall%'
                    OR pg_get_constraintdef(c.oid) NOT LIKE '%freeswitch%')) THEN
      ALTER TABLE sip_accounts DROP CONSTRAINT sip_accounts_provider_check;
      ALTER TABLE sip_accounts
        ADD CONSTRAINT sip_accounts_provider_check CHECK (
          provider IN ('signalwire', 'telnyx', 'twilio', 'bitcall', 'freeswitch', 'custom')
        );
    END IF;
  END
  $repair$;
`;

/**
 * Applies the schema exactly once per process, and hands every caller the same
 * promise.
 *
 * Under SQLite this ran synchronously at import time, so the tables were
 * guaranteed to exist before the first query. Postgres is async, and a serverless
 * cold start imports modules before it handles a request, so the guarantee has to
 * be re-established explicitly: both entrypoints await this before serving.
 *
 * A failure clears the memo rather than caching the rejection. Otherwise one
 * transient connection error at cold start would poison the instance for its whole
 * lifetime, and every subsequent request would fail on a promise that had already
 * settled — with an error about a connection that no longer matters.
 */
let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = db.exec(SCHEMA).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export default db;
export { db };
