import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { DEFAULT_FORM_MODES } from '@sitewright/schema';
import type { InstanceSettingsInput, InstanceSettingsPublic } from '../src/api';

// Mock the API module so the view's load/save go through spies.
const getInstanceSettings = vi.fn();
const putInstanceSettings = vi.fn();
const testInstanceSmtp = vi.fn();
const sendInstanceSmtpTest = vi.fn();
const undeliveredInstanceSubmissions = vi.fn();
const testStockKey = vi.fn();
// Rank tracking has its own tests (Rankings.test.tsx); here only its save is wired into this one.
const rankSave = vi.hoisted(() => vi.fn());
const rankValidate = vi.hoisted(() => vi.fn());
// The search engine accounts have their own tests (WebmasterAccountsSettings.test.tsx); here only the save wiring.
const webmasterSave = vi.hoisted(() => vi.fn());
const webmasterValidate = vi.hoisted(() => vi.fn());
// When each section has read its own data (it calls `onReady`): resolved at once unless a test holds it back.
const sectionReady = vi.hoisted(() => ({ rank: Promise.resolve(), webmaster: Promise.resolve() }));
vi.mock('../src/views/settings/WebmasterAccountsSettings', async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import('react');
  return {
    WebmasterAccountsSettings: forwardRef(function WebmasterStub({ onReady }: { onReady?: () => void }, ref) {
      useImperativeHandle(ref, () => ({ save: () => webmasterSave(), validate: () => webmasterValidate() }));
      useEffect(() => void sectionReady.webmaster.then(() => onReady?.()), []);
      return <fieldset aria-label="Search engine accounts" />;
    }),
  };
});
vi.mock('../src/views/settings/RankTrackingSettings', async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import('react');
  return {
    RankTrackingSettings: forwardRef(function RankStub({ onReady }: { onReady?: () => void }, ref) {
      useImperativeHandle(ref, () => ({ save: () => rankSave(), validate: () => rankValidate() }));
      useEffect(() => void sectionReady.rank.then(() => onReady?.()), []);
      return <fieldset aria-label="Keyword rank tracking" />;
    }),
  };
});
// The instance-wide token list has its own tests; here it only has to open and close.
vi.mock('../src/views/settings/MemberTokensAdminModal', () => ({
  MemberTokensAdminModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Member tokens">
      <button onClick={onClose}>close tokens</button>
    </div>
  ),
}));
vi.mock('../src/api', () => ({
  api: {
    getInstanceSettings: () => getInstanceSettings(),
    putInstanceSettings: (body: InstanceSettingsInput) => putInstanceSettings(body),
    testInstanceSmtp: () => testInstanceSmtp(),
    undeliveredInstanceSubmissions: () => undeliveredInstanceSubmissions(),
    sendInstanceSmtpTest: (to?: string) => sendInstanceSmtpTest(to),
    testStockKey: (body: { provider: string; key?: string }) => testStockKey(body),
  },
}));

import { InstanceSettings } from '../src/views/InstanceSettings';

const DEFAULTS: InstanceSettingsPublic = {
  formModes: DEFAULT_FORM_MODES, paymentsEnabled: false,
};

beforeEach(() => {
  getInstanceSettings.mockReset();
  putInstanceSettings.mockReset();
  undeliveredInstanceSubmissions.mockReset();
  testStockKey.mockReset();
  undeliveredInstanceSubmissions.mockResolvedValue({ count: 0, lastError: null }); // nothing owed by default
  putInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
  rankSave.mockReset();
  rankSave.mockResolvedValue(undefined);
  rankValidate.mockReset();
  rankValidate.mockReturnValue(null);
  webmasterSave.mockReset();
  webmasterSave.mockResolvedValue(undefined);
  webmasterValidate.mockReset();
  webmasterValidate.mockReturnValue(null);
  sectionReady.rank = Promise.resolve();
  sectionReady.webmaster = Promise.resolve();
});

