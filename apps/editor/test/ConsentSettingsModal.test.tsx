import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConsentSettingsModal } from '../src/views/settings/ConsentSettingsModal';
import type { SettingsForm } from '../src/views/settings/model';

// A stateful harness so a patch actually re-renders the modal with the updated form (multi-step flows).
// The modal only reads form.consent, so a minimal form cast is sufficient.
function Harness({ consent }: { consent?: Record<string, unknown> }) {
  const [form, setForm] = useState({ consent: { enabled: true, ...consent } } as unknown as SettingsForm);
  return <ConsentSettingsModal form={form} patch={(p) => setForm((f) => ({ ...f, ...p }))} onClose={() => {}} />;
}

describe('ConsentSettingsModal', () => {
  it('renders the banner + category + integration controls', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Banner layout')).toHaveValue('bar');
    expect(screen.getByLabelText('Show "Reject all" button')).toBeChecked();
    expect(screen.getByLabelText('Functional')).toBeChecked();
    expect(screen.getByLabelText('Analytics')).toBeChecked();
    expect(screen.getByLabelText('Marketing')).toBeChecked();
    expect(screen.getByRole('button', { name: '+ Add integration' })).toBeInTheDocument();
  });

  it('switches the banner layout to box', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Banner layout'), { target: { value: 'box' } });
    expect(screen.getByLabelText('Banner layout')).toHaveValue('box');
  });

  it('toggling off a category unchecks it (and keeps necessary implicit)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Marketing'));
    expect(screen.getByLabelText('Marketing')).not.toBeChecked();
    expect(screen.getByLabelText('Analytics')).toBeChecked();
  });

  it('adds an integration (GA4 by default → measurement id field) and switches it to a custom script', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add integration' }));
    // a GA4 row: name + type(ga4) + a measurement-id input
    expect(screen.getByLabelText('Integration 1 name')).toBeInTheDocument();
    expect(screen.getByLabelText('Integration 1 type')).toHaveValue('ga4');
    expect(screen.getByLabelText('Integration 1 measurement id')).toBeInTheDocument();
    expect(screen.queryByLabelText('Integration 1 script url')).toBeNull();
    // switch to custom → the script-url field replaces the measurement id
    fireEvent.change(screen.getByLabelText('Integration 1 type'), { target: { value: 'custom' } });
    expect(screen.getByLabelText('Integration 1 script url')).toBeInTheDocument();
    expect(screen.queryByLabelText('Integration 1 measurement id')).toBeNull();
  });

  it('switching an integration preset clears the previous preset’s field (no stale 400 on save)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add integration' }));
    fireEvent.change(screen.getByLabelText('Integration 1 measurement id'), { target: { value: 'G-DEMO0000' } });
    expect(screen.getByLabelText('Integration 1 measurement id')).toHaveValue('G-DEMO0000');
    // ga4 → gtm: the now-wrong-format measurement id must RESET, not carry over (it would 400).
    fireEvent.change(screen.getByLabelText('Integration 1 type'), { target: { value: 'gtm' } });
    expect(screen.getByLabelText('Integration 1 measurement id')).toHaveValue('');
  });

  it('unchecking every category reverts to the default (never an empty/bricked set)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Functional'));
    fireEvent.click(screen.getByLabelText('Analytics'));
    fireEvent.click(screen.getByLabelText('Marketing'));
    expect(screen.getByLabelText('Functional')).toBeChecked();
    expect(screen.getByLabelText('Analytics')).toBeChecked();
    expect(screen.getByLabelText('Marketing')).toBeChecked();
  });

  it('"Re-ask everyone" bumps the version label', () => {
    render(<Harness consent={{ version: 3 }} />);
    expect(screen.getByRole('button', { name: /Re-ask everyone \(v3\)/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Re-ask everyone/ }));
    expect(screen.getByRole('button', { name: /Re-ask everyone \(v4\)/ })).toBeInTheDocument();
  });
});
