import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import db from "../db/database.js";
import { withTransaction } from "../db/pool.js";
import { authMiddleware, requireProvisioned, requireRole, isAdmin, type AuthRequest } from "../middleware/auth.js";
import { MAX_IMPORT_ROWS } from "../config/env.js";

const router = Router();
router.use(authMiddleware, requireProvisioned);

const LEAD_STATUSES = [
  "new",
  "contacted",
  "interested",
  "not_interested",
  "callback",
  "converted",
  "do_not_contact",
] as const;

const optionalString = (max = 500) => z.string().trim().max(max).nullish();

/**
 * ISO 3166-1 alpha-2 country code.
 *
 * Accepts the shapes a CSV or a hand-typed form produces ("us", " US ", "") and
 * normalises them, mirroring the `normalize_lead_country` trigger on the
 * Supabase side so both backends store the same thing. The two-letter format is
 * enforced here because SQLite has no CHECK constraint for it.
 */
const optionalCountry = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim().toUpperCase();
    return text === "" ? null : text;
  })
  .refine((value) => value === null || /^[A-Z]{2}$/.test(value), {
    message: "Country must be a two-letter ISO 3166-1 code",
  });

const leadCreateSchema = z.object({
  first_name: optionalString(120),
  last_name: optionalString(120),
  company: optionalString(200),
  phone: optionalString(40),
  email: z.string().trim().toLowerCase().email().max(254).nullish(),
  website: optionalString(300),
  address: optionalString(300),
  city: optionalString(120),
  state: optionalString(120),
  zip: optionalString(20),
  country: optionalCountry,
  status: z.enum(LEAD_STATUSES).nullish(),
  source: optionalString(120),
  campaign_id: z.string().uuid().nullish(),
  assigned_to: z.string().uuid().nullish(),
  tags: z.array(z.string().trim().max(60)).max(50).nullish(),
  notes: optionalString(5000),
  dnc: z.boolean().nullish(),
});

const leadUpdateSchema = leadCreateSchema
  .extend({
    last_called_at: optionalString(40),
    call_count: z.number().int().min(0).max(1_000_000).nullish(),
  })
  .partial();

/**
 * Agents may see leads assigned to them, leads they created, and unassigned
 * leads (the claimable pool). Admins and managers see everything.
 *
 * Previously every route ran an unscoped `SELECT * FROM leads`, so any
 * authenticated user could read and mutate the whole tenant's data.
 */
function visibilityClause(req: AuthRequest): { sql: string; params: unknown[] } {
  if (isAdmin(req) || req.userRole === "manager") {
    return { sql: "1 = 1", params: [] };
  }
  return {
    sql: "(assigned_to = ? OR created_by = ? OR assigned_to IS NULL)",
    params: [req.userId, req.userId],
  };
}

function canMutate(req: AuthRequest, row: { assigned_to: string | null }): boolean {
  if (isAdmin(req) || req.userRole === "manager") return true;
  if (!row.assigned_to) return true; // unassigned leads are claimable
  return row.assigned_to === req.userId;
}

