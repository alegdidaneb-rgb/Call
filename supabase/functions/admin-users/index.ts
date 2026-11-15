import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// NOTE: this file deliberately begins with the import rather than a comment.
// The Supabase management API returned a stored body with its leading `/**`
// removed, which would be a syntax error if that is what actually gets
// deployed. Starting with a statement makes the round trip verifiable: if the
// stored body still begins with `import`, nothing was stripped.
/**
 * Admin-only user provisioning.
 *
 * Creating a Supabase auth user requires the service role key, which must never
 * ship to the browser. This function holds it server-side and exposes four
 * actions. Every one of them is addressed by *username*: no caller supplies an
 * email address, and none is ever sent.
 *
 *   { action: "bootstrap", username, password, fullName }
 *       Creates the *first* administrator of an empty deployment. Refuses once
 *       any profile exists, so it cannot be used to mint extra admins.
 *
 *   { action: "create", username, password, fullName, role }
 *       Creates an account on behalf of a signed-in administrator. The caller's
 *       JWT is verified here and their `profiles.role` must be `admin`.
 *
 *   { action: "reset-password", userId, password }
 *       An administrator sets a new password for any account. Not optional: the
 *       address behind a username receives no mail, so there is no self-service
 *       recovery and a forgotten password would otherwise be permanent.
 *
 *   { action: "status" }
 *       Unauthenticated. Reports whether the deployment still needs its first
 *       administrator, so the sign-in screen can offer setup only when it would
 *       actually succeed. Reveals nothing else.
 *
 * Supabase Auth has no username identity, so `provision` derives the account's
 * address as `<username>@agents.cold-dialer.internal` — a domain that receives
 * nothing. Sign-in resolves a username back to that address through
 * `public.resolve_login_email`. Accounts created before migration 005 keep the
 * real address they already had; nothing is rewritten.
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

const ROLES = ["admin", "manager", "agent"] as const;
type Role = (typeof ROLES)[number];

/**
 * Reserved usernames, and the address domain accounts are given.
 *
 * Both must stay identical to their database counterparts in migration 005
 * (`public.reserved_usernames()` and the synthetic domain used by
 * `public.derive_username`). If they diverge, the client accepts something the
 * database rejects and the operator sees a constraint violation instead of a
 * readable message.
 */
const RESERVED_USERNAMES = [
  "admin", "administrator", "root", "system", "setup", "support", "help",
  "noreply", "no-reply", "postmaster", "webmaster", "abuse", "security",
  "everyone", "all", "null", "undefined", "unknown", "test", "guest",
];

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;

/**
 * The domain every created account's Supabase Auth identity lives under.
 *
 * Deliberately not a domain anybody owns or can receive mail at: an account
 * created here is addressed by username, and there is no mailbox behind it. A
 * routable domain would mean real mail bouncing, and would invite somebody to
 * assume a recovery email exists. The consequence — no self-service recovery, so
 * an administrator must be able to set a password — is handled by the
 * `reset-password` action below.
 */
const SYNTHETIC_EMAIL_DOMAIN = "agents.cold-dialer.internal";

