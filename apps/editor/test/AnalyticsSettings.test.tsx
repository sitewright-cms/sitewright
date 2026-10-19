import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ConsentIntegration } from '@sitewright/schema';
import { AnalyticsSettingsModal } from '../src/views/settings/AnalyticsSettingsModal';
import { ConsentIntegrationsEditor } from '../src/views/settings/ConsentIntegrationsEditor';
import { analyticsStatus } from '../src/views/settings/board/summaries';
import type { SettingsForm } from '../src/views/settings/model';

/** A stateful harness so a patch re-renders the modal; it exposes the latest form for assertions. */
let latest: SettingsForm;
function Harness({ consent }: { consent?: Record<string, unknown> }) {
  const [form, setForm] = useState({ consent } as unknown as SettingsForm);
  latest = form;
  return <AnalyticsSettingsModal form={form} patch={(p) => setForm((f) => ({ ...f, ...p }))} onClose={() => {}} />;
}
function EditorHarness({ rows: initial }: { rows: ConsentIntegration[] }) {
  const [rows, setRows] = useState(initial);
  return <ConsentIntegrationsEditor rows={rows} onChange={setRows} />;
}
const GA: ConsentIntegration = { id: 'ga', name: 'GA', category: 'analytics', preset: 'ga4', measurementId: 'G-X' };
const CHAT: ConsentIntegration = { id: 'chat', name: 'Chat', category: 'functional', preset: 'custom', src: 'https://w.example/c.js' };

describe('ConsentIntegrationsEditor — the analytics presets', () => {
  it('★ offers every analytics tool, each with its own identifier field', () => {
    render(<EditorHarness rows={[{ id: 'a', name: 'A', category: 'analytics', preset: 'ga4' }]} />);
    const type = screen.getByLabelText('Integration 1 type');
    const options = within(type).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Google Analytics 4', 'Google Tag Manager', 'Plausible', 'Umami', 'Matomo', 'Fathom', 'Simple Analytics', 'Custom script']);

    fireEvent.change(type, { target: { value: 'plausible' } });
    expect(screen.getByLabelText('Integration 1 site id')).toHaveAttribute('placeholder', expect.stringContaining('pa-'));
    expect(screen.getByLabelText('Integration 1 self-hosted address')).toBeInTheDocument();
    fireEvent.change(type, { target: { value: 'matomo' } });
    expect(screen.getByLabelText('Integration 1 Matomo address')).toBeInTheDocument();
    fireEvent.change(type, { target: { value: 'fathom' } });
    expect(screen.queryByLabelText('Integration 1 self-hosted address')).toBeNull(); // cloud-only
  });

  it('★ offers "load without consent" only for tools that set no cookies', () => {
    render(<EditorHarness rows={[{ id: 'a', name: 'A', category: 'analytics', preset: 'umami' }]} />);
    const box = screen.getByLabelText(/Load without consent/);
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(box).toBeChecked();
    fireEvent.change(screen.getByLabelText('Integration 1 type'), { target: { value: 'ga4' } });
    expect(screen.queryByLabelText(/Load without consent/)).toBeNull();
  });

  it('switching the tool clears the previous tool’s fields, so the save cannot fail on a stale value', () => {
    let seen: ConsentIntegration[] = [];
    render(<ConsentIntegrationsEditor rows={[{ id: 'a', name: 'A', category: 'analytics', preset: 'plausible', siteId: 'pa-X1234', host: 'https://s.example.com', requireConsent: false }]} onChange={(r) => (seen = r)} />);
    fireEvent.change(screen.getByLabelText('Integration 1 type'), { target: { value: 'ga4' } });
    expect(seen[0]).toEqual({ id: 'a', name: 'A', category: 'analytics', preset: 'ga4' });
  });
});

