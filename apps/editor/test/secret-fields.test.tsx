import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field } from '../src/views/settings/ui';
import { secretFieldProps } from '../src/lib/secret-field';

// The editor has two kinds of masked input and they need OPPOSITE treatment. A credential (sign in,
// change your password, confirm before arming MFA) should be filled and saved by a password manager.
// A third-party secret (SMTP password, AI key, OIDC client secret, a deploy target's FTP password)
// should not — it does not sign anyone into this site, and every prompt to "save your password" for
// one is noise the operator has to dismiss. `type="password"` is the only signal the browser gets, so
// the difference has to be spelled out.
describe('secret config fields', () => {
  it('tells password managers to stay out of a masked config field', () => {
    render(<Field label="SMTP password" value="" onChange={() => {}} type="password" />);
    const input = screen.getByLabelText('SMTP password');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.hasAttribute('data-1p-ignore')).toBe(true);
    expect(input.getAttribute('data-lpignore')).toBe('true');
    expect(input.getAttribute('data-bwignore')).toBe('true');
  });

  it('leaves an ordinary text field completely alone', () => {
    render(<Field label="Host" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Host');
    expect(input.getAttribute('autocomplete')).toBeNull();
    expect(input.hasAttribute('data-1p-ignore')).toBe(false);
  });

  it('covers the managers that ignore autocomplete="off" on password inputs', () => {
    // `off` alone is not enough in practice: the major managers deliberately disregard it on password
    // fields. The vendor opt-outs are the part that actually works, so they must not quietly go away.
    expect(secretFieldProps.autoComplete).toBe('off');
    expect(Object.keys(secretFieldProps).filter((k) => k.startsWith('data-')).length).toBeGreaterThanOrEqual(3);
  });
});
