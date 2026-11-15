import type { IncomingMessage, ServerResponse } from "node:http";
import { app, schemaReady } from "../src/app.js";

/**
 * Vercel serverless entrypoint.
 *
 * This file is the whole reason the SQLite version could not deploy. Express is a
 * long-lived HTTP server; Vercel does not run one. It imports this module, calls
 * the default export per request, and freezes the instance in between. So the app
 * is built at import time (cheap, happens once per cold start) and the request is
 * handed straight to it.
 *
 * Typed against `node:http` rather than `@vercel/node`. `VercelRequest` and
 * `VercelResponse` are just those two interfaces with extra properties, so Express
 * accepts them, and this avoids a dependency whose only job would be naming types
 * that already exist. It also keeps the module runnable by anything that speaks
 * plain Node HTTP.
 */

/**
 * Upper bound on how long the platform will let a request run.
 *
 * Set generously because CSV import inserts row by row inside one transaction, and
 * a large import on a cold pool needs the headroom. Exceeding the plan's ceiling
 * makes Vercel ignore the value rather than fail the deploy.
 */
export const maxDuration = 60;

/**
 * The schema promise, so a request arriving during a cold start waits for the
 * tables instead of querying a database that has not been created yet.
 *
 * Awaiting it per request costs nothing once it has settled — an already-resolved
 * promise is a microtask — but it closes the window where the first requests of a
 * cold start would race the DDL. `src/app.ts` starts it at import time, so by the
 * time a request arrives it is usually already done.
 *
 * Failure is reported rather than swallowed. Without this the request would fall
 * through to Express and produce a 500 from some route complaining about a missing
 * relation, which tells the operator nothing about the actual cause.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await schemaReady;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown error";
    console.error("[api] schema unavailable:", detail);
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    // The message goes out because this is an operator-facing failure, not a
    // client-facing one: it appears when the database URL is wrong or unreachable,
    // and "Internal server error" would send them looking in the wrong place.
    // Route-level errors remain sanitised by the terminal handler in app.ts.
    res.end(JSON.stringify({ error: "Service unavailable: database schema not ready", detail }));
    return;
  }

  app(req, res);
}
