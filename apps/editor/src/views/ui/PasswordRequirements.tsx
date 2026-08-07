import { Check, Circle } from 'lucide-react';
import { PASSWORD_RULES } from '@sitewright/schema';

interface PasswordRequirementsProps {
  /** The current password value being validated. */
  value: string;
  /** Optional extra classes for the wrapper list. */
  className?: string;
}

/**
 * A live ✓/○ checklist of the shared account-password policy ({@link PASSWORD_RULES}). Rendered under
 * the password field on the signup + change-password forms so the requirements are always visible
 * while typing. Before the user types anything the rules render as neutral hints (not red failures).
 */
export function PasswordRequirements({ value, className }: PasswordRequirementsProps) {
  const touched = value.length > 0;
  return (
    <ul className={`mt-1.5 flex flex-col gap-0.5 text-xs ${className ?? ''}`} aria-label="Password requirements">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value);
        return (
          <li
            key={rule.id}
            data-testid={`pw-rule-${rule.id}`}
            data-met={met ? 'true' : 'false'}
            // THREE states, and they have to stay visually distinct: nothing typed yet (no judgment
            // — the muted tier), typed and satisfied (emerald), typed and still failing (the darker
            // secondary tier, so an unmet rule reads as something to act on rather than as the same
            // grey it started out). Raising the muted tier for contrast collapsed the first and third
            // into one colour once; keep them on deliberately different tokens.
            className={
              !touched
                ? 'text-slate-500 dark:text-slate-400'
                : met
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-800 dark:text-slate-100'
            }
          >
            <span aria-hidden="true" className="mr-1.5 inline-flex w-3 justify-center">
              {touched && met ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}
            </span>
            {rule.label}
            <span className="sr-only"> — {touched && met ? 'met' : 'not met'}</span>
          </li>
        );
      })}
    </ul>
  );
}
