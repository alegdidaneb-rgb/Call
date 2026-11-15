import { useEffect, useId, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, CheckCircle2, LogIn, User } from "lucide-react";
import { z } from "zod";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { PasswordField } from "@/components/auth/PasswordField";
import { fetchSetupStatus, signIn } from "@/lib/auth";

/**
 * The field accepts a username, and still accepts an address so that accounts
 * created before usernames existed are not locked out. Validation is therefore
 * deliberately loose here: `resolveLoginEmail` decides, and a wrong username
 * should come back as "no account uses that username" rather than as a
 * client-side complaint about the shape of what was typed.
 */
const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your username"),
  password: z.string().min(1, "Enter your password"),
});

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const usernameId = useId();
  const justCreated = Boolean((location.state as { created?: boolean } | null)?.created);

  /** Only a deployment with no accounts at all offers the setup screen. */
  const [needsSetup, setNeedsSetup] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    // A rejected status check must not become an unhandled rejection: the form
    // is still usable, it simply cannot offer the setup link.
    fetchSetupStatus()
      .then((status) => {
        if (active) setNeedsSetup(status.needsSetup);
      })
      .catch(() => {
        if (active) setNeedsSetup(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setFieldErrors({});

    const result = loginSchema.safeParse({ identifier, password });
    if (!result.success) {
      const errs: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as string;
        if (field && !errs[field]) errs[field] = issue.message;
      }
      setFieldErrors(errs);
      return;
    }

    setLoading(true);
    try {
      await signIn(identifier, password);
      navigate("/workspace");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setLoading(false);
    }
  }

  return (
    <AuthScreen
      tagline="Outbound calling for teams that work a list"
      title="Sign in"
      description="Sign in with the username an administrator gave you."
      footer={
        needsSetup ? (
          <p>
            This deployment has no accounts yet.{" "}
            <Link to="/setup" className="font-semibold text-accent hover:text-accent-strong">
              Set it up
            </Link>
          </p>
        ) : (
          <p>Accounts are created by an administrator from the Team page.</p>
        )
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {justCreated ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/12 p-3 text-sm text-success"
            role="status"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              The administrator account was created. Sign in with the email and password you just
              set.
            </span>
          </div>
        ) : null}

        {error ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/12 p-3 text-sm text-danger"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div>
          <label className="label" htmlFor={usernameId}>
            Username
          </label>
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              id={usernameId}
              name="username"
              type="text"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="username"
              placeholder="your-username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              aria-invalid={Boolean(fieldErrors.identifier)}
              aria-describedby={fieldErrors.identifier ? `${usernameId}-error` : undefined}
              className={`input !pl-9 ${fieldErrors.identifier ? "!border-danger/50" : ""}`}
            />
          </div>
          {fieldErrors.identifier ? (
            <p id={`${usernameId}-error`} className="mt-1 text-xs text-danger" role="alert">
              {fieldErrors.identifier}
            </p>
          ) : null}
        </div>

        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          error={fieldErrors.password}
        />

        <button type="submit" disabled={loading} className="btn btn-primary w-full !py-2.5">
          {loading ? (
            <>
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-inverse border-t-transparent"
                aria-hidden="true"
              />
              Signing in…
            </>
          ) : (
            <>
              <LogIn className="h-4 w-4" />
              Sign in
            </>
          )}
        </button>
      </form>
    </AuthScreen>
  );
}
