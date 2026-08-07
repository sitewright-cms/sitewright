import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PasswordRequirements } from '../src/views/ui/PasswordRequirements';

const RULE_IDS = ['length', 'uppercase', 'lowercase', 'number', 'symbol'];

describe('PasswordRequirements', () => {
  it('shows every rule as not-met before the user types', () => {
    render(<PasswordRequirements value="" />);
    for (const id of RULE_IDS) {
      expect(screen.getByTestId(`pw-rule-${id}`)).toHaveAttribute('data-met', 'false');
    }
  });

  it('ticks every rule for a fully-compliant password', () => {
    render(<PasswordRequirements value="Str0ng-Pw!" />);
    for (const id of RULE_IDS) {
      expect(screen.getByTestId(`pw-rule-${id}`)).toHaveAttribute('data-met', 'true');
    }
  });

  it('★ keeps its THREE states visually distinct', () => {
    // A blanket contrast pass once turned "nothing typed yet" and "typed and still failing" into the
    // same colour, and this suite stayed green because it only ever asserted `data-met`. The three
    // states carry different meanings, so they have to carry different colours.
    const untouched = render(<PasswordRequirements value="" />).container.querySelector('[data-testid="pw-rule-length"]')!;
    const untouchedClass = untouched.className;

    const partial = render(<PasswordRequirements value="abc1" />).container; // typed ⇒ touched
    const unmet = partial.querySelector('[data-testid="pw-rule-length"]')!.className;
    const satisfied = partial.querySelector('[data-testid="pw-rule-lowercase"]')!.className;

    expect(unmet).not.toBe(untouchedClass); // "not started" vs "not there yet"
    expect(unmet).not.toBe(satisfied);
    expect(satisfied).not.toBe(untouchedClass);
  });

  it('marks only the satisfied rules for a partial password', () => {
    // lowercase + number only; missing uppercase/symbol and too short.
    render(<PasswordRequirements value="abc1" />);
    expect(screen.getByTestId('pw-rule-lowercase')).toHaveAttribute('data-met', 'true');
    expect(screen.getByTestId('pw-rule-number')).toHaveAttribute('data-met', 'true');
    expect(screen.getByTestId('pw-rule-uppercase')).toHaveAttribute('data-met', 'false');
    expect(screen.getByTestId('pw-rule-symbol')).toHaveAttribute('data-met', 'false');
    expect(screen.getByTestId('pw-rule-length')).toHaveAttribute('data-met', 'false');
  });
});
