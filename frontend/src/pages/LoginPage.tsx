import { useEffect, useId, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, CheckCircle2, LogIn, Mail } from "lucide-react";
import { z } from "zod";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { PasswordField } from "@/components/auth/PasswordField";
import { fetchSetupStatus, signIn } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const emailId = useId();
  const justCreated = Boolean((location.state as { created?: boolean } | null)?.created);

  /** Only a deployment with no accounts at all offers the setup screen. */
  const [needsSetup, setNeedsSetup] = useState(false);
  const [email, setEmail] = useState("");
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

    const result = loginSchema.safeParse({ email, password });
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
      await signIn(email, password);
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
      description="Use the account an administrator created for you."
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
          <label className="label" htmlFor={emailId}>
            Email
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              id={emailId}
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@company.com"
              autoFocus
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
              className={`input !pl-9 ${fieldErrors.email ? "!border-danger/50" : ""}`}
            />
          </div>
          {fieldErrors.email ? (
            <p id={`${emailId}-error`} className="mt-1 text-xs text-danger" role="alert">
              {fieldErrors.email}
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