function syntheticEmail(username: string): string {
  return `${username}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/**
 * Origins allowed to call this function from a browser. Supabase edge functions
 * do not add CORS headers themselves, so this is the only thing standing between
 * this endpoint and some other site driving an administrator's session against it.
 *
 * A literal list cannot carry the whole job. Vercel mints a new host per branch
 * and per deployment — `cold-dialer-git-<branch>-algedi.vercel.app`,
 * `cold-dialer-<hash>-algedi.vercel.app` — so under a list-only rule every branch
 * needs a code change before it can be tested, and the list grows one dead entry
 * per merged PR. (It already had one: a branch alias from a PR merged weeks ago,
 * and no entry for the branch that replaced it.)
 *
 * So this project's own Vercel hosts are matched by pattern instead of enumerated.
 * That is safe in a way a generic wildcard is not: `cold-dialer-*.vercel.app` can
 * only ever resolve to this project, because Vercel subdomains are globally
 * unique. `*.vercel.app` would not be acceptable here; this prefix is.
 *
 * Anything else — a sandbox preview, a staging domain — belongs in the
 * `ADMIN_USERS_ALLOWED_ORIGINS` secret, comma-separated, so it can be granted
 * without a redeploy. Deliberately NOT a wildcard over a shared domain: allowing
 * `*.e2b.app` would let every other sandbox on that platform call this function
 * with an administrator's token.
 */
const PROJECT_ORIGIN_PATTERN = /^https:\/\/cold-dialer(-[a-z0-9-]+)?\.vercel\.app$/;

const LOCAL_ORIGINS = new Set(["http://localhost:3000", "http://localhost:5173"]);

/** Trailing slashes are stripped so a copy-pasted URL with one still matches. */
const CONFIGURED_ORIGINS = new Set(
  (Deno.env.get("ADMIN_USERS_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean)
);

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  const value = origin.replace(/\/+$/, "");
  return (
    LOCAL_ORIGINS.has(value) ||
    CONFIGURED_ORIGINS.has(value) ||
    PROJECT_ORIGIN_PATTERN.test(value)
  );
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (isAllowedOrigin(origin)) {
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

/**
 * The reason a username is not acceptable, or null when it is.
 *
 * Mirrors the `profiles_username_shape` check constraint and the client's
 * `lib/username.ts`. This copy is the one that counts: it runs before
 * `createUser`, so a bad name is rejected with a readable message rather than as
 * a Postgres constraint violation surfaced from the trigger.
 */
function usernameProblem(username: unknown): string | null {
  if (typeof username !== "string") return "A username is required";
  const value = username.trim().toLowerCase();
  if (!value) return "A username is required";
  if (value.length < USERNAME_MIN_LENGTH) {
    return `Username must be at least ${USERNAME_MIN_LENGTH} characters`;
  }
  if (value.length > USERNAME_MAX_LENGTH) {
    return `Username must be at most ${USERNAME_MAX_LENGTH} characters`;
  }
  if (value.includes("@")) {
    return "Use a username, not an email address";
  }
  if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(value)) {
    return "Username may contain lowercase letters, numbers and . _ - , and must start and end with a letter or number";
  }
  if (RESERVED_USERNAMES.includes(value)) {
    return "That username is reserved";
  }
  return null;
}

/** Normalises the way the database stores and compares usernames. */
function normaliseUsername(username: string): string {
  return username.trim().toLowerCase();
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
    username: string;
    password: string;
    fullName: string;
    role: Role;
    invitedBy: string;
  }
): Promise<Response> {
  const username = normaliseUsername(opts.username);

  // The username is checked before anything is created, so a collision is
  // reported as "that username is taken" rather than as an auth error about an
  // address nobody ever saw. Two different Marcos at two different companies now
  // collide on the username, not on a shared mailbox.
  const { data: existing, error: lookupError } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (lookupError) {
    console.error("[admin-users] username lookup failed:", lookupError.message);
    return json(500, { error: "Unable to check whether that username is free" }, req);
  }
  if (existing) {
    return json(409, { error: "That username is already taken" }, req);
  }

  const { data, error } = await admin.auth.admin.createUser({
    // Supabase Auth has no username identity, so the address is derived from the
    // username. It is an implementation detail: never shown, never mailed.
    email: syntheticEmail(username),
    password: opts.password,
    // Provisioned accounts are created confirmed. There is no self-service
    // mailbox check to satisfy, and an unconfirmed account would be unable to
    // sign in with no way for the user to fix it themselves.
    email_confirm: true,
    // `username` in metadata is what `handle_new_user()` stores verbatim, so the
    // trigger does not fall back to deriving one from the synthetic address.
    user_metadata: { full_name: opts.fullName, username },
  });

  if (error || !data?.user) {
    const message = error?.message ?? "";
    if (/already.*registered|already been registered/i.test(message)) {
      return json(409, { error: "That username is already taken" }, req);
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
        username,
        // Still returned, because the client normalises through it and because a
        // pre-username account has a real address here. Nothing renders it.
        email: syntheticEmail(username),
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
  if (
    action !== "create" &&
    action !== "bootstrap" &&
    action !== "status" &&
    action !== "reset-password"
  ) {
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

  const passwordProblemMessage = passwordProblem(body.password);
  if (passwordProblemMessage) {
    return json(400, { error: passwordProblemMessage }, req);
  }

  // --- An administrator sets somebody else's password ----------------------
  //
  // Placed before the username checks: it needs a password but not a username,
  // because it addresses an account that already has one.
  if (action === "reset-password") {
    const auth = await requireAdmin(req, admin);
    if ("response" in auth) return auth.response;

    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!userId) return json(400, { error: "A user id is required" }, req);

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, username")
      .eq("id", userId)
      .maybeSingle();
    if (targetError || !target) {
      return json(404, { error: "No such account" }, req);
    }

    const { error: resetError } = await admin.auth.admin.updateUserById(userId, {
      password: String(body.password),
    });
    if (resetError) {
      console.error("[admin-users] password reset failed:", resetError.message);
      return json(500, { error: "Unable to set that password" }, req);
    }

    return json(
      200,
      { user: { id: target.id, username: target.username, passwordChanged: true } },
      req
    );
  }

  const usernameProblemMessage = usernameProblem(body.username);
  if (usernameProblemMessage) {
    return json(400, { error: usernameProblemMessage }, req);
  }

  const username = normaliseUsername(String(body.username));
  const password = String(body.password);
  const fullName =
    typeof body.fullName === "string" && body.fullName.trim()
      ? body.fullName.trim().slice(0, 120)
      : username;

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
      username,
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
    username,
    password,
    fullName,
    role: requestedRole,
    invitedBy: auth.adminId,
  });
});
