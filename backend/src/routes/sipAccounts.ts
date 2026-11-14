import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import db from "../db/database.js";
import {
  authMiddleware,
  requireProvisioned,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";

const router = Router();
router.use(authMiddleware, requireProvisioned);

const PROVIDERS = ["signalwire", "telnyx", "twilio", "custom"] as const;

const DEFAULT_STUN = ["stun:stun.l.google.com:19302"];

const accountSchema = z.object({
  label: z.string().trim().max(120).nullish(),
  provider: z.enum(PROVIDERS).default("custom"),
  sip_uri: z
    .string()
    .trim()
    .regex(/^sips?:[^@;\s]+@[^;\s]+$/i, "SIP URI must look like sip:extension@domain"),
  password: z.string().min(1, "A SIP password is required").max(200),
  // A browser page served over HTTPS cannot open an insecure ws:// socket, so
  // refusing it here beats a confusing transport failure in the field.
  ws_url: z
    .string()
    .trim()
    .regex(/^wss:\/\/[^\s]+$/i, "WebSocket URL must start with wss://"),
  caller_id: z.string().trim().max(40).nullish(),
  stun_urls: z.array(z.string().trim().min(1).max(200)).max(6).nullish(),
  register_expiry: z.number().int().min(60).max(3600).default(600),
  user_id: z.string().min(1).max(64).nullish(),
  enabled: z.boolean().default(true),
});

const accountUpdateSchema = accountSchema.partial();

function mapAccount(row: any) {
  return {
    id: row.id,
    user_id: row.user_id,
    label: row.label,
    provider: row.provider,
    sip_uri: row.sip_uri,
    password: row.password,
    ws_url: row.ws_url,
    caller_id: row.caller_id,
    stun_urls: row.stun_urls ? JSON.parse(row.stun_urls) : DEFAULT_STUN,
    register_expiry: row.register_expiry,
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * The account this agent dials with.
 *
 * A personal extension wins over the shared trunk default, because it is the one
 * a provider can block or bill individually. Mirrors the precedence the Supabase
 * client applies, so both deployment modes behave identically.
 */
router.get("/effective", (req: AuthRequest, res) => {
  const row =
    db
      .prepare(
        "SELECT * FROM sip_accounts WHERE enabled = 1 AND user_id = ? ORDER BY created_at LIMIT 1"
      )
      .get(req.userId) ??
    db
      .prepare(
        "SELECT * FROM sip_accounts WHERE enabled = 1 AND user_id IS NULL ORDER BY created_at LIMIT 1"
      )
      .get();

  res.json(row ? mapAccount(row) : null);
});

router.get("/", requireRole("admin"), (_req: AuthRequest, res) => {
  const rows = db.prepare("SELECT * FROM sip_accounts ORDER BY created_at").all() as any[];
  res.json(rows.map(mapAccount));
});

router.post("/", requireRole("admin"), (req: AuthRequest, res) => {
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid SIP account" });
    return;
  }
  const account = parsed.data;
  const id = uuid();
  const now = new Date().toISOString();

  try {
    db.prepare(
      `INSERT INTO sip_accounts
        (id, user_id, label, provider, sip_uri, password, ws_url, caller_id,
         stun_urls, register_expiry, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      account.user_id ?? null,
      account.label ?? null,
      account.provider,
      account.sip_uri,
      account.password,
      account.ws_url,
      account.caller_id ?? null,
      JSON.stringify(account.stun_urls ?? DEFAULT_STUN),
      account.register_expiry,
      account.enabled ? 1 : 0,
      now,
      now
    );
  } catch (error) {
    // The unique index on the owner column is what stops two trunk defaults, and
    // SQLite reports that as a constraint error rather than something to retry.
    res.status(409).json({
      error:
        String((error as Error).message).includes("UNIQUE")
          ? "That user already has a SIP account, or a shared trunk default already exists."
          : "Could not save the SIP account",
    });
    return;
  }

  const row = db.prepare("SELECT * FROM sip_accounts WHERE id = ?").get(id) as any;
  res.status(201).json(mapAccount(row));
});

router.patch("/:id", requireRole("admin"), (req: AuthRequest, res) => {
  const parsed = accountUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid SIP account" });
    return;
  }

  const existing = db.prepare("SELECT * FROM sip_accounts WHERE id = ?").get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: "SIP account not found" });
    return;
  }

  const updates = parsed.data;
  const columns: string[] = [];
  const values: unknown[] = [];

  if (updates.label !== undefined) {
    columns.push("label = ?");
    values.push(updates.label ?? null);
  }
  if (updates.provider !== undefined) {
    columns.push("provider = ?");
    values.push(updates.provider);
  }
  if (updates.sip_uri !== undefined) {
    columns.push("sip_uri = ?");
    values.push(updates.sip_uri);
  }
  if (updates.password !== undefined) {
    columns.push("password = ?");
    values.push(updates.password);
  }
  if (updates.ws_url !== undefined) {
    columns.push("ws_url = ?");
    values.push(updates.ws_url);
  }
  if (updates.caller_id !== undefined) {
    columns.push("caller_id = ?");
    values.push(updates.caller_id ?? null);
  }
  if (updates.stun_urls !== undefined) {
    columns.push("stun_urls = ?");
    values.push(JSON.stringify(updates.stun_urls ?? DEFAULT_STUN));
  }
  if (updates.register_expiry !== undefined) {
    columns.push("register_expiry = ?");
    values.push(updates.register_expiry);
  }
  if (updates.user_id !== undefined) {
    columns.push("user_id = ?");
    values.push(updates.user_id ?? null);
  }
  if (updates.enabled !== undefined) {
    columns.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }

  if (columns.length > 0) {
    columns.push("updated_at = ?");
    values.push(new Date().toISOString(), req.params.id);
    db.prepare(`UPDATE sip_accounts SET ${columns.join(", ")} WHERE id = ?`).run(...values);
  }

  const row = db.prepare("SELECT * FROM sip_accounts WHERE id = ?").get(req.params.id) as any;
  res.json(mapAccount(row));
});

router.delete("/:id", requireRole("admin"), (req: AuthRequest, res) => {
  const result = db.prepare("DELETE FROM sip_accounts WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "SIP account not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
