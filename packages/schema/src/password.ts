import { z } from 'zod';

/**
 * The single source of truth for the account-password policy, shared by the API
 * (server-side validation in the register + change-password bodies) and the editor
 * (the live ✓/✗ requirements checklist on the signup + change-password forms). Keeping
 * the rules in one place means the UI and the server can never drift.
 *
 * Policy: 8–200 chars with at least one uppercase letter, one lowercase letter, one
 * digit, and one symbol (any non-alphanumeric character).
 *
 * NOTE: login is intentionally NOT subject to this — an existing account whose password
 * predates a policy change must still be able to sign in (the login body keeps `min(1)`).
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

/** A single password requirement: a user-facing label and the predicate that satisfies it. */
export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string) => boolean;
}

/**
 * The ordered requirements rendered as a checklist AND enforced by {@link passwordSchema}.
 * The symbol rule is "any non-alphanumeric character" so it accepts the full printable set
 * (spaces, accented letters count as symbols here) rather than a hand-picked punctuation list.
 */
export const PASSWORD_RULES: readonly PasswordRule[] = Object.freeze([
  { id: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (p) => p.length >= PASSWORD_MIN_LENGTH },
  { id: 'uppercase', label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { id: 'lowercase', label: 'One lowercase letter', test: (p) => /[a-z]/.test(p) },
  { id: 'number', label: 'One number', test: (p) => /[0-9]/.test(p) },
  { id: 'symbol', label: 'One symbol', test: (p) => /[^A-Za-z0-9]/.test(p) },
]);

/** The labels of every rule the password fails (empty ⇒ the password satisfies the policy). */
export function failingPasswordRules(password: string): string[] {
  return PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.label);
}

/** True when the password satisfies every rule and is within the length cap. */
export function isPasswordValid(password: string): boolean {
  return password.length <= PASSWORD_MAX_LENGTH && PASSWORD_RULES.every((rule) => rule.test(password));
}

/**
 * The canonical password validator for account creation and password changes. The length
 * cap is enforced first (a hard bound that also keeps the scrypt cost bounded); then each
 * unmet rule adds its own issue, so the client receives EVERY failing requirement at once
 * — not just the first — to populate the form error / checklist.
 */
export const passwordSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH, `must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .superRefine((value, ctx) => {
    for (const rule of PASSWORD_RULES) {
      if (!rule.test(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: rule.label });
      }
    }
  });
