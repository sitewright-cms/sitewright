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
            className={!touched ? 'text-slate-400' : met ? 'text-emerald-600' : 'text-slate-500'}
          >
            <span aria-hidden="true" className="mr-1.5 inline-block w-3 text-center">
              {touched && met ? '✓' : '○'}
            </span>
            {rule.label}
            <span className="sr-only"> — {touched && met ? 'met' : 'not met'}</span>
          </li>
        );
      })}
    </ul>
  );
}
