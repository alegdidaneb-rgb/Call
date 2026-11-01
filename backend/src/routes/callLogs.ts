import { Router } from "express";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import db from "../db/database.js";
import { authMiddleware, isAdmin, type AuthRequest } from "../middleware/auth.js";

const router = Router();
router.use(authMiddleware);

const callLogSchema = z.object({
  lead_id: z.string().uuid().nullish(),
  campaign_id: z.string().uuid().nullish(),
  direction: z.enum(["outbound", "inbound"]).nullish(),
  outcome: z.enum(
    ["no_answer", "answered", "busy", "voicemail", "dnc", "wrong_number", "disconnected"],
    { message: "outcome is required and must be a valid call outcome" }
  ),
  duration_seconds: z.number().int().min(0).max(86_400).nullish(),
  recording_url: z.string().trim().max(2000).nullish(),
  notes: z.string().trim().max(5000).nullish(),
  transcript: z.string().trim().max(50_000).nullish(),
  sip_call_id: z.string().trim().max(200).nullish(),
  started_at: z.string().trim().max(40).nullish(),
  ended_at: z.string().trim().max(40).nullish(),
});

function mapCallLog(row: any) {
  return {
    id: row.id,
    lead_id: row.lead_id,
    user_id: row.user_id,
    campaign_id: row.campaign_id,
    direction: row.direction,
    outcome: row.outcome,
    duration_seconds: row.duration_seconds,
    recording_url: row.recording_url,
    notes: row.notes,
    transcript: row.transcript,
    sip_call_id: row.sip_call_id,
    started_at: row.started_at,
    ended_at: row.ended_at,
    created_at: row.created_at,
  };
}

/**
 * Call logs are personal activity records: an agent sees their own, admins and
 * managers see the whole team's. Previously every user saw every log.
 */
function scope(req: AuthRequest): { sql: string; params: unknown[] } {
  if (isAdmin(req) || req.userRole === "manager") {
    return { sql: "1 = 1", params: [] };
  }
  return { sql: "user_id = ?", params: [req.userId] };
}

router.get("/", (req: AuthRequest, res) => {
  const { sql, params } = scope(req);
  const rows = db
    .prepare(`SELECT * FROM call_logs WHERE ${sql} ORDER BY created_at DESC LIMIT 1000`)
    .all(...params) as any[];
  res.json(rows.map(mapCallLog));
});

router.get("/lead/:leadId", (req: AuthRequest, res) => {
  const { sql, params } = scope(req);
  const rows = db
    .prepare(
      `SELECT * FROM call_logs WHERE lead_id = ? AND ${sql} ORDER BY created_at DESC LIMIT 500`
    )
    .all(req.params.leadId, ...params) as any[];
  res.json(rows.map(mapCallLog));
});

router.get("/:id", (req: AuthRequest, res) => {
  const { sql, params } = scope(req);
  const row = db
    .prepare(`SELECT * FROM call_logs WHERE id = ? AND ${sql}`)
    .get(req.params.id, ...params) as any;
  if (!row) {
    res.status(404).json({ error: "Call log not found" });
    return;
  }
  res.json(mapCallLog(row));
});

router.post("/", (req: AuthRequest, res) => {
  const parsed = callLogSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid call log payload" });
    return;
  }
  const log = parsed.data;

  const id = uuid();

  // `user_id` is always taken from the authenticated session. Accepting it from
  // the request body let a caller attribute logs to any other user.
  db.prepare(
    `INSERT INTO call_logs (id, lead_id, user_id, campaign_id, direction, outcome, duration_seconds, recording_url, notes, transcript, sip_call_id, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    log.lead_id ?? null,
    req.userId ?? null,
    log.campaign_id ?? null,
    log.direction ?? "outbound",
    log.outcome,
    log.duration_seconds ?? 0,
    log.recording_url ?? null,
    log.notes ?? null,
    log.transcript ?? null,
    log.sip_call_id ?? null,
    log.started_at ?? null,
    log.ended_at ?? null
  );

  if (log.lead_id) {
    db.prepare(
      "UPDATE leads SET last_called_at = datetime('now'), call_count = call_count + 1, updated_at = datetime('now') WHERE id = ?"
    ).run(log.lead_id);
  }

  const row = db.prepare("SELECT * FROM call_logs WHERE id = ?").get(id) as any;
  res.status(201).json(mapCallLog(row));
});

router.delete("/:id", (req: AuthRequest, res) => {
  const existing = db.prepare("SELECT * FROM call_logs WHERE id = ?").get(req.params.id) as any;
  if (!existing) {
    res.status(404).json({ error: "Call log not found" });
    return;
  }
  if (!isAdmin(req) && existing.user_id !== req.userId) {
    res.status(403).json({ error: "You can only delete your own call logs" });
    return;
  }
  db.prepare("DELETE FROM call_logs WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

export default router;