function mapLead(row: any) {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    company: row.company,
    phone: row.phone,
    email: row.email,
    website: row.website,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    country: row.country,
    status: row.status,
    source: row.source,
    campaign_id: row.campaign_id,
    assigned_to: row.assigned_to,
    created_by: row.created_by,
    tags: row.tags ? JSON.parse(row.tags) : null,
    notes: row.notes,
    dnc: Boolean(row.dnc),
    last_called_at: row.last_called_at,
    call_count: row.call_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

router.get("/", async (req: AuthRequest, res) => {
  const { sql, params } = visibilityClause(req);
  const rows = await db
    .prepare(`SELECT * FROM leads WHERE ${sql} ORDER BY created_at DESC LIMIT 1000`)
    .all(...params) as any[];
  res.json(rows.map(mapLead));
});

router.get("/:id", async (req: AuthRequest, res) => {
  const row = await db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id) as any;
  if (!row) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const { sql, params } = visibilityClause(req);
  const visible = await db
    .prepare(`SELECT 1 FROM leads WHERE id = ? AND ${sql}`)
    .get(req.params.id, ...params);
  if (!visible) {
    // 404 rather than 403 so that existence of another team's lead is not leaked.
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.json(mapLead(row));
});

router.post("/", async (req: AuthRequest, res) => {
  const parsed = leadCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid lead payload" });
    return;
  }
  const lead = parsed.data;

  // Non-admins may only assign a lead to themselves, preventing an agent from
  // writing leads into another agent's queue.
  const assignedTo =
    isAdmin(req) || req.userRole === "manager" ? (lead.assigned_to ?? req.userId) : req.userId;

  const id = uuid();
  const now = new Date().toISOString();

  try {
    await db.prepare(
      `INSERT INTO leads (id, first_name, last_name, company, phone, email, website, address, city, state, zip, country, status, source, campaign_id, assigned_to, created_by, tags, notes, dnc, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      lead.first_name ?? null,
      lead.last_name ?? null,
      lead.company ?? null,
      lead.phone ?? null,
      lead.email ?? null,
      lead.website ?? null,
      lead.address ?? null,
      lead.city ?? null,
      lead.state ?? null,
      lead.zip ?? null,
      lead.country ?? null,
      lead.status ?? "new",
      lead.source ?? null,
      lead.campaign_id ?? null,
      assignedTo,
      req.userId ?? null,
      lead.tags ? JSON.stringify(lead.tags) : null,
      lead.notes ?? null,
      lead.dnc ? 1 : 0,
      now,
      now
    );
  } catch (err) {
    console.error("[leads] create failed:", err);
    res.status(400).json({ error: "Unable to create lead" });
    return;
  }

  const row = await db.prepare("SELECT * FROM leads WHERE id = ?").get(id) as any;
  res.status(201).json(mapLead(row));
});

router.patch("/:id", async (req: AuthRequest, res) => {
  const existing = await db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  if (!canMutate(req, existing)) {
    res.status(403).json({ error: "You do not have access to this lead" });
    return;
  }

  const parsed = leadUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid lead payload" });
    return;
  }

  // Column names come from this fixed allowlist, never from the request body.
  const fields = [
    "first_name", "last_name", "company", "phone", "email", "website",
    "address", "city", "state", "zip", "country", "status", "source", "campaign_id",
    "assigned_to", "tags", "notes", "dnc", "last_called_at", "call_count",
  ] as const;

  const updates: string[] = [];
  const values: unknown[] = [];
  const body = parsed.data as Record<string, unknown>;

  for (const field of fields) {
    if (body[field] === undefined) continue;
    let value = body[field];
    if (field === "tags") value = value === null ? null : JSON.stringify(value);
    if (field === "dnc") value = value ? 1 : 0;
    // Only privileged roles may reassign a lead to someone else.
    if (field === "assigned_to" && value !== null && !isAdmin(req) && req.userRole !== "manager") {
      if (value !== req.userId) {
        res.status(403).json({ error: "Only an admin or manager can reassign a lead" });
        return;
      }
    }
    updates.push(`${field} = ?`);
    values.push(value);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  updates.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(req.params.id);

  try {
    await db.prepare(`UPDATE leads SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  } catch (err) {
    console.error("[leads] update failed:", err);
    res.status(400).json({ error: "Unable to update lead" });
    return;
  }

  const row = await db.prepare("SELECT * FROM leads WHERE id = ?").get(req.params.id) as any;
  res.json(mapLead(row));
});

router.delete("/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  const existing = await db.prepare("SELECT id FROM leads WHERE id = ?").get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  await db.prepare("DELETE FROM leads WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

const importRowSchema = z.object({
  first_name: optionalString(120),
  last_name: optionalString(120),
  company: optionalString(200),
  phone: optionalString(40),
  email: z.string().trim().toLowerCase().max(254).nullish(),
  website: optionalString(300),
  address: optionalString(300),
  city: optionalString(120),
  state: optionalString(120),
  zip: optionalString(20),
  country: optionalCountry,
  status: z.enum(LEAD_STATUSES).nullish(),
  source: optionalString(120),
});

const importSchema = z.object({
  rows: z.array(importRowSchema).min(1),
  campaign_id: z.string().uuid().nullish(),
});

router.post("/import", async (req: AuthRequest, res) => {
  // Length is checked explicitly rather than via schema issue codes, so the
  // limit message does not depend on the validation library's internals.
  const rawRows = (req.body as { rows?: unknown } | undefined)?.rows;
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    res.status(400).json({ error: "No rows to import" });
    return;
  }
  if (rawRows.length > MAX_IMPORT_ROWS) {
    res.status(400).json({
      error: `Import is limited to ${MAX_IMPORT_ROWS} rows per request (received ${rawRows.length})`,
    });
    return;
  }

  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid import payload",
      details: parsed.error.issues.slice(0, 10),
    });
    return;
  }

  const { rows, campaign_id } = parsed.data;

  const INSERT_SQL = `INSERT INTO leads (id, first_name, last_name, company, phone, email, website, address, city, state, zip, country, status, source, campaign_id, assigned_to, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())`;

  /**
   * Per-row failures are collected and reported instead of being swallowed by an
   * empty catch block, which previously returned a success response while silently
   * dropping rows.
   *
   * Each row gets its own SAVEPOINT, and this is not a stylistic choice. In
   * Postgres a statement that fails aborts the *whole* transaction, and every
   * later statement is rejected with "current transaction is aborted" until it is
   * rolled back. The SQLite version of this loop could catch a per-row error and
   * carry on; ported naively, one malformed row would have poisoned the rest of
   * the import and reported hundreds of bogus failures. Rolling back to the
   * savepoint clears the error and leaves the rows that did succeed intact.
   */
  const result = await withTransaction(async (tx) => {
    const errors: { row: number; reason: string }[] = [];
    let imported = 0;
    // Set when the transaction itself becomes unusable, which is a different
    // situation from one row being rejected. See the catch block below.
    let fatal: unknown = null;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      // Numeric suffix, so the identifier cannot carry anything from the payload.
      const savepoint = `sp_${index}`;
      await tx.exec(`SAVEPOINT ${savepoint}`);
      try {
        await tx.prepare(INSERT_SQL).run(
          uuid(),
          row.first_name ?? null,
          row.last_name ?? null,
          row.company ?? null,
          row.phone ?? null,
          row.email ?? null,
          row.website ?? null,
          row.address ?? null,
          row.city ?? null,
          row.state ?? null,
          row.zip ?? null,
          row.country ?? null,
          row.status ?? "new",
          row.source ?? "import",
          campaign_id ?? null,
          req.userId ?? null,
          req.userId ?? null
        );
        await tx.exec(`RELEASE SAVEPOINT ${savepoint}`);
        imported += 1;
      } catch (err) {
        /**
         * Restoring the savepoint is what clears the aborted-transaction state, so
         * if *that* fails the transaction cannot carry another statement. Carrying
         * on would produce one "current transaction is aborted" error per remaining
         * row — the wall of meaningless failures the savepoints exist to prevent,
         * burying the real cause under hundreds of copies of itself. Stop instead
         * and let the outer rollback surface the original error.
         */
        try {
          await tx.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        } catch {
          fatal = err;
          break;
        }
        errors.push({
          row: index + 1,
          reason: err instanceof Error ? err.message : "Insert failed",
        });
      }
    }

    if (fatal) throw fatal;

    return { imported, errors };
  });
  res.json({
    imported: result.imported,
    failed: result.errors.length,
    total: rows.length,
    errors: result.errors.slice(0, 20),
  });
});

export default router;
