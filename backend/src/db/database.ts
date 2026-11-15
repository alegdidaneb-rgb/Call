import Database, { type Database as DatabaseType } from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { usernameFromEmail } from "../lib/username.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, "../../data");
const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(DATA_DIR, "cold-dialer.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db: DatabaseType = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// `profiles.username` is what an account signs in with. It is declared here
// without a constraint and enforced by the unique index in migrate(), so a fresh
// database and one upgraded by ALTER TABLE end up with identical rules instead of
// two subtly different schemas.
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    username TEXT,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent', 'manager')),
    invited_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'outbound' CHECK (type IN ('outbound', 'inbound', 'blended')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
    settings TEXT,
    created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    company TEXT,
    phone TEXT,
    email TEXT,
    website TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    country TEXT,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'interested', 'not_interested', 'callback', 'converted', 'do_not_contact')),
    source TEXT,
    campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
    assigned_to TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    tags TEXT,
    notes TEXT,
    dnc INTEGER NOT NULL DEFAULT 0,
    last_called_at TEXT,
    call_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS call_scripts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT,
    content TEXT,
    objection_responses TEXT,
    campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
    created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS call_logs (
    id TEXT PRIMARY KEY,
    lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
    direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
    outcome TEXT NOT NULL CHECK (outcome IN ('no_answer', 'answered', 'busy', 'voicemail', 'dnc', 'wrong_number', 'disconnected')),
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    recording_url TEXT,
    notes TEXT,
    transcript TEXT,
    sip_call_id TEXT,
    started_at TEXT,
    ended_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    scheduled_at TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    type TEXT NOT NULL CHECK (type IN ('sales_call', 'demo', 'follow_up', 'consultation', 'check_in')),
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'rescheduled')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS dnc_list (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    reason TEXT,
    source TEXT,
    created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sip_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
    label TEXT,
    provider TEXT NOT NULL DEFAULT 'custom'
      CHECK (provider IN ('signalwire', 'telnyx', 'twilio', 'custom')),
    sip_uri TEXT NOT NULL,
    password TEXT NOT NULL,
    ws_url TEXT NOT NULL,
    caller_id TEXT,
    stun_urls TEXT NOT NULL DEFAULT '["stun:stun.l.google.com:19302"]',
    register_expiry INTEGER NOT NULL DEFAULT 600 CHECK (register_expiry BETWEEN 60 AND 3600),
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
  CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads(assigned_to);
  CREATE INDEX IF NOT EXISTS idx_leads_created_by ON leads(created_by);
  CREATE INDEX IF NOT EXISTS idx_call_logs_lead ON call_logs(lead_id);
  CREATE INDEX IF NOT EXISTS idx_call_logs_user ON call_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_appointments_lead ON appointments(lead_id);
  CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(user_id);
  CREATE INDEX IF NOT EXISTS idx_dnc_phone ON dnc_list(phone);
  -- One account per owner, and only one shared trunk default (user_id NULL).
  -- SQLite treats NULLs as distinct in a plain unique index, so the sentinel
  -- value is what makes "at most one trunk default" enforceable.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sip_accounts_owner
    ON sip_accounts(COALESCE(user_id, '__trunk_default__'));
`);

/**
 * Additive migrations for databases created by earlier revisions of this file.
 *
 * `CREATE TABLE IF NOT EXISTS` never alters an existing table, so columns added
 * above (notably `password_hash`, without which login cannot verify a password)
 * must be backfilled here.
 */
function columnExists(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

function migrate(): void {
  if (!columnExists("profiles", "password_hash")) {
    db.exec("ALTER TABLE profiles ADD COLUMN password_hash TEXT");
    console.warn(
      "[db] Added missing profiles.password_hash column. Existing accounts have no stored " +
        "password and must be re-registered or have a hash set manually."
    );
  }

  if (!columnExists("profiles", "invited_by")) {
    db.exec(
      "ALTER TABLE profiles ADD COLUMN invited_by TEXT REFERENCES profiles(id) ON DELETE SET NULL"
    );
    db.exec("CREATE INDEX IF NOT EXISTS idx_profiles_invited_by ON profiles(invited_by)");
    // Accounts that predate provisioning were created before it was tracked.
    // Adopt them under the first admin rather than locking out a live team, and
    // let privileged accounts stand on their own role.
    db.exec(
      "UPDATE profiles SET invited_by = (SELECT id FROM profiles WHERE role = 'admin' " +
        "ORDER BY created_at LIMIT 1) WHERE invited_by IS NULL AND role = 'agent'"
    );
    db.exec(
      "UPDATE profiles SET invited_by = id WHERE invited_by IS NULL AND role IN ('admin','manager')"
    );
    console.warn(
      "[db] Added missing profiles.invited_by column. Accounts are now provisioned " +
        "explicitly; unprovisioned agents have no data access."
    );
  }

  if (!columnExists("leads", "country")) {
    db.exec("ALTER TABLE leads ADD COLUMN country TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_leads_country ON leads(country)");
    // Existing rows stay NULL on purpose: dialling codes are shared ("+1"
    // covers 26 countries), so inferring a country from a stored phone number
    // would write guesses into a compliance field.
  }

  if (!columnExists("leads", "created_by")) {
    db.exec("ALTER TABLE leads ADD COLUMN created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL");
    db.exec("CREATE INDEX IF NOT EXISTS idx_leads_created_by ON leads(created_by)");
  }

  // Accounts are addressed by username, so it has to exist on every row before
  // the unique index can be built.
  if (!columnExists("profiles", "username")) {
    db.exec("ALTER TABLE profiles ADD COLUMN username TEXT");
    console.warn("[db] Added missing profiles.username column; deriving one for every account.");
  }

  backfillUsernames();

  // Pre-existing rows may duplicate emails; the UNIQUE index only applies to new tables.
  if (!hasUniqueIndexOn("profiles", "email")) {
    try {
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email)");
    } catch (err) {
      console.warn(
        `[db] Could not enforce unique emails on profiles: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // Case-insensitive, matching the Postgres deployment's `lower(username)` index:
  // `Marco` and `marco` must not be two accounts.
  if (!hasUniqueIndexOn("profiles", "lower(username)")) {
    try {
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username ON profiles(lower(username))");
    } catch (err) {
      console.warn(
        `[db] Could not enforce unique usernames on profiles: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

/**
 * True when some unique index on `table` covers exactly `expression`.
 *
 * Checks the indexed expression rather than "does any unique index exist": the
 * previous version of this test did the latter, and would have stopped enforcing
 * unique emails as soon as any other unique index was added to the table.
 */
function hasUniqueIndexOn(table: string, expression: string): boolean {
  const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as {
    name: string;
    unique: number;
  }[];
  const wanted = expression.toLowerCase().replace(/\s+/g, "");
  return indexes.some((index) => {
    if (index.unique !== 1) return false;
    const columns = db.prepare(`PRAGMA index_info(${index.name})`).all() as {
      name: string | null;
    }[];
    if (columns.length !== 1) return false;
    // `name` is null for an expression index; its text only appears in the DDL.
    const direct = columns[0]?.name?.toLowerCase();
    if (direct) return direct === wanted;
    const ddl = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(index.name) as { sql: string | null } | undefined;
    return (ddl?.sql ?? "").toLowerCase().replace(/\s+/g, "").includes(`(${wanted})`);
  });
}

/**
 * Give every row without a username one derived from its stored email.
 *
 * Mirrors `public.derive_username` in migration 005, including collision
 * avoidance: an address is not guaranteed to produce a name that is free, and
 * failing here would leave the unique index unbuildable and the deployment unable
 * to sign in at all.
 */
function backfillUsernames(): void {
  const rows = db
    .prepare("SELECT id, email, username FROM profiles")
    .all() as { id: string; email: string | null; username: string | null }[];

  const taken = new Set(
    rows.map((r) => r.username?.toLowerCase()).filter((u): u is string => Boolean(u))
  );

  const update = db.prepare("UPDATE profiles SET username = ? WHERE id = ?");
  let backfilled = 0;

  for (const row of rows) {
    if (row.username) continue;

    const base = usernameFromEmail(row.email) ?? "user";
    let candidate = base;
    let n = 1;
    while (taken.has(candidate)) {
      n += 1;
      candidate = `${base}${n}`;
    }
    taken.add(candidate);
    update.run(candidate, row.id);
    backfilled += 1;
  }

  if (backfilled > 0) {
    console.warn(
      `[db] Derived usernames for ${backfilled} existing account(s). Sign-in now accepts a ` +
        "username; a stored email is still accepted so nobody is locked out."
    );
  }
}

migrate();

export default db;
export { DB_PATH };
