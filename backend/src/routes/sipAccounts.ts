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

const PROVIDERS = ["signalwire", "telnyx", "twilio", "bitcall", "custom"] as const;

const DEFAULT_STUN = ["stun:stun.l.google.com:19302"];

/**
 * A TURN URL, matching the pattern the browser enforces in `sip/config.ts`.
 *
 * Checked here too because a malformed relay address does not fail at save time: it
 * fails during ICE gathering, in a browser, on a call, as silence. Rejecting it at
 * the API is the last point where the person who typed it is still looking at it.
 */
const TURN_URL = /^(?:turns?):(?:\/\/)?[^\s/?:]+(?::\d{1,5})?(?:\?transport=(?:tcp|udp))?$/i;

/**
 * The message for a half-configured relay, shared by both write routes.
 *
 * The pairing itself is enforced by the `sip_accounts_turn_credential_pairs` check
 * constraint rather than duplicated in a validator: an update can supply one of the
 * two without the other and still be individually valid, so the rule is about the
 * resulting row, and only the database sees that atomically.
 */
const TURN_PAIRING_ERROR =
  "TURN servers need both a username and a credential. A relay refuses an unauthenticated allocation and the browser falls back to a direct connection, which looks configured and sounds like nothing.";

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
  turn_urls: z
    .array(z.string().trim().min(1).max(200).regex(TURN_URL, "TURN servers look like turn:host:3478"))
    .max(6)
    .nullish(),
  turn_username: z.string().trim().max(200).nullish(),
  // Plaintext for the same reason the SIP password is: the browser has to send it
  // to the relay. Documented in SECURITY.md rather than hashed into uselessness.
  turn_credential: z.string().trim().max(200).nullish(),
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
    turn_urls: row.turn_urls ? JSON.parse(row.turn_urls) : [],
    turn_username: row.turn_username ?? null,
    turn_credential: row.turn_credential ?? null,
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
router.get("/effective", async (req: AuthRequest, res) => {
  const row =
    await db
      .prepare(
        "SELECT * FROM sip_accounts WHERE enabled = 1 AND user_id = ? ORDER BY created_at LIMIT 1"
      )
      .get(req.userId) ??
    await db
      .prepare(
        "SELECT * FROM sip_accounts WHERE enabled = 1 AND user_id IS NULL ORDER BY created_at LIMIT 1"
      )
      .get();

  res.json(row ? mapAccount(row) : null);
});

router.get("/", requireRole("admin"), async (_req: AuthRequest, res) => {
  const rows = await db.prepare("SELECT * FROM sip_accounts ORDER BY created_at").all() as any[];
  res.json(rows.map(mapAccount));
});

router.post("/", requireRole("admin"), async (req: AuthRequest, res) => {
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid SIP account" });
    return;
  }
  const account = parsed.data;
  const id = uuid();
  const now = new Date().toISOString();

  try {
    await db.prepare(
      `INSERT INTO sip_accounts
        (id, user_id, label, provider, sip_uri, password, ws_url, caller_id,
         stun_urls, turn_urls, turn_username, turn_credential,
         register_expiry, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      JSON.stringify(account.turn_urls ?? []),
      account.turn_username ?? null,
      account.turn_credential ?? null,
      account.register_expiry,
      account.enabled ? 1 : 0,
      now,
      now
    );
  } catch (error) {
    // The unique index on the owner column is what stops two trunk defaults. This
    // matched "UNIQUE" while the database was SQLite; Postgres words it "duplicate
    // key value violates unique constraint", so the readable message had quietly
    // stopped being returned. Matched on the SQLSTATE, which does not depend on
    // wording at all, with the text as a fallback.
    const message = String((error as Error).message);
    const code = (error as { code?: string }).code;
    if (code === "23505" || /unique/i.test(message)) {
      res.status(409).json({
        error: "That user already has a SIP account, or a shared trunk default already exists.",
      });
      return;
    }
    if (code === "23514" && message.includes("sip_accounts_turn_credential_pairs")) {
      res.status(400).json({ error: TURN_PAIRING_ERROR });
      return;
    }
    res.status(409).json({ error: "Could not save the SIP account" });
    return;
  }

  const row = await db.prepare("SELECT * FROM sip_accounts WHERE id = ?").get(id) as any;
  res.status(201).json(mapAccount(row));
});

router.patch("/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  const parsed = accountUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid SIP account" });
    return;
  }

  const existing = await db.prepare("SELECT * FROM sip_accounts WHERE id = ?").get(req.params.id) as any;
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
  if (updates.turn_urls !== undefined) {
    columns.push("turn_urls = ?");
    values.push(JSON.stringify(updates.turn_urls ?? []));
  }
  if (updates.turn_username !== undefined) {
    columns.push("turn_username = ?");
    values.push(updates.turn_username ?? null);
  }
  if (updates.turn_credential !== undefined) {
    columns.push("turn_credential = ?");
    values.push(updates.turn_credential ?? null);
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
    try {
      await db.prepare(`UPDATE sip_accounts SET ${columns.join(", ")} WHERE id = ?`).run(...values);
    } catch (error) {
      // Clearing one of the TURN fields while leaving the other is the reachable
      // case here: an operator removes the credential, the pairing constraint
      // refuses the row, and without this the refusal arrived as a 500 from the
      // global handler with a Postgres message in it.
      const message = String((error as Error).message);
      const code = (error as { code?: string }).code;
      if (code === "23514" && message.includes("sip_accounts_turn_credential_pairs")) {
        res.status(400).json({ error: TURN_PAIRING_ERROR });
        return;
      }
      throw error;
    }
  }

  const row = await db.prepare("SELECT * FROM sip_accounts WHERE id = ?").get(req.params.id) as any;
  res.json(mapAccount(row));
});

router.delete("/:id", requireRole("admin"), async (req: AuthRequest, res) => {
  const result = await db.prepare("DELETE FROM sip_accounts WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "SIP account not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
