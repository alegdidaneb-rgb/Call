import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import authRoutes from "./routes/auth.js";
import leadsRoutes from "./routes/leads.js";
import campaignsRoutes from "./routes/campaigns.js";
import callLogsRoutes from "./routes/callLogs.js";
import scriptsRoutes from "./routes/scripts.js";
import usersRoutes from "./routes/users.js";
import sipAccountsRoutes from "./routes/sipAccounts.js";
import { CORS_ORIGINS, BODY_LIMIT, NODE_ENV } from "./config/env.js";
import { ensureSchema } from "./db/database.js";

/**
 * The Express app, with no listener attached.
 *
 * It used to live in `index.ts` together with `app.listen`. Splitting them is what
 * makes this deployable as a serverless function: on Vercel the module is imported
 * per cold start, and a module-scope `listen()` would bind a port that nothing
 * routes to — the platform hands the function `(req, res)` and expects a handler,
 * not a server. Both entrypoints now import this file:
 *
 *   - `src/index.ts` → long-lived server (Docker, `npm run dev`, a VPS)
 *   - `api/index.ts`  → Vercel serverless handler
 */
export const app = express();

app.disable("x-powered-by");

/**
 * `trust proxy` is set in both modes. Behind Docker's port mapping it is a no-op;
 * behind Vercel's load balancer it is what makes `req.ip` the client's address
 * rather than the platform's, and the rate limiters below key on `req.ip`.
 */
app.set("trust proxy", 1);

app.use(helmet());

/**
 * Origins come from CORS_ORIGINS. The previous `origin: true` reflected every
 * caller while also sending `Access-Control-Allow-Credentials: true`.
 */
app.use(
  cors({
    origin: CORS_ORIGINS === "*" ? true : CORS_ORIGINS,
    credentials: false,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  })
);

app.use(express.json({ limit: BODY_LIMIT }));

/**
 * Brute-force protection for the credential endpoints.
 *
 * KNOWN LIMITATION ON SERVERLESS. `express-rate-limit`'s default store is
 * in-process memory, which on Vercel means one counter per lambda instance rather
 * than one per deployment. A cold-start fleet does not share state, so an attacker
 * who fans requests across instances gets a multiple of the 20/15min budget. It is
 * still meaningfully better than nothing — a single instance throttles, and the
 * platform reuses warm instances — but it is not the guarantee it was when this ran
 * as one long-lived process. Fixing it properly needs a shared store
 * (`rate-limit-redis` or `@upstash/ratelimit`), which needs infrastructure this
 * deployment does not have. Left explicit rather than silently weakened.
 *
 * The Supabase-backed mode is unaffected: it enforces auth limits through the
 * platform's own rate limiting, not through this app.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in a few minutes." },
});

/** Coarse global limiter; generous enough not to affect normal SPA polling. */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Rate limit exceeded. Please slow down." },
});

/**
 * Liveness, and deliberately the only route that does not touch the database.
 *
 * That separation is the point: when a deployment is unhealthy you need to be able
 * to tell "the function is not running" from "the function is running but cannot
 * reach Postgres". If health depended on the pool it would answer the first
 * question for both cases and you would be guessing.
 */
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    mode: "postgres",
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

/** Reports whether the schema has been applied, for diagnostics. */
app.get("/api/health/ready", async (_req, res) => {
  try {
    await schemaReady;
    res.json({ ready: true });
  } catch (err) {
    res.status(503).json({
      ready: false,
      error: err instanceof Error ? err.message : "Schema could not be applied",
    });
  }
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api", apiLimiter);
app.use("/api/leads", leadsRoutes);
app.use("/api/campaigns", campaignsRoutes);
app.use("/api/call-logs", callLogsRoutes);
app.use("/api/scripts", scriptsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/sip-accounts", sipAccountsRoutes);

app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Endpoint not found" });
});

/**
 * Terminal error handler. Internal error messages are logged server-side but
 * never returned to the client.
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api] unhandled error:", err);
  if (res.headersSent) return;
  res.status(500).json({
    error: "Internal server error",
    ...(NODE_ENV === "production" ? {} : { detail: err.message }),
  });
});

/**
 * Schema application, started at import time and shared by both entrypoints.
 *
 * Started eagerly rather than awaited inline so the DDL round trip overlaps the
 * rest of cold-start work instead of serialising after it. Both entrypoints await
 * this before serving, which restores the guarantee the SQLite version got for
 * free by migrating synchronously at import.
 */
export const schemaReady: Promise<void> = ensureSchema();

/**
 * Attaching a no-op rejection handler here is not defensive noise — it is what
 * stops the process from dying. This promise is created at import time, but nothing
 * awaits it until the first request or the listener boots. If the database is
 * unreachable at that moment the rejection would otherwise be unhandled, and Node
 * terminates the process on unhandled rejections by default. Both entrypoints still
 * observe the real error through `schemaReady` itself; this only marks it as
 * handled at the source.
 */
schemaReady.catch(() => {
  /* handled by whoever awaits schemaReady */
});
