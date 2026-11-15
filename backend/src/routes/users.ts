import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import db from "../db/database.js";
import { authMiddleware, requireRole, type AuthRequest } from "../middleware/auth.js";
import { BCRYPT_ROUNDS } from "../config/env.js";
import {
  normaliseUsername,
  syntheticEmail,
  usernameProblem,
} from "../lib/username.js";

/**
 * Account management. Administrator-only.
 *
 * This is the self-hosted counterpart of the `admin-users` Supabase edge
 * function: public signup does not exist, and an account only comes into being
 * because an administrator created it. `invited_by` records who, and is what
 * makes the account provisioned -- without it `requireProvisioned` keeps the
 * account away from every data route.
 */

const router = Router();

router.use(authMiddleware, requireRole("admin"));

const ROLES = ["admin", "manager", "agent"] as const;

/** Validated by `lib/username`, the copy that must match migration 005. */
const usernameField = z
  .string()
  .superRefine((value, context) => {
    const problem = usernameProblem(value);
    if (problem) context.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  })
  .transform(normaliseUsername);

/**
 * The password rule, in one place for this file.
 *
 * It is duplicated by `routes/auth.ts` (bootstrap) and by the client's
 * `lib/passwordPolicy.ts`, which is the same three-copy drift this project has
 * already been bitten by; at least within a single file it should not be written
 * twice.
 */
const passwordField = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200, "Password is too long")
  .regex(/[a-zA-Z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

const createUserSchema = z.object({
  username: usernameField,
  password: passwordField,
  fullName: z.string().trim().min(1).max(120).optional().nullable(),
  role: z.enum(ROLES).default("agent"),
});

const resetPasswordSchema = z.object({ password: passwordField });

interface ProfileRow {
  id: string;
  username: string | null;
  email: string;
  full_name: string | null;
  role: string;
  invited_by: string | null;
  created_at: string | null;
}

function isProvisioned(row: { role: string; invited_by: string | null }): boolean {
  return row.role === "admin" || row.role === "manager" || row.invited_by !== null;
}

function publicUser(row: ProfileRow) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    provisioned: isProvisioned(row),
    createdAt: row.created_at,
  };
}

router.get("/", (_req: AuthRequest, res) => {
  try {
    const rows = db
      .prepare(
        "SELECT id, username, email, full_name, role, invited_by, created_at " +
          "FROM profiles ORDER BY created_at ASC"
      )
      .all() as ProfileRow[];
    res.json(rows.map(publicUser));
  } catch (err) {
    console.error("[users] list failed:", err);
    res.status(500).json({ error: "Unable to list accounts" });
  }
});

router.post("/", async (req: AuthRequest, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }
  const { username, password, fullName, role } = parsed.data;

  try {
    const existing = db
      .prepare("SELECT id FROM profiles WHERE lower(username) = lower(?)")
      .get(username);
    if (existing) {
      // Not "an account with that email": two people at two companies who are both
      // called Marco collide on the username, and the address is never shown, so
      // naming it would be a message about something the administrator never typed.
      res.status(409).json({ error: "That username is already taken" });
      return;
    }

    const id = uuid();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // `invited_by` is the acting administrator, so the new account is
    // provisioned from the moment it exists. The email column is NOT NULL and
    // predates usernames, so it holds a derived address that is never mailed.
    db.prepare(
      "INSERT INTO profiles (id, username, email, full_name, password_hash, role, invited_by) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      id,
      username,
      syntheticEmail(username),
      fullName ?? username,
      passwordHash,
      role,
      req.userId!
    );

    const row = db
      .prepare(
        "SELECT id, username, email, full_name, role, invited_by, created_at " +
          "FROM profiles WHERE id = ?"
      )
      .get(id) as ProfileRow;

    res.status(201).json({ user: publicUser(row) });
  } catch (err) {
    console.error("[users] create failed:", err);
    res.status(500).json({ error: "Unable to create the account" });
  }
});

/**
 * An administrator sets a new password for any account.
 *
 * This endpoint is not a convenience: accounts are addressed by username and the
 * stored address receives no mail, so there is no self-service recovery and a
 * forgotten password would otherwise be permanent. The only alternative would be
 * deleting and recreating the account, which loses every lead, call log and
 * appointment attributed to it.
 *
 * Two limits worth stating rather than hiding:
 *   - An administrator can reset another administrator's password, and so act as
 *     them. Every caller here already has full authority over all data, so this
 *     grants no new reach, but it does defeat per-account attribution.
 *   - Sessions already issued to the old password keep working until their token
 *     expires. Invalidating them is not something this schema can do; if an
 *     account is suspected compromised, deleting it is the only complete remedy.
 */
router.post("/:id/password", async (req: AuthRequest, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }

  try {
    const target = db
      .prepare("SELECT id, username FROM profiles WHERE id = ?")
      .get(req.params.id) as { id: string; username: string | null } | undefined;
    if (!target) {
      res.status(404).json({ error: "No such account" });
      return;
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
    db.prepare("UPDATE profiles SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
      passwordHash,
      target.id
    );

    res.json({ user: { id: target.id, username: target.username, passwordChanged: true } });
  } catch (err) {
    console.error("[users] password reset failed:", err);
    res.status(500).json({ error: "Unable to set that password" });
  }
});

export default router;
