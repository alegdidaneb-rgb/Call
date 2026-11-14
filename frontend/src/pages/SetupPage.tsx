import { useEffect, useId, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { AlertCircle, ArrowLeft, ShieldCheck, UserPlus } from "lucide-react";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { PasswordField } from "@/components/auth/PasswordField";
import { bootstrapFirstAdmin, fetchSetupStatus } from "@/lib/auth";
import { passwordSchema } from "@/lib/passwordPolicy";

/**
 * First-run setup.
 *
 * Public signup no longer exists, so a brand-new deployment would otherwise have
 * no way to create its first administrator. This screen is that one exception,
 * and the server closes it: `bootstrapFirstAdmin` is rejected as soon as any
 * account exists, so it can never be used to mint a second administrator.
 */

const setupSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter your full name"),
    email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "The two passwords do not match",
    path: ["confirmPassword"],
  });

type FieldName = "fullName" | "email" | "password" | "confirmPassword";
type FieldErrors = Partial<Record<FieldName, string>>;

export function SetupPage() {
  const navigate = useNavigate();
  const nameId = useId();
  const emailId = useId();

  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetchSetupStatus()
      .then((status) => {
        if (active) setNeedsSetup(status.needsSetup);
      })
      .catch((err: unknown) => {
        // Say so rather than showing a spinner forever or an empty form that
        // would fail on submit for a reason nobody can see.
        if (active) {
          setFormError(
            err instanceof Error
              ? `Could not check whether this deployment needs setup: ${err.message}`
              : "Could not check whether this deployment needs setup.",
          );
        }
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsed = setupSchema.safeParse({ fullName, email, password, confirmPassword });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as FieldName;
        if (key && !next[key]) next[key] = issue.message;
      }
      setFieldErrors(next);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      await bootstrapFirstAdmin({
        email: parsed.data.email,
        password: parsed.data.password,
        fullName: parsed.data.fullName,
      });
      // The account is created already confirmed, so there is no email step to
      // wait for -- go straight to the sign-in form.
      navigate("/login", { state: { created: true } });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Unable to create the administrator account",
      );
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen
      tagline="First-run setup"
      title="Create the first administrator"
      description="This screen is available only while the database has no accounts. Every account after this one is created by an administrator from the Team page."
      footer={
        <p>
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-accent hover:text-accent-strong">
            Sign in
          </Link>
        </p>
      }
    >
      {checking ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent"
            aria-hidden="true"
          />
          Checking this deployment…
        </div>
      ) : !needsSetup ? (
        <div className="space-y-4">
          {formError ? (
            <p
              className="rounded-lg border border-danger/30 bg-danger/12 p-3 text-sm text-danger"
              role="alert"
            >
              {formError}
            </p>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-line bg-app p-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              <div className="text-sm">
                <p className="font-semibold text-ink">This deployment is already set up.</p>
                <p className="mt-1 leading-relaxed text-muted">
                  Accounts are created by an administrator. Ask yours to add you from the Team page,
                  then sign in with the password they set.
                </p>
              </div>
            </div>
          )}
          <Link to="/login" className="btn btn-secondary w-full">
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {formError ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/12 p-3 text-sm text-danger"
              role="alert"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          ) : null}

          <div>
            <label className="label" htmlFor={nameId}>
              Full name
            </label>
            <input
              id={nameId}
              name="fullName"
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              placeholder="Alex Moreau"
              autoFocus
              aria-invalid={Boolean(fieldErrors.fullName)}
              aria-describedby={fieldErrors.fullName ? `${nameId}-error` : undefined}
              className={`input ${fieldErrors.fullName ? "!border-danger/50" : ""}`}
            />
            {fieldErrors.fullName ? (
              <p id={`${nameId}-error`} className="mt-1 text-xs text-danger" role="alert">
                {fieldErrors.fullName}
              </p>
            ) : null}
          </div>

          <div>
            <label className="label" htmlFor={emailId}>
              Work email
            </label>
            <input
              id={emailId}
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@company.com"
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
              className={`input ${fieldErrors.email ? "!border-danger/50" : ""}`}
            />
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
            autoComplete="new-password"
            error={fieldErrors.password}
            requirements
            hint="You will share this with nobody; write it into your password manager."
          />

          <PasswordField
            label="Confirm password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            error={fieldErrors.confirmPassword}
            placeholder="Repeat it exactly"
          />

          <button type="submit" disabled={submitting} className="btn btn-primary w-full !py-2.5">
            {submitting ? (
              <>
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-inverse border-t-transparent"
                  aria-hidden="true"
                />
                Creating account…
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Create administrator
              </>
            )}
          </button>
        </form>
      )}
    </AuthScreen>
  );
}
