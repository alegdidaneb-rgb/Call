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
import { PORT, CORS_ORIGINS, BODY_LIMIT, NODE_ENV } from "./config/env.js";

const app = express();

app.disable("x-powered-by");
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

/** Brute-force protection for the credential endpoints. */
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

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api", apiLimiter);
app.use("/api/leads", leadsRoutes);
app.use("/api/campaigns", campaignsRoutes);
app.use("/api/call-logs", callLogsRoutes);
app.use("/api/scripts", scriptsRoutes);
app.use("/api/users", usersRoutes);

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

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Cold Dialer API running on http://localhost:${PORT} (${NODE_ENV})`);
});

function shutdown(signal: string): void {
  console.log(`[api] ${signal} received, closing server`);
  server.close(() => process.exit(0));
  // Do not hang forever if a connection refuses to drain.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
