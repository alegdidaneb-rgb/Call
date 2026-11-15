import { app, schemaReady } from "./app.js";
import { PORT, NODE_ENV } from "./config/env.js";
import { closePool } from "./db/pool.js";

/**
 * Long-lived server entrypoint: Docker, `npm run dev`, a VPS.
 *
 * Vercel does not use this file — it uses `api/index.ts`. Keeping them separate is
 * what lets the same app run as a process and as a function without either mode
 * carrying the other's assumptions.
 */
async function main(): Promise<void> {
  // Awaited before listening, not raced against it. Binding the port first would
  // let a request arrive while the tables are still being created, and the
  // resulting error would look like a broken route rather than a boot sequence.
  try {
    await schemaReady;
  } catch (err) {
    console.error("[api] schema could not be applied, refusing to start:", err);
    process.exitCode = 1;
    return;
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Cold Dialer API running on http://localhost:${PORT} (${NODE_ENV})`);
  });

  function shutdown(signal: string): void {
    console.log(`[api] ${signal} received, closing server`);
    // Stop accepting first, then release the pool. The reverse order would let an
    // in-flight request fail on a connection that was closed under it.
    server.close(() => {
      closePool().finally(() => process.exit(0));
    });
    // Do not hang forever if a connection refuses to drain.
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void main();

export default app;