describe('InstanceSettings opened by a link (a Statistics setup guide)', () => {
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('opens on the General tab by default, and scrolls nowhere', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<InstanceSettings />);
    expect(await screen.findByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByRole('group', { name: 'Search engine accounts' })).toBeInTheDocument());
    expect(scroll).not.toHaveBeenCalled();
  });

  it('opens on Integrations and brings the named section into view, once', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    render(<InstanceSettings initialTab="integrations" focusSection="rank-tracking" />);
    expect(await screen.findByRole('tab', { name: 'Integrations' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(scrolled).toHaveLength(1));
    expect(scrolled[0]).toHaveAttribute('id', 'system-settings-rank-tracking');
    expect(within(scrolled[0] as HTMLElement).getByRole('group', { name: 'Keyword rank tracking' })).toBeInTheDocument();
    // Outlined for a moment, so the eye lands on it.
    expect(scrolled[0]).toHaveAttribute('data-sw-reveal');
  });

  it('does not jump later for someone who went to another tab meanwhile', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    let rankDone!: () => void;
    sectionReady.rank = new Promise((resolve) => (rankDone = resolve));
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    render(<InstanceSettings initialTab="integrations" focusSection="rank-tracking" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'General' }));
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    rankDone();
    await new Promise((r) => setTimeout(r, 30));
    fireEvent.click(screen.getByRole('tab', { name: 'Integrations' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(scrolled).toHaveLength(0);
  });

  it('★ waits for the section ABOVE the accounts before scrolling to them (a late answer would push them away)', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    let rankDone!: () => void;
    sectionReady.rank = new Promise((resolve) => (rankDone = resolve));
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    render(<InstanceSettings initialTab="integrations" focusSection="search-engine-accounts" />);
    await screen.findByRole('group', { name: 'Search engine accounts' });
    await new Promise((r) => setTimeout(r, 30));
    expect(scrolled).toHaveLength(0);
    rankDone();
    await waitFor(() => expect(scrolled).toHaveLength(1));
    expect(scrolled[0]).toHaveAttribute('id', 'system-settings-search-engine-accounts');
  });
});

