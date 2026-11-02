import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import db from "../db/database.js";
import { generateToken, authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { BCRYPT_ROUNDS } from "../config/env.js";

const router = Router();

const newAccountSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email address is required"),
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(200, "Password is too long")
    .regex(/[a-zA-Z]/, "Password must contain a letter")
    .regex(/[0-9]/, "Password must contain a number"),
  fullName: z.string().trim().min(1).max(120).optional().nullable(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, "Password is required").max(200),
});

interface ProfileRow {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  password_hash: string | null;
  invited_by: string | null;
}

function publicUser(row: ProfileRow) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    provisioned:
      row.role === "admin" || row.role === "manager" || row.invited_by !== null,
  };
}

/**
 * Public signup has been removed. Only an administrator may create an account:
 * see `routes/users.ts`. What remains here is first-run setup, which is the one
 * exception -- a deployment with no accounts would otherwise be unreachable.
 *
 * `GET /status` reports whether that exception still applies, so the sign-in
 * screen offers setup only when it would succeed. It discloses nothing else.
 */
router.get("/status", (_req, res) => {
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM profiles").get() as { n: number };
    res.json({ needsSetup: row.n === 0 });
  } catch (err) {
    console.error("[auth] status failed:", err);
    res.status(500).json({ error: "Unable to read setup status" });
  }
});

/**
 * Creates the first administrator of an empty deployment.
 *
 * The emptiness check and the insert run inside one transaction, so two
 * concurrent requests cannot both bootstrap an administrator. Once any account
 * exists this endpoint is permanently closed.
 */
router.post("/bootstrap", async (req, res) => {
  const parsed = newAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }
  const { email, password, fullName } = parsed.data;

  try {
    // Hashing is async and better-sqlite3 transactions are not, so the hash is
    // computed first; the transaction still does its own check-and-insert.
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const id = uuid();

    const bootstrap = db.transaction((): string | null => {
      const existing = db.prepare("SELECT COUNT(*) AS n FROM profiles").get() as { n: number };
      if (existing.n > 0) return null;
      // Self-adopted: there is no administrator yet to attribute it to.
      db.prepare(
        "INSERT INTO profiles (id, email, full_name, password_hash, role, invited_by) " +
          "VALUES (?, ?, ?, ?, 'admin', ?)"
      ).run(id, email, fullName ?? null, passwordHash, id);
      return id;
    });

    const created = bootstrap();
    if (!created) {
      res.status(409).json({
        error:
          "This deployment is already set up. An existing administrator must create your account.",
      });
      return;
    }

    const row = db
      .prepare(
        "SELECT id, email, full_name, role, password_hash, invited_by FROM profiles WHERE id = ?"
      )
      .get(created) as ProfileRow;

    // No token is returned: the new administrator signs in through the normal
    // path rather than being silently logged in by a bootstrap call.
    res.status(201).json({ user: publicUser(row) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/UNIQUE/i.test(message)) {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }
    console.error("[auth] bootstrap failed:", err);
    res.status(500).json({ error: "Unable to create the administrator account" });
  }
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  const { email, password } = parsed.data;

  try {
    const user = db
      .prepare(
        "SELECT id, email, full_name, role, password_hash, invited_by FROM profiles WHERE email = ?"
      )
      .get(email) as ProfileRow | undefined;

    // Hash a dummy value on the miss path so that response timing does not
    // reveal whether the address exists.
    if (!user?.password_hash) {
      await bcrypt.hash(password, BCRYPT_ROUNDS);
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    res.json({ user: publicUser(user), token: generateToken(user.id) });
  } catch (err) {
    console.error("[auth] login failed:", err);
    res.status(500).json({ error: "Unable to sign in" });
  }
});

router.get("/me", authMiddleware, (req: AuthRequest, res) => {
  const user = db
    .prepare(
      "SELECT id, email, full_name, role, password_hash, invited_by FROM profiles WHERE id = ?"
    )
    .get(req.userId!) as ProfileRow | undefined;

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(publicUser(user));
});

export default router;
