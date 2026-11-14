import { z } from "zod";

/**
 * The password policy, defined once.
 *
 * It had three independent definitions: a zod schema on the setup screen, a
 * second, near-identical zod schema on the team screen, and a checklist in the
 * password field. Three copies of one rule is how a policy ends up enforced in
 * two places and displayed in a third that disagrees — an operator would see a
 * green checklist and still be refused on submit, with no way to tell which was
 * right.
 *
 * Everything here derives from `PASSWORD_RULES`, so the validation and the
 * on-screen checklist cannot diverge.
 */

export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordRule {
  label: string;
  test: (value: string) => boolean;
  /** The message shown when this rule is the reason a submission was refused. */
  message: string;
}

export const PASSWORD_RULES: PasswordRule[] = [
  {
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (value) => value.length >= PASSWORD_MIN_LENGTH,
    message: `Use at least ${PASSWORD_MIN_LENGTH} characters`,
  },
  {
    label: "A letter",
    test: (value) => /[a-zA-Z]/.test(value),
    message: "Include a letter",
  },
  {
    label: "A number",
    test: (value) => /[0-9]/.test(value),
    message: "Include a number",
  },
];

/**
 * The schema every form that sets a password validates with.
 *
 * The edge function and the backend enforce the same policy server-side; this is
 * the client half, so a mistake is caught before a round trip rather than after.
 */
export const passwordSchema = z
  .string()
  .superRefine((value, context) => {
    for (const rule of PASSWORD_RULES) {
      if (!rule.test(value)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: rule.message });
        // One message at a time: the checklist already shows every rule that is
        // unmet, so a stack of three errors under one field is redundant.
        return;
      }
    }
  });
