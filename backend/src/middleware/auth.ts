import type { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import db from "../db/database.js";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../config/env.js";

export type Role = "admin" | "agent" | "manager";

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: Role;
  userEmail?: string;
}

interface ProfileRow {
  id: string;
  email: string;
  role: Role;
}

export function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

/**
 * Verifies the bearer token, then loads the profile from the database so that
 * `userRole` always reflects the *current* role rather than a stale claim baked
 * into a 7-day token. Previously `userRole` was declared on AuthRequest but
 * never assigned, so no route could enforce roles at all.
 */
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  let payload: { userId?: string };
  try {
    payload = jwt.verify(token, JWT_SECRET) as { userId?: string };
  } catch (err) {
    const message =
      err instanceof jwt.TokenExpiredError ? "Token expired" : "Invalid or expired token";
    res.status(401).json({ error: message });
    return;
  }

  if (!payload.userId) {
    res.status(401).json({ error: "Invalid token payload" });
    return;
  }

  const profile = db
    .prepare("SELECT id, email, role FROM profiles WHERE id = ?")
    .get(payload.userId) as ProfileRow | undefined;

  if (!profile) {
    // Token is cryptographically valid but the account no longer exists.
    res.status(401).json({ error: "Account no longer exists" });
    return;
  }

  req.userId = profile.id;
  req.userRole = profile.role;
  req.userEmail = profile.email;
  next();
}

/**
 * Restricts a route to the given roles. Must run after authMiddleware.
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authed = req as AuthRequest;
    if (!authed.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!authed.userRole || !roles.includes(authed.userRole)) {
      res.status(403).json({ error: "Insufficient permissions for this action" });
      return;
    }
    next();
  };
}

export function isAdmin(req: AuthRequest): boolean {
  return req.userRole === "admin";
}
