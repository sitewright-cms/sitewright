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
