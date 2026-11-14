import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { fetchSetupStatus, signIn } from "@/lib/auth";
import { LogIn, Mail, Lock, AlertCircle, CheckCircle2 } from "lucide-react";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
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
    void fetchSetupStatus().then((status) => {
      if (active) setNeedsSetup(status.needsSetup);
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      const errs: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        const field = issue.path[0] as string;
        errs[field] = issue.message;
      });
      setFieldErrors(errs);
      return;
    }

    setLoading(true);
    try {
      await signIn(email, password);
      navigate("/dashboard");
    } catch (err: any) {
      setError(err.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-accent/10 to-accent/16 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-accent">Cold Dialer</h1>
          <p className="text-accent mt-2">Open-source SIP-powered dialer</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-panel rounded-xl shadow-lg p-8 space-y-5">
          <h2 className="text-xl font-semibold text-ink">Sign In</h2>
          {justCreated && (
            <div className="flex items-start gap-2 rounded-lg bg-success/12 border border-success/30 p-3 text-sm text-success">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Administrator created. Sign in with the email and password you just set.</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-danger bg-danger/12 p-3 rounded-lg text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-faint w-5 h-5" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-accent focus:border-accent outline-none transition ${fieldErrors.email ? "border-danger/30 bg-danger/12" : "border-line-strong"}`}
                placeholder="you@company.com"
              />
            </div>
            {fieldErrors.email && <p className="text-xs text-danger mt-1">{fieldErrors.email}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-faint w-5 h-5" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-accent focus:border-accent outline-none transition ${fieldErrors.password ? "border-danger/30 bg-danger/12" : "border-line-strong"}`}
                placeholder="••••••••"
              />
            </div>
            {fieldErrors.password && <p className="text-xs text-danger mt-1">{fieldErrors.password}</p>}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-strong disabled:bg-accent text-white font-semibold py-3 rounded-lg transition"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <LogIn className="w-5 h-5" />
                Sign In
              </>
            )}
          </button>
          {needsSetup ? (
            <p className="text-center text-sm text-muted">
              No accounts yet?{" "}
              <Link to="/setup" className="font-medium text-accent hover:text-accent">
                Set up this deployment
              </Link>
            </p>
          ) : (
            <p className="text-center text-sm text-muted">
              Accounts are created by an administrator.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
