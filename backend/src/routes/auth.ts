import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import db from "../db/database.js";
import { withTransaction } from "../db/pool.js";
import { generateToken, authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { BCRYPT_ROUNDS } from "../config/env.js";
import { normaliseUsername, syntheticEmail, usernameProblem } from "../lib/username.js";

const router = Router();

/** Validated by `lib/username`, which is the copy that must match migration 005. */
const usernameField = z
  .string()
  .superRefine((value, context) => {
    const problem = usernameProblem(value);
    if (problem) context.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  })
  .transform(normaliseUsername);

const newAccountSchema = z.object({
  username: usernameField,
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(200, "Password is too long")
    .regex(/[a-zA-Z]/, "Password must contain a letter")
    .regex(/[0-9]/, "Password must contain a number"),
  fullName: z.string().trim().min(1).max(120).optional().nullable(),
});

/**
 * Sign-in takes a username. `email` is still accepted as an alternative spelling
 * of the same field, and an address still resolves, so accounts created before
 * usernames existed are not locked out and an older client build keeps working
 * against this backend.
 */
const loginSchema = z
  .object({
    identifier: z.string().trim().min(1).optional(),
    email: z.string().trim().min(1).optional(),
    password: z.string().min(1, "Password is required").max(200),
  })
  .transform((value) => ({
    identifier: value.identifier ?? value.email ?? "",
    password: value.password,
  }))
  .refine((value) => value.identifier.length > 0, {
    message: "Username and password are required",
  });

interface ProfileRow {
  id: string;
  username: string | null;
  email: string;
  full_name: string | null;
  role: string;
  password_hash: string | null;
  invited_by: string | null;
}

function publicUser(row: ProfileRow) {
  return {
    id: row.id,
    username: row.username,
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
router.get("/status", async (_req, res) => {
  try {
    const row = await db.prepare("SELECT COUNT(*) AS n FROM profiles").get() as { n: number };
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
  const { username, password, fullName } = parsed.data;

  try {
    // Hashed before the transaction opens, not because the transaction is
    // synchronous any more, but because bcrypt is deliberately slow: holding a
    // pooled connection across it would keep a scarce connection idle while the
    // CPU works.
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const id = uuid();

    // Check-and-insert stays inside one transaction so two concurrent bootstraps
    // cannot both see an empty table and both create an administrator.
    const created = await withTransaction(async (tx): Promise<string | null> => {
      const existing = await tx
        .prepare("SELECT COUNT(*) AS n FROM profiles")
        .get<{ n: number }>();
      if ((existing?.n ?? 0) > 0) return null;
      // Self-adopted: there is no administrator yet to attribute it to.
      // The address is derived from the username: `email` is NOT NULL UNIQUE and
      // predates usernames, so it stays as the storage identity. Nothing mails it.
      await tx
        .prepare(
          "INSERT INTO profiles (id, username, email, full_name, password_hash, role, invited_by) " +
            "VALUES (?, ?, ?, ?, ?, 'admin', ?)"
        )
        .run(id, username, syntheticEmail(username), fullName ?? username, passwordHash, id);
      return id;
    });

    if (!created) {
      res.status(409).json({
        error:
          "This deployment is already set up. An existing administrator must create your account.",
      });
      return;
    }

    const row = await db
      .prepare(
        "SELECT id, username, email, full_name, role, password_hash, invited_by " +
          "FROM profiles WHERE id = ?"
      )
      .get(created) as ProfileRow;

    // No token is returned: the new administrator signs in through the normal
    // path rather than being silently logged in by a bootstrap call.
    res.status(201).json({ user: publicUser(row) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/UNIQUE/i.test(message)) {
      res.status(409).json({ error: "That username is already taken" });
      return;
    }
    console.error("[auth] bootstrap failed:", err);
    res.status(500).json({ error: "Unable to create the administrator account" });
  }
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Username and password are required",
    });
    return;
  }
  const { identifier, password } = parsed.data;

  try {
    // A username is the normal path; an address still matches, for accounts that
    // predate usernames. Both are compared case-insensitively, the way the unique
    // index stores them.
    const user = await db
      .prepare(
        "SELECT id, username, email, full_name, role, password_hash, invited_by FROM profiles " +
          "WHERE lower(username) = lower(?) OR lower(email) = lower(?)"
      )
      .get(identifier, identifier) as ProfileRow | undefined;

    // Hash a dummy value on the miss path so that response timing does not
    // reveal whether the username exists. Note this cannot hide existence
    // completely: `/status` and the 404 paths elsewhere are coarser signals, and
    // the Supabase deployment exposes `resolve_login_email` to anon. Recorded in
    // SECURITY.md rather than papered over.
    if (!user?.password_hash) {
      await bcrypt.hash(password, BCRYPT_ROUNDS);
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    res.json({ user: publicUser(user), token: generateToken(user.id) });
  } catch (err) {
    console.error("[auth] login failed:", err);
    res.status(500).json({ error: "Unable to sign in" });
  }
});

router.get("/me", authMiddleware, async (req: AuthRequest, res) => {
  const user = await db
    .prepare(
      "SELECT id, username, email, full_name, role, password_hash, invited_by " +
        "FROM profiles WHERE id = ?"
    )
    .get(req.userId!) as ProfileRow | undefined;

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(publicUser(user));
});

export default router;