describe('★ AnalyticsSettingsModal', () => {
  it('shows only the analytics tools, and keeps the other integrations when one is added', () => {
    render(<Harness consent={{ enabled: true, integrations: [CHAT, GA] }} />);
    expect(screen.getByLabelText('Integration 1 name')).toHaveValue('GA');
    expect(screen.queryByDisplayValue('Chat')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Add analytics tool' }));
    expect(latest.consent?.integrations?.map((i) => i.id)).toEqual(['chat', 'ga', expect.any(String)]);
  });

  it('warns when a tool waits for consent while the consent banner is off, and turns the banner on', () => {
    render(<Harness consent={{ enabled: false, integrations: [GA] }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('GA');
    fireEvent.click(within(alert).getByRole('button', { name: 'Turn on the consent banner' }));
    expect(latest.consent?.enabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('★ edits rows IN PLACE: the registry keeps its order on every keystroke', () => {
    render(<Harness consent={{ enabled: true, integrations: [GA, CHAT] }} />);
    fireEvent.change(screen.getByLabelText('Integration 1 name'), { target: { value: 'Google' } });
    expect(latest.consent?.integrations?.map((i) => i.id)).toEqual(['ga', 'chat']);
    expect(latest.consent?.integrations?.[0]?.name).toBe('Google');
  });

  it('★ a custom row switched away from the Analytics category stays in view until the modal closes', () => {
    const script: ConsentIntegration = { id: 'own', name: 'Own stats', category: 'analytics', preset: 'custom', src: 'https://s.example/s.js' };
    render(<Harness consent={{ enabled: true, integrations: [script] }} />);
    fireEvent.change(screen.getByLabelText('Integration 1 category'), { target: { value: 'functional' } });
    expect(screen.getByLabelText('Integration 1 name')).toHaveValue('Own stats');
    expect(latest.consent?.integrations).toEqual([{ ...script, category: 'functional' }]);
  });

  it('★ stops offering a new tool where the SHARED 20-integration cap is reached', () => {
    const others = Array.from({ length: 19 }, (_, n): ConsentIntegration => ({ ...CHAT, id: `w${n}` }));
    render(<Harness consent={{ enabled: true, integrations: [...others, GA] }} />);
    expect(screen.queryByRole('button', { name: '+ Add analytics tool' })).toBeNull();
  });

  it('does not count or warn about a half-filled row the save would drop', () => {
    render(<Harness consent={{ enabled: false, integrations: [{ id: 'new', name: '', category: 'analytics', preset: 'ga4' }] }} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('turning the banner on keeps focus in the dialog and says so', () => {
    render(<Harness consent={{ enabled: false, integrations: [GA] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on the consent banner' }));
    expect(screen.getByRole('status')).toHaveTextContent('The consent banner is on');
    expect(screen.getByRole('dialog', { name: 'Analytics' })).toContainElement(document.activeElement as HTMLElement);
  });

  it('does not warn for a cookieless tool that loads without consent', () => {
    render(<Harness consent={{ enabled: false, integrations: [{ id: 'pl', name: 'Plausible', category: 'analytics', preset: 'plausible', siteId: 'pa-X1234', requireConsent: false }] }} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('analyticsStatus (the board tile)', () => {
  const f = (consent: Record<string, unknown> | undefined) => ({ consent }) as unknown as SettingsForm;
  it('reads None, a tool count, or an attention state when a tool can never load', () => {
    expect(analyticsStatus(f(undefined)).label).toBe('None');
    expect(analyticsStatus(f({ enabled: true, integrations: [GA, CHAT] })).label).toBe('1 tool');
    const off = analyticsStatus(f({ enabled: false, integrations: [GA] }));
    expect(off.kind).toBe('attention');
    expect(off.label).toBe('Banner off');
    // A half-filled row is not a tool yet.
    expect(analyticsStatus(f({ enabled: false, integrations: [{ id: 'x', name: 'GA', category: 'analytics', preset: 'ga4' }] })).label).toBe('None');
  });
});
