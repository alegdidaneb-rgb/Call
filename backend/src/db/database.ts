import Database, { type Database as DatabaseType } from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

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

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent', 'manager')),
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

  if (!columnExists("leads", "created_by")) {
    db.exec("ALTER TABLE leads ADD COLUMN created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL");
    db.exec("CREATE INDEX IF NOT EXISTS idx_leads_created_by ON leads(created_by)");
  }

  // Pre-existing rows may duplicate emails; the UNIQUE index only applies to new tables.
  const emailIndexes = db
    .prepare("PRAGMA index_list(profiles)")
    .all() as { name: string; unique: number }[];
  const hasUniqueEmail = emailIndexes.some((i) => i.unique === 1);
  if (!hasUniqueEmail) {
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
}

migrate();

export default db;
export { DB_PATH };
