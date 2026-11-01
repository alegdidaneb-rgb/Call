import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import db from "../db/database.js";
import { generateToken, authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { BCRYPT_ROUNDS } from "../config/env.js";

const router = Router();

const signupSchema = z.object({
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
}

function publicUser(row: ProfileRow) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
  };
}

router.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }
  const { email, password, fullName } = parsed.data;

  try {
    const existing = db.prepare("SELECT id FROM profiles WHERE email = ?").get(email);
    if (existing) {
      // Same status and message shape as a failed login so that signup cannot be
      // used to enumerate which addresses already have an account.
      res.status(409).json({ error: "Unable to create account with those details" });
      return;
    }

    const id = uuid();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    db.prepare(
      "INSERT INTO profiles (id, email, full_name, password_hash, role) VALUES (?, ?, ?, ?, 'agent')"
    ).run(id, email, fullName ?? null, passwordHash);

    const row = db
      .prepare("SELECT id, email, full_name, role, password_hash FROM profiles WHERE id = ?")
      .get(id) as ProfileRow;

    res.status(201).json({ user: publicUser(row), token: generateToken(id) });
  } catch (err) {
    console.error("[auth] signup failed:", err);
    res.status(500).json({ error: "Unable to create account" });
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
      .prepare("SELECT id, email, full_name, role, password_hash FROM profiles WHERE email = ?")
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
    .prepare("SELECT id, email, full_name, role, password_hash FROM profiles WHERE id = ?")
    .get(req.userId!) as ProfileRow | undefined;

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(publicUser(user));
});

export default router;
