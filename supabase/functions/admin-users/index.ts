/**
 * Admin-only user provisioning.
 *
 * Creating a Supabase auth user requires the service role key, which must never
 * ship to the browser. This function holds it server-side and exposes two
 * actions:
 *
 *   { action: "bootstrap", email, password, fullName }
 *       Creates the *first* administrator of an empty deployment. Refuses once
 *       any profile exists, so it cannot be used to mint extra admins.
 *
 *   { action: "create", email, password, fullName, role }
 *       Creates an account on behalf of a signed-in administrator. The caller's
 *       JWT is verified here and their `profiles.role` must be `admin`.
 *
 *   { action: "status" }
 *       Unauthenticated. Reports whether the deployment still needs its first
 *       administrator, so the sign-in screen can offer setup only when it would
 *       actually succeed. Reveals nothing else.
 *
 * `verify_jwt` is disabled for this function because the bootstrap and status
 * actions have no caller to verify. Authorisation is therefore enforced explicitly below rather
 * than by the platform.
 *
 * New accounts are always provisioned in two steps: `auth.admin.createUser`
 * fires the `handle_new_user` trigger, which inserts an inert profile
 * (`role = 'agent'`, `invited_by = null`), and this function then records who
 * onboarded them. That second write uses the service role, which bypasses RLS
 * but still fires `protect_profile_fields`; that trigger recognises the service
 * role via `public.is_service_role()` and allows it.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ROLES = ["admin", "manager", "agent"] as const;
type Role = (typeof ROLES)[number];

/**
 * Origins allowed to call this function from a browser. Supabase edge functions
 * do not add CORS headers themselves, and a wildcard here would let any site
 * drive an administrator's session against this endpoint.
 */
const ALLOWED_ORIGINS = new Set([
  "https://cold-dialer-algedi.vercel.app",
  "https://cold-dialer-one.vercel.app",
  "https://cold-dialer-git-arena-2b483083-call-algedi.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(
  status: number,
  body: unknown,
  req: Request
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(req) },
  });
}

/** Mirrors the client and database password rules. */
function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string") return "Password is required";
  if (password.length < 10) return "Password must be at least 10 characters";
  if (password.length > 200) return "Password is too long";
  if (!/[a-zA-Z]/.test(password)) return "Password must contain a letter";
  if (!/[0-9]/.test(password)) return "Password must contain a number";
  return null;
}

function emailProblem(email: unknown): string | null {
  if (typeof email !== "string") return "Email is required";
  const value = email.trim().toLowerCase();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "A valid email address is required";
  }
  return null;
}

/**
 * Resolves the signed-in caller and asserts they are an administrator. Returns
 * either the admin's id or an error response ready to send back.
 */
async function requireAdmin(
  req: Request,
  admin: ReturnType<typeof createClient>
): Promise<{ adminId: string } | { response: Response }> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { response: json(401, { error: "Authentication required" }, req) };
  }

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    return { response: json(401, { error: "Session is not valid" }, req) };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return {
      response: json(
        403,
        { error: "Only an administrator can create accounts" },
        req
      ),
    };
  }

  return { adminId: data.user.id };
}

/**
 * Creates the auth user and then records who provisioned them. The update is
 * what makes the account usable: without `invited_by` the RLS policies treat it
 * as inert and it can read nothing.
 */
async function provision(
  admin: ReturnType<typeof createClient>,
  req: Request,
  opts: {
    email: string;
    password: string;
    fullName: string;
    role: Role;
    invitedBy: string;
  }
): Promise<Response> {
  const { data, error } = await admin.auth.admin.createUser({
    email: opts.email,
    password: opts.password,
    // Provisioned accounts are created confirmed. There is no self-service
    // mailbox check to satisfy, and an unconfirmed account would be unable to
    // sign in with no way for the user to fix it themselves.
    email_confirm: true,
    user_metadata: { full_name: opts.fullName },
  });

  if (error || !data?.user) {
    const message = error?.message ?? "";
    if (/already.*registered|already been registered/i.test(message)) {
      return json(
        409,
        { error: "An account with that email already exists" },
        req
      );
    }
    console.error("[admin-users] createUser failed:", message);
    return json(500, { error: "Unable to create the account" }, req);
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ invited_by: opts.invitedBy, role: opts.role, full_name: opts.fullName })
    .eq("id", data.user.id);

  if (updateError) {
    // The auth user now exists but is inert. Surface it rather than leaving an
    // account that silently cannot see anything.
    console.error("[admin-users] provisioning update failed:", updateError.message);
    return json(
      500,
      {
        error:
          "The account was created but could not be activated. Ask an administrator to retry.",
      },
      req
    );
  }

  return json(
    201,
    {
      user: {
        id: data.user.id,
        email: opts.email,
        fullName: opts.fullName,
        role: opts.role,
        provisioned: true,
      },
    },
    req
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" }, req);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    console.error("[admin-users] missing SUPABASE_URL or service role key");
    return json(500, { error: "Function is misconfigured" }, req);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Request body must be JSON" }, req);
  }

  const action = body.action;
  if (action !== "create" && action !== "bootstrap" && action !== "status") {
    return json(400, { error: "Unknown action" }, req);
  }

  if (action === "status") {
    const { count, error } = await admin
      .from("profiles")
      .select("*", { count: "exact", head: true });
    if (error) {
      console.error("[admin-users] status count failed:", error.message);
      return json(500, { error: "Unable to read setup status" }, req);
    }
    return json(200, { needsSetup: (count ?? 0) === 0 }, req);
  }

  const emailProblemMessage = emailProblem(body.email);
  if (emailProblemMessage) return json(400, { error: emailProblemMessage }, req);

  const passwordProblemMessage = passwordProblem(body.password);
  if (passwordProblemMessage) {
    return json(400, { error: passwordProblemMessage }, req);
  }

  const email = String(body.email).trim().toLowerCase();
  const password = String(body.password);
  const fullName =
    typeof body.fullName === "string" && body.fullName.trim()
      ? body.fullName.trim().slice(0, 120)
      : email.split("@")[0];

  // --- Bootstrap the first administrator -----------------------------------
  if (action === "bootstrap") {
    const { count, error } = await admin
      .from("profiles")
      .select("*", { count: "exact", head: true });

    if (error) {
      console.error("[admin-users] bootstrap count failed:", error.message);
      return json(500, { error: "Unable to verify whether setup is needed" }, req);
    }
    if ((count ?? 0) > 0) {
      return json(
        409,
        {
          error:
            "This deployment is already set up. An existing administrator must create your account.",
        },
        req
      );
    }

    // Nobody exists to attribute the account to, so it adopts itself.
    return await provision(admin, req, {
      email,
      password,
      fullName,
      role: "admin",
      invitedBy: "",
    }).then(async (res) => {
      // `provision` needs the new user's own id for a self-reference, which is
      // only known after creation, so patch it here on the bootstrap path.
      if (res.status !== 201) return res;
      const created = (await res.clone().json()) as { user: { id: string } };
      const { error: selfError } = await admin
        .from("profiles")
        .update({ invited_by: created.user.id })
        .eq("id", created.user.id);
      if (selfError) {
        console.error("[admin-users] bootstrap self-reference failed:", selfError.message);
      }
      return res;
    });
  }

  // --- Administrator creates an account ------------------------------------
  const requestedRole = ROLES.includes(body.role as Role)
    ? (body.role as Role)
    : "agent";

  const auth = await requireAdmin(req, admin);
  if ("response" in auth) return auth.response;

  return await provision(admin, req, {
    email,
    password,
    fullName,
    role: requestedRole,
    invitedBy: auth.adminId,
  });
});
