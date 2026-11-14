import { useId, useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
/**
 * A password input with a reveal toggle and, optionally, the rules it must
 * satisfy.
 *
 * The setup screen stated its password policy in a static sentence and then
 * rejected the submission at the end if the operator had got it wrong — the
 * feedback arrived after the work instead of during it. With `requirements` the
 * same three rules are shown as a checklist that updates on every keystroke, so
 * the form cannot be submitted and then refused for something visible on screen.
 */

import { PASSWORD_RULES } from "@/lib/passwordPolicy";

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** `current-password` on sign-in, `new-password` when one is being created. */
  autoComplete: string;
  error?: string;
  /** Static help text shown instead of the checklist. */
  hint?: string;
  requirements?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  id?: string;
  /**
   * Start unmasked. Used where an administrator is setting a temporary password
   * for somebody else and has to read it back in order to hand it over.
   */
  defaultRevealed?: boolean;
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  error,
  hint,
  requirements = false,
  placeholder = "••••••••••",
  autoFocus = false,
  id,
  defaultRevealed = false,
}: PasswordFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [revealed, setRevealed] = useState(defaultRevealed);

  // Only shown once there is something to judge; an all-red checklist beside an
  // empty field is noise before the operator has started.
  const showChecklist = requirements && value.length > 0;

  return (
    <div>
      <label className="label" htmlFor={inputId}>
        {label}
      </label>

      <div className="relative">
        <input
          id={inputId}
          type={revealed ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          name={autoComplete === "current-password" ? "password" : "new-password"}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={`input !pr-10 ${error ? "!border-danger/50" : ""}`}
        />
        <button
          type="button"
          onClick={() => setRevealed((previous) => !previous)}
          aria-label={revealed ? "Hide password" : "Show password"}
          aria-pressed={revealed}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      {error ? (
        <p id={`${inputId}-error`} className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {showChecklist ? (
        <ul className="mt-2 space-y-1">
          {PASSWORD_RULES.map((requirement) => {
            const met = requirement.test(value);
            return (
              <li
                key={requirement.label}
                className={`flex items-center gap-1.5 text-xs ${met ? "text-success" : "text-faint"}`}
              >
                {met ? (
                  <Check className="h-3 w-3 shrink-0" />
                ) : (
                  <X className="h-3 w-3 shrink-0" />
                )}
                {requirement.label}
              </li>
            );
          })}
        </ul>
      ) : hint && !error ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