describe('InstanceSettings', () => {
  it('loads settings and renders the form-mode toggles', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    expect(await screen.findByLabelText('Global SMTP')).toBeInTheDocument();
    expect(screen.getByLabelText('Project SMTP')).toBeInTheDocument();
    expect(screen.getByLabelText('contact.php')).toBeInTheDocument();
    expect(screen.getByLabelText('Third-party')).toBeInTheDocument();
  });

  it('renders the revision-history fields (coalesce shown in seconds) and defaults to 0s / 90 days', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    expect(await screen.findByLabelText('Revision coalesce window in seconds')).toHaveValue(0);
    expect(screen.getByLabelText('Revision retention in days')).toHaveValue(90);
  });

  it('loads + saves the revision settings: coalesce seconds→ms, retention days, default→null revert', async () => {
    getInstanceSettings.mockResolvedValue({ settings: { ...DEFAULTS, revisionCoalesceMs: 60_000, revisionRetentionDays: 45 } });
    render(<InstanceSettings />);
    const coalesce = await screen.findByLabelText('Revision coalesce window in seconds');
    expect(coalesce).toHaveValue(60); // 60_000 ms → 60 s
    expect(screen.getByLabelText('Revision retention in days')).toHaveValue(45);

    fireEvent.change(coalesce, { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Revision retention in days'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    const body = putInstanceSettings.mock.calls[0]![0] as InstanceSettingsInput;
    expect(body.revisionCoalesceMs).toBe(120_000); // 120 s → ms
    expect(body.revisionRetentionDays).toBeNull(); // back to the 90-day default → null (revert)
  });

  it('hides the real-mail test until SMTP is actually SAVED, not merely switched on', async () => {
    // ★ Both tests run against the STORED settings. Before a save there is nothing stored, so the
    // send can only fail — and it fails in a way that reads as "my server details are wrong" rather
    // than "I have not saved yet". The explainer that used to say so is gone; the control is simply
    // not offered until it can work.
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    fireEvent.click(await screen.findByLabelText('Global SMTP'));
    fireEvent.click(screen.getByLabelText('Configure global SMTP'));

    // Switched on, filled in, NOT saved: no send, no recipient box.
    fireEvent.change(await screen.findByLabelText('SMTP host'), { target: { value: 'smtp.acme.com' } });
    fireEvent.change(screen.getByLabelText('SMTP from email'), { target: { value: 'a@acme.com' } });
    expect(screen.queryByRole('button', { name: 'Send test message' })).toBeNull();
    expect(screen.queryByLabelText('Test message recipient')).toBeNull();
    // "Test connection" stays: it sends nothing, and reporting "not configured" is a useful answer.
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeInTheDocument();

    // After a save that stores SMTP, the send appears without a reload.
    putInstanceSettings.mockResolvedValue({
      settings: { ...DEFAULTS, smtp: { host: 'smtp.acme.com', port: 587, secure: false, fromEmail: 'a@acme.com', hasPassword: false } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByRole('button', { name: 'Send test message' })).toBeInTheDocument();
    expect(screen.getByLabelText('Test message recipient')).toBeInTheDocument();
  });

  it('offers the real-mail test straight away when SMTP was already stored', async () => {
    getInstanceSettings.mockResolvedValue({
      settings: { ...DEFAULTS, smtp: { host: 'smtp.acme.com', port: 587, secure: false, fromEmail: 'a@acme.com', hasPassword: true } },
    });
    render(<InstanceSettings />);
    fireEvent.click(await screen.findByLabelText('Global SMTP'));
    expect(await screen.findByRole('button', { name: 'Send test message' })).toBeInTheDocument();
  });

  it('saves the platform AI assistant config (provider/model/key/limit/admins)', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    fireEvent.click(await screen.findByLabelText('Enable the AI assistant platform-wide'));
    fireEvent.change(screen.getByLabelText('AI provider'), { target: { value: 'openai' } });
    fireEvent.change(screen.getByLabelText('AI base URL'), { target: { value: 'https://api.openai.com/v1' } });
    fireEvent.change(screen.getByLabelText('AI model'), { target: { value: 'gpt-4o-mini' } });
    fireEvent.change(screen.getByLabelText('AI API key'), { target: { value: 'sk-plat' } });
    fireEvent.change(screen.getByLabelText('Default per-project monthly token cap'), { target: { value: '100000' } });
    fireEvent.click(screen.getByLabelText('Admins bypass token caps')); // toggle off (default was true)
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalled());
    const body = putInstanceSettings.mock.calls[0]![0] as InstanceSettingsInput;
    expect(body.ai).toMatchObject({
      enabled: true,
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-plat',
      defaultProjectMonthlyTokens: 100000,
      adminsUnlimited: false,
    });
  });

  it('saves a toggled form mode and clears disabled sections to null', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    const globalSmtp = await screen.findByLabelText('Global SMTP');
    fireEvent.click(globalSmtp);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    const body = putInstanceSettings.mock.calls[0]![0] as InstanceSettingsInput;
    expect(body.formModes).toEqual({ ...DEFAULT_FORM_MODES, globalSmtp: true });
    // SMTP was never enabled → explicitly cleared. (Captcha is no longer an instance setting: it
    // moved to the project, so this body must carry nothing about it at all.)
    expect(body.smtp).toBeNull();
    expect(body).not.toHaveProperty('hcaptcha');
    expect(body).not.toHaveProperty('captcha');
  });

  it('saves rank tracking after the rest, and reports its refusal like any other', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    await screen.findByLabelText('Global SMTP');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(rankSave).toHaveBeenCalledTimes(1));
    expect(putInstanceSettings.mock.invocationCallOrder[0]!).toBeLessThan(rankSave.mock.invocationCallOrder[0]!);

    rankSave.mockRejectedValueOnce(new Error('Enter the DataForSEO API password'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('The other settings were saved, but rank tracking was not: Enter the DataForSEO API password')).toBeInTheDocument();
  });

  it('saves the search engine accounts too, even when rank tracking refuses, and names each refusal', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    await screen.findByLabelText('Global SMTP');
    rankSave.mockRejectedValueOnce(new Error('Enter the DataForSEO API password'));
    webmasterSave.mockRejectedValueOnce(new Error('Bing refused'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(
      await screen.findByText(
        'The other settings were saved, but rank tracking was not: Enter the DataForSEO API password; the search engine accounts were not: Bing refused',
      ),
    ).toBeInTheDocument();
    expect(putInstanceSettings.mock.invocationCallOrder[0]!).toBeLessThan(webmasterSave.mock.invocationCallOrder[0]!);
  });

  it('a mistake in the search engine accounts stops the save before anything is stored', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    webmasterValidate.mockReturnValue('That file is not a Google service-account key: it is not JSON.');
    render(<InstanceSettings />);
    await screen.findByLabelText('Global SMTP');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('That file is not a Google service-account key: it is not JSON.')).toBeInTheDocument();
    expect(putInstanceSettings).not.toHaveBeenCalled();
    expect(webmasterSave).not.toHaveBeenCalled();
  });

  it('a mistake in the rank-tracking form stops the save before anything is stored', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    rankValidate.mockReturnValue('The rank-tracking budget must be a number of dollars, 0 or more.');
    render(<InstanceSettings />);
    await screen.findByLabelText('Global SMTP');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('The rank-tracking budget must be a number of dollars, 0 or more.')).toBeInTheDocument();
    expect(putInstanceSettings).not.toHaveBeenCalled();
    expect(rankSave).not.toHaveBeenCalled();
  });

  it('omits the password when an SMTP edit leaves it blank, but sends it when filled', async () => {
    const withSmtp: InstanceSettingsPublic = {
      formModes: DEFAULTS.formModes, paymentsEnabled: false,
      smtp: { host: 'smtp.acme.com', port: 587, secure: false, fromEmail: 'a@acme.com', hasPassword: true },
    };
    getInstanceSettings.mockResolvedValue({ settings: withSmtp });
    // Each save re-hydrates from the response; keep SMTP present so the section stays.
    putInstanceSettings.mockResolvedValue({ settings: withSmtp });
    render(<InstanceSettings />);
    // The SMTP section is already enabled (settings.smtp present).
    expect(await screen.findByLabelText('SMTP host')).toHaveValue('smtp.acme.com');

    // Save without touching the password → password omitted (retain server-side).
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    let body = putInstanceSettings.mock.calls[0]![0] as InstanceSettingsInput;
    expect(body.smtp).toMatchObject({ host: 'smtp.acme.com', port: 587, fromEmail: 'a@acme.com' });
    expect(body.smtp && 'password' in body.smtp).toBe(false);

    // Now type a password and save → it is included.
    fireEvent.change(screen.getByLabelText('SMTP password'), { target: { value: 'new-pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(2));
    body = putInstanceSettings.mock.calls[1]![0] as InstanceSettingsInput;
    expect(body.smtp).toMatchObject({ password: 'new-pw' });
  });

  it('sends a stock key when entered and clears stock to null when disabled', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    // Enable the stock section, type an Unsplash key, save → key is sent.
    fireEvent.click(await screen.findByLabelText('Configure stock provider keys'));
    fireEvent.change(screen.getByLabelText('Unsplash access key'), { target: { value: 'unsplash-abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    let body = putInstanceSettings.mock.calls[0]![0] as InstanceSettingsInput;
    expect(body.stock).toEqual({ unsplash: 'unsplash-abc' });

    // Re-hydrate kept stock disabled (DEFAULTS has no stock) → toggling off sends null.
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(2));
    body = putInstanceSettings.mock.calls[1]![0] as InstanceSettingsInput;
    expect(body.stock).toBeNull();
  });

  it('offers a key field per keyed provider and sends only the ones typed', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    fireEvent.click(await screen.findByLabelText('Configure stock provider keys'));
    // Exactly one field per KEYED provider, in order — openverse is keyless and gets none.
    // (Matched on the inputs themselves: the section's help tooltip also mentions Openverse, and
    // DaisyUI tooltip text folds into the accessible name of the control that contains it.)
    const section = screen.getByLabelText('Configure stock provider keys').closest('fieldset')!;
    expect([...section.querySelectorAll('input[type="password"]')].map((f) => f.getAttribute('aria-label'))).toEqual([
      'Unsplash access key',
      'Pexels API key',
      'Pixabay API key',
    ]);
    fireEvent.change(screen.getByLabelText('Pixabay API key'), { target: { value: 'pixabay-xyz' } });
    fireEvent.change(screen.getByLabelText('Pexels API key'), { target: { value: 'pexels-def' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    const body = putInstanceSettings.mock.calls[0]![0] as InstanceSettingsInput;
    expect(body.stock).toEqual({ pexels: 'pexels-def', pixabay: 'pixabay-xyz' });
  });

  it('tests each provider key independently — the verdict lands on the field that was tested', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    testStockKey.mockResolvedValue({ ok: false, error: 'provider request failed (400)' });
    render(<InstanceSettings />);
    fireEvent.click(await screen.findByLabelText('Configure stock provider keys'));
    fireEvent.change(screen.getByLabelText('Pixabay API key'), { target: { value: 'bad-key' } });
    const pixabayField = screen.getByLabelText('Pixabay API key').closest('label')!;
    fireEvent.click(within(pixabayField).getByRole('button', { name: 'Test' }));
    await waitFor(() => expect(testStockKey).toHaveBeenCalledWith({ provider: 'pixabay', key: 'bad-key' }));
    // The failure is rendered beside Pixabay, not smeared across every provider's field.
    await within(pixabayField).findByText(/provider request failed \(400\)/);
    const unsplashField = screen.getByLabelText('Unsplash access key').closest('label')!;
    expect(within(unsplashField).queryByText(/provider request failed/)).toBeNull();
  });

  it('keeps an existing key (placeholder) and omits it when left blank', async () => {
    const withStock: InstanceSettingsPublic = {
      formModes: DEFAULTS.formModes, paymentsEnabled: false,
      stock: { hasUnsplash: true, hasPexels: false, hasPixabay: false },
    };
    getInstanceSettings.mockResolvedValue({ settings: withStock });
    putInstanceSettings.mockResolvedValue({ settings: withStock });
    render(<InstanceSettings />);
    // Section is pre-enabled (settings.stock present); save without typing → empty merge object (keep).
    const unsplash = await screen.findByLabelText('Unsplash access key');
    expect(unsplash).toHaveAttribute('placeholder', expect.stringContaining('leave blank to keep'));
    // A provider with NO stored key shows a blank field, not the "keep" placeholder.
    expect(screen.getByLabelText('Pixabay API key')).toHaveAttribute('placeholder', '');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    const body = putInstanceSettings.mock.calls[0]![0] as InstanceSettingsInput;
    expect(body.stock).toEqual({}); // no keys provided → merge keeps stored ones
  });

  it('hydrates the agent session length, sends the changed number, and reverts to default as null', async () => {
    getInstanceSettings.mockResolvedValue({ settings: { ...DEFAULTS, agentSessionHours: 24 } });
    // Each save re-hydrates from the response; echo 48 so the second edit (→ 8) is a real change.
    putInstanceSettings.mockResolvedValue({ settings: { ...DEFAULTS, agentSessionHours: 48 } });
    render(<InstanceSettings />);
    const input = await screen.findByLabelText('Agent session hours');
    expect(input).toHaveValue(24);

    // Change it → the new number is sent.
    fireEvent.change(input, { target: { value: '48' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    expect((putInstanceSettings.mock.calls[0]![0] as InstanceSettingsInput).agentSessionHours).toBe(48);

    // Back to the built-in default (8h) → sent as null so the stored override is cleared.
    fireEvent.change(input, { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(2));
    expect((putInstanceSettings.mock.calls[1]![0] as InstanceSettingsInput).agentSessionHours).toBeNull();
  });

  it('★ member tokens: hydrates the daily project maximum, saves a change, clamps it, and reverts the default as null', async () => {
    getInstanceSettings.mockResolvedValue({ settings: { ...DEFAULTS, memberTokenDailyProjectMax: 20 } });
    // The form re-hydrates from what the server says it stored.
    putInstanceSettings.mockResolvedValueOnce({ settings: { ...DEFAULTS, memberTokenDailyProjectMax: 5 } });
    render(<InstanceSettings />);
    const field = await screen.findByLabelText('Maximum new projects per member token per day');
    expect(field).toHaveValue(20);

    fireEvent.change(field, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    expect((putInstanceSettings.mock.calls[0]![0] as InstanceSettingsInput).memberTokenDailyProjectMax).toBe(5);

    // Out of range is clamped to what the server accepts rather than sent and refused.
    fireEvent.change(field, { target: { value: '999999' } });
    fireEvent.blur(field);
    expect(field).toHaveValue(1000);
    // Zero tightens to the smallest allowed value — it must never spring back to the default of 50.
    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.blur(field);
    expect(field).toHaveValue(1);
    // Back to the built-in default → null, so the instance follows the default if it ever changes.
    fireEvent.change(field, { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(2));
    expect((putInstanceSettings.mock.calls[1]![0] as InstanceSettingsInput).memberTokenDailyProjectMax).toBeNull();
  });

  it('member tokens: defaults to 50, is not sent when untouched, and opens the instance-wide list', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    expect(await screen.findByLabelText('Maximum new projects per member token per day')).toHaveValue(50);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    expect(putInstanceSettings.mock.calls[0]![0]).not.toHaveProperty('memberTokenDailyProjectMax');

    expect(screen.queryByRole('dialog', { name: 'Member tokens' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View all member tokens' }));
    expect(screen.getByRole('dialog', { name: 'Member tokens' })).toBeInTheDocument();
    // Opening the list is not a save.
    expect(putInstanceSettings).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'close tokens' }));
    expect(screen.queryByRole('dialog', { name: 'Member tokens' })).toBeNull();
  });

  it('new projects: the image size cap defaults to 2400, is not sent untouched, and saves a width, "No cap" or a revert', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    // The form re-hydrates from what the server says it stored, so echo the cap the way it merges it.
    let stored: number | undefined;
    putInstanceSettings.mockImplementation(async (body: InstanceSettingsInput) => {
      if (body.defaultImageUploadCap !== undefined) stored = body.defaultImageUploadCap ?? undefined;
      return { settings: { ...DEFAULTS, ...(stored !== undefined ? { defaultImageUploadCap: stored } : {}) } };
    });
    render(<InstanceSettings />);
    const field = await screen.findByLabelText('Default image size cap in pixels');
    const uncapped = screen.getByRole('checkbox', { name: 'No cap' });
    expect(field).toHaveValue(2400);
    expect(uncapped).not.toBeChecked();
    const save = async (n: number) => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
      await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(n));
      return putInstanceSettings.mock.calls[n - 1]![0] as InstanceSettingsInput;
    };
    // Untouched → not sent, so an unrelated save never writes the default as an override.
    expect(await save(1)).not.toHaveProperty('defaultImageUploadCap');

    fireEvent.change(field, { target: { value: '1600' } });
    expect((await save(2)).defaultImageUploadCap).toBe(1600);

    // Out of range is clamped to what a project's own cap accepts, rather than sent and refused.
    fireEvent.change(field, { target: { value: '50' } });
    fireEvent.blur(field);
    expect(field).toHaveValue(200);

    // "No cap" is stored as 0 and disables the width, which it overrides.
    fireEvent.click(uncapped);
    expect(field).toBeDisabled();
    expect((await save(3)).defaultImageUploadCap).toBe(0);

    // Back to the default width → null, so the instance follows the built-in default.
    fireEvent.click(uncapped);
    fireEvent.change(field, { target: { value: '2400' } });
    expect((await save(4)).defaultImageUploadCap).toBeNull();
  });

  it('new projects: hydrates a stored image cap, and a stored 0 as "No cap"', async () => {
    getInstanceSettings.mockResolvedValueOnce({ settings: { ...DEFAULTS, defaultImageUploadCap: 1200 } });
    const { unmount } = render(<InstanceSettings />);
    expect(await screen.findByLabelText('Default image size cap in pixels')).toHaveValue(1200);
    expect(screen.getByRole('checkbox', { name: 'No cap' })).not.toBeChecked();
    unmount();

    getInstanceSettings.mockResolvedValueOnce({ settings: { ...DEFAULTS, defaultImageUploadCap: 0 } });
    render(<InstanceSettings />);
    const field = await screen.findByLabelText('Default image size cap in pixels');
    expect(screen.getByRole('checkbox', { name: 'No cap' })).toBeChecked();
    expect(field).toBeDisabled();
    // Unchanged → not sent: re-saving must not turn "No cap" into the default.
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    expect(putInstanceSettings.mock.calls[0]![0]).not.toHaveProperty('defaultImageUploadCap');
  });

  it('does not touch agentSessionHours when the admin never edits it', async () => {
    getInstanceSettings.mockResolvedValue({ settings: { ...DEFAULTS, agentSessionHours: 24 } });
    render(<InstanceSettings />);
    await screen.findByLabelText('Agent session hours');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    const body = putInstanceSettings.mock.calls[0]![0] as InstanceSettingsInput;
    expect('agentSessionHours' in body).toBe(false);
  });

  it('surfaces a save error (e.g. 503 when no encryption key)', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    putInstanceSettings.mockRejectedValue(new Error('secret storage is not configured (set SW_ENCRYPTION_KEY)'));
    render(<InstanceSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText(/secret storage is not configured/)).toBeInTheDocument();
  });

  it('surfaces a load failure instead of rendering the form', async () => {
    getInstanceSettings.mockRejectedValue(new Error('forbidden'));
    render(<InstanceSettings />);
    expect(await screen.findByText('forbidden')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
  });

  it('adds an OIDC provider and saves it (with the typed secret) in oidcProviders', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add provider' }));
    fireEvent.change(screen.getByLabelText('Provider 1 id'), { target: { value: 'google' } });
    fireEvent.change(screen.getByLabelText('Provider 1 label'), { target: { value: 'Google' } });
    fireEvent.change(screen.getByLabelText('Provider 1 issuer'), { target: { value: 'https://accounts.google.com' } });
    fireEvent.change(screen.getByLabelText('Provider 1 client id'), { target: { value: 'cid' } });
    fireEvent.change(screen.getByLabelText('Provider 1 client secret'), { target: { value: 'csecret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    const body = putInstanceSettings.mock.calls[0]![0] as InstanceSettingsInput;
    expect(body.oidcProviders).toEqual([
      { id: 'google', label: 'Google', issuer: 'https://accounts.google.com', clientId: 'cid', scopes: ['openid', 'profile', 'email'], enabled: true, usePkce: true, clientSecret: 'csecret' },
    ]);
  });

  it('hydrates and saves the per-provider PKCE toggle', async () => {
    const withProvider: InstanceSettingsPublic = {
      formModes: DEFAULTS.formModes, paymentsEnabled: false,
      oidcProviders: [
        { id: 'acme', label: 'Acme', issuer: 'https://idp.example.com', clientId: 'cid', scopes: ['openid', 'email'], enabled: true, hasClientSecret: true, usePkce: true },
      ],
    };
    getInstanceSettings.mockResolvedValue({ settings: withProvider });
    putInstanceSettings.mockResolvedValue({ settings: withProvider });
    render(<InstanceSettings />);
    // Hydrated state: PKCE on.
    const pkce = await screen.findByLabelText('Provider 1 use PKCE');
    expect(pkce).toBeChecked();
    // Flip it, then save → the new value is sent.
    fireEvent.click(pkce);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    const body = putInstanceSettings.mock.calls[0]![0] as InstanceSettingsInput;
    expect(body.oidcProviders?.[0]).toMatchObject({ id: 'acme', usePkce: false });
  });

  it('"Add provider" works in an insecure context where crypto.randomUUID is unavailable', async () => {
    // The plain-HTTP DinD/preview host has no crypto.randomUUID; using it threw and made "Add" a
    // no-op. Simulate that here so a regression (reusing crypto.randomUUID for the row key) fails.
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('randomUUID is not available in an insecure context');
    });
    try {
      getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
      render(<InstanceSettings />);
      fireEvent.click(await screen.findByRole('button', { name: 'Add provider' }));
      // The new provider row renders (its id field appears) — proving Add didn't throw.
      expect(await screen.findByLabelText('Provider 1 id')).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('InstanceSettings — branding', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastPayload = () => putInstanceSettings.mock.calls[0]![0] as any;

  it('renders the Branding fieldset (name input + the two reused color pickers)', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    expect(await screen.findByText('Branding')).toBeInTheDocument();
    expect(screen.getByLabelText('Platform name')).toBeInTheDocument();
    expect(screen.getByLabelText('Edit Primary color')).toBeInTheDocument(); // ColorField reuse
    expect(screen.getByLabelText('Edit Secondary color')).toBeInTheDocument();
  });

  it('sends a changed platform name in the PUT payload', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    await screen.findByText('Branding');
    fireEvent.change(screen.getByLabelText('Platform name'), { target: { value: 'Acme CMS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    expect(lastPayload().platformName).toBe('Acme CMS');
  });

  it('stages an uploaded PNG as a base64 {mime,data} logo in the payload', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    await screen.findByText('Branding');
    const file = new File([Uint8Array.from([1, 2, 3, 4])], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload logo'), { target: { files: [file] } });
    // FileReader is async — the staged draft surfaces a Remove button.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    expect(lastPayload().platformLogo).toMatchObject({ mime: 'image/png' });
    expect(typeof lastPayload().platformLogo.data).toBe('string');
  });

  it('sends platformLogo: null when an existing logo is removed', async () => {
    getInstanceSettings.mockResolvedValue({ settings: { ...DEFAULTS, hasLogo: true } });
    render(<InstanceSettings />);
    await screen.findByText('Branding');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalledTimes(1));
    expect(lastPayload().platformLogo).toBeNull();
  });
});

describe('instance SMTP connection test', () => {
  // The admin's only signal that instance mail is broken: form delivery is best-effort, so a dead
  // SMTP otherwise shows up as leads quietly not arriving.
  it('surfaces the server\u2019s reason for a failed connection', async () => {
    getInstanceSettings.mockResolvedValue({
      settings: { ...DEFAULTS, smtp: { host: 'smtp.acme.com', port: 587, secure: false, fromEmail: 'a@b.co', hasPassword: true } },
    });
    testInstanceSmtp.mockResolvedValue({ ok: false, error: 'The server at smtp.acme.com:587 does not offer STARTTLS' });
    render(<InstanceSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(/does not offer STARTTLS/)).toBeInTheDocument();
  });

  it('confirms a healthy connection', async () => {
    getInstanceSettings.mockResolvedValue({
      settings: { ...DEFAULTS, smtp: { host: 'smtp.acme.com', port: 587, secure: false, fromEmail: 'a@b.co', hasPassword: true } },
    });
    testInstanceSmtp.mockResolvedValue({ ok: true });
    render(<InstanceSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(/Connected/)).toBeInTheDocument();
  });
});

describe('instance SMTP send test message', () => {
  const withSmtp = { settings: { ...DEFAULTS, smtp: { host: 'smtp.acme.com', port: 587, secure: false, fromEmail: 'a@b.co', hasPassword: true } } };

  it('sends to the admin’s own address when the field is left blank', async () => {
    getInstanceSettings.mockResolvedValue(withSmtp);
    sendInstanceSmtpTest.mockResolvedValue({ ok: true, to: 'admin@acme.test' });
    render(<InstanceSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send test message' }));
    await waitFor(() => expect(sendInstanceSmtpTest).toHaveBeenCalledWith(undefined));
    expect(await screen.findByText(/Sent to admin@acme.test/)).toBeInTheDocument();
  });

  it('sends to a typed address — admins are the ones diagnosing deliverability', async () => {
    getInstanceSettings.mockResolvedValue(withSmtp);
    sendInstanceSmtpTest.mockResolvedValue({ ok: true, to: 'someone@else.test' });
    render(<InstanceSettings />);
    fireEvent.change(await screen.findByLabelText('Test message recipient'), { target: { value: 'someone@else.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send test message' }));
    await waitFor(() => expect(sendInstanceSmtpTest).toHaveBeenCalledWith('someone@else.test'));
  });
});

describe('instance SMTP send-test failure', () => {
  it('reports a thrown request rather than leaving the operator guessing', async () => {
    getInstanceSettings.mockResolvedValue({
      settings: { ...DEFAULTS, smtp: { host: 'smtp.acme.com', port: 587, secure: false, fromEmail: 'a@b.co', hasPassword: true } },
    });
    sendInstanceSmtpTest.mockRejectedValue(new Error('no instance SMTP is configured'));
    render(<InstanceSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send test message' }));
    expect(await screen.findByText(/no instance SMTP is configured/)).toBeInTheDocument();
  });
});

describe('instance-wide undelivered warning', () => {
  it('★ tells the admin how many submissions across ALL projects were not emailed', async () => {
    // A broken global SMTP breaks every project at once, and this is the screen where it gets fixed.
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    undeliveredInstanceSubmissions.mockResolvedValue({ count: 7, lastError: 'The mail server refused the connection.' });
    render(<InstanceSettings />);
    expect(await screen.findByText(/7 form submissions across all projects could not be emailed/)).toBeInTheDocument();
  });

  it('a failing count never blocks the settings screen', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    undeliveredInstanceSubmissions.mockRejectedValue(new Error('offline'));
    render(<InstanceSettings />);
    // The screen still renders; only the count is missing.
    expect(await screen.findByLabelText('Configure global SMTP')).toBeInTheDocument();
    expect(screen.queryByText(/could not be emailed/)).toBeNull();
  });

  it('embedding: hidden until enabled, then adds a valid origin and saves it', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    const toggle = await screen.findByLabelText('Allow embedding');
    // The allowlist controls only exist once framing is opted into.
    expect(screen.queryByLabelText('Origin to allow')).toBeNull();
    fireEvent.click(toggle);

    const input = screen.getByLabelText('Origin to allow');
    fireEvent.change(input, { target: { value: 'https://intranet.acme.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add origin' }));
    expect(await screen.findByText('https://intranet.acme.test')).toBeInTheDocument();
    expect(input).toHaveValue(''); // cleared, ready for the next one

    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalled());
    const body = putInstanceSettings.mock.calls.at(-1)![0] as InstanceSettingsInput;
    expect(body.embedding).toEqual({ enabled: true, origins: ['https://intranet.acme.test'], allowSelf: false });
  });

  it('embedding: rejects a CSP-injecting origin with the SERVER\'s own message, and never adds it', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    fireEvent.click(await screen.findByLabelText('Allow embedding'));
    const input = screen.getByLabelText('Origin to allow');
    fireEvent.change(input, { target: { value: 'https://evil.test; default-src *' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add origin' }));
    expect(await screen.findByText(/scheme:\/\/host/)).toBeInTheDocument();
    expect(screen.queryByText('https://evil.test; default-src *')).toBeNull();
  });

  it('embedding: Enter adds the origin instead of submitting the whole settings form', async () => {
    getInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
    render(<InstanceSettings />);
    fireEvent.click(await screen.findByLabelText('Allow embedding'));
    const input = screen.getByLabelText('Origin to allow');
    fireEvent.change(input, { target: { value: 'https://a.test' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('https://a.test')).toBeInTheDocument();
    // A half-entered allowlist must not be persisted by a stray Enter.
    expect(putInstanceSettings).not.toHaveBeenCalled();
  });

  it('embedding: hydrates a stored policy and can remove an origin', async () => {
    getInstanceSettings.mockResolvedValue({
      settings: { ...DEFAULTS, embedding: { enabled: true, origins: ['https://a.test', 'https://b.test'], allowSelf: true } },
    });
    render(<InstanceSettings />);
    expect(await screen.findByText('https://a.test')).toBeInTheDocument();
    expect(screen.getByLabelText('Allow same-origin framing')).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Remove https://a.test' }));
    await waitFor(() => expect(screen.queryByText('https://a.test')).toBeNull());
    expect(screen.getByText('https://b.test')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(putInstanceSettings).toHaveBeenCalled());
    const body = putInstanceSettings.mock.calls.at(-1)![0] as InstanceSettingsInput;
    expect(body.embedding).toEqual({ enabled: true, origins: ['https://b.test'], allowSelf: true });
  });
});
