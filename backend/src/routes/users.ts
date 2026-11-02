import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import db from "../db/database.js";
import { authMiddleware, requireRole, type AuthRequest } from "../middleware/auth.js";
import { BCRYPT_ROUNDS } from "../config/env.js";

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

const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email address is required"),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(200, "Password is too long")
    .regex(/[a-zA-Z]/, "Password must contain a letter")
    .regex(/[0-9]/, "Password must contain a number"),
  fullName: z.string().trim().min(1).max(120).optional().nullable(),
  role: z.enum(ROLES).default("agent"),
});

interface ProfileRow {
  id: string;
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
        "SELECT id, email, full_name, role, invited_by, created_at FROM profiles ORDER BY created_at ASC"
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
  const { email, password, fullName, role } = parsed.data;

  try {
    const existing = db.prepare("SELECT id FROM profiles WHERE email = ?").get(email);
    if (existing) {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }

    const id = uuid();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // `invited_by` is the acting administrator, so the new account is
    // provisioned from the moment it exists.
    db.prepare(
      "INSERT INTO profiles (id, email, full_name, password_hash, role, invited_by) " +
        "VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, email, fullName ?? null, passwordHash, role, req.userId!);

    const row = db
      .prepare(
        "SELECT id, email, full_name, role, invited_by, created_at FROM profiles WHERE id = ?"
      )
      .get(id) as ProfileRow;

    res.status(201).json({ user: publicUser(row) });
  } catch (err) {
    console.error("[users] create failed:", err);
    res.status(500).json({ error: "Unable to create the account" });
  }
});

export default router;
