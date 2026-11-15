import { useEffect, useId, useState } from "react";
import { KeyRound } from "lucide-react";
import toast from "react-hot-toast";
import { PasswordField } from "@/components/auth/PasswordField";
import { bindShortcuts, keyName, pushOverlay } from "@/lib/keys";
import { passwordSchema } from "@/lib/passwordPolicy";
import { resetUserPassword } from "@/lib/auth";

/**
 * An administrator sets a new password for somebody else.
 *
 * This dialog is not a convenience. Accounts sign in with a username backed by an
 * address that receives no mail, so there is no "forgot password" link and no
 * recovery email to send — without this, a forgotten password is permanent and
 * the only remedy would be recreating the account and losing everything
 * attributed to it.
 *
 * It therefore also states plainly that the new password has to be handed over by
 * hand, because there is no channel through which the app could deliver it.
 */

interface ResetPasswordDialogProps {
  open: boolean;
  /** Who the password is being set for. */
  username: string | null;
  userId: string | null;
  onClose: () => void;
}

export function ResetPasswordDialog({ open, username, userId, onClose }: ResetPasswordDialogProps) {
  const titleId = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setConfirm("");
    setError(null);
    setPending(false);
  }, [open, userId]);

  useEffect(() => (open ? pushOverlay() : undefined), [open]);
  useEffect(
    () =>
      open
        ? bindShortcuts(
            (event) => {
              if (keyName(event) === "Escape") {
                event.preventDefault();
                onClose();
              }
            },
            { allowInOverlay: true },
          )
        : undefined,
    [open, onClose],
  );

  if (!open || !userId) return null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "That password is not acceptable");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match");
      return;
    }

    setPending(true);
    try {
      await resetUserPassword(userId as string, password);
      toast.success(`New password set for ${username ?? "that account"}`);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not set the password");
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-line-strong bg-panel shadow-floating animate-scale-in"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="shrink-0 rounded-lg bg-accent/12 p-2 text-accent">
            <KeyRound className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              Set a new password
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              For <strong className="font-semibold text-ink">{username ?? "this account"}</strong>.
              They sign in with it immediately; the old password stops working.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          <PasswordField
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            requirements
            defaultRevealed
            autoFocus
            hint="Shown in full so you can copy it and hand it over. No email is sent — there is no address to send it to."
          />

          <PasswordField
            label="Confirm password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            placeholder="Repeat it exactly"
          />

          {error ? (
            <p
              className="rounded-lg border border-danger/30 bg-danger/12 px-3 py-2 text-xs text-danger"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <button type="button" onClick={onClose} className="btn btn-secondary btn-sm" disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
              {pending ? "Setting…" : "Set password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
