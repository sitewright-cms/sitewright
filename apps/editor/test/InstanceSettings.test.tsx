import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DEFAULT_FORM_MODES } from '@sitewright/schema';
import type { InstanceSettingsInput, InstanceSettingsPublic } from '../src/api';

// Mock the API module so the view's load/save go through spies.
const getInstanceSettings = vi.fn();
const putInstanceSettings = vi.fn();
const testInstanceSmtp = vi.fn();
const sendInstanceSmtpTest = vi.fn();
const undeliveredInstanceSubmissions = vi.fn();
vi.mock('../src/api', () => ({
  api: {
    getInstanceSettings: () => getInstanceSettings(),
    putInstanceSettings: (body: InstanceSettingsInput) => putInstanceSettings(body),
    testInstanceSmtp: () => testInstanceSmtp(),
    undeliveredInstanceSubmissions: () => undeliveredInstanceSubmissions(),
    sendInstanceSmtpTest: (to?: string) => sendInstanceSmtpTest(to),
  },
}));

import { InstanceSettings } from '../src/views/InstanceSettings';

const DEFAULTS: InstanceSettingsPublic = {
  formModes: DEFAULT_FORM_MODES,
};

beforeEach(() => {
  getInstanceSettings.mockReset();
  putInstanceSettings.mockReset();
  undeliveredInstanceSubmissions.mockReset();
  undeliveredInstanceSubmissions.mockResolvedValue({ count: 0, lastError: null }); // nothing owed by default
  putInstanceSettings.mockResolvedValue({ settings: DEFAULTS });
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

  it('omits the password when an SMTP edit leaves it blank, but sends it when filled', async () => {
    const withSmtp: InstanceSettingsPublic = {
      formModes: DEFAULTS.formModes,
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

  it('keeps an existing key (placeholder) and omits it when left blank', async () => {
    const withStock: InstanceSettingsPublic = {
      formModes: DEFAULTS.formModes,
      stock: { hasUnsplash: true, hasPexels: false },
    };
    getInstanceSettings.mockResolvedValue({ settings: withStock });
    putInstanceSettings.mockResolvedValue({ settings: withStock });
    render(<InstanceSettings />);
    // Section is pre-enabled (settings.stock present); save without typing → empty merge object (keep).
    const unsplash = await screen.findByLabelText('Unsplash access key');
    expect(unsplash).toHaveAttribute('placeholder', expect.stringContaining('leave blank to keep'));
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
      formModes: DEFAULTS.formModes,
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
});

