import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { WebmasterAccountsView } from '@sitewright/schema';

const api = vi.hoisted(() => ({
  getWebmasterAccounts: vi.fn(),
  putWebmasterAccounts: vi.fn(),
  testWebmasterAccount: vi.fn(),
}));
vi.mock('../src/api', () => ({ api }));

import { WebmasterAccountsSettings, type WebmasterAccountsSettingsHandle } from '../src/views/settings/WebmasterAccountsSettings';

const EMAIL = 'sitewright-seo@sitewright-seo-123.iam.gserviceaccount.com';
const KEY_FILE = JSON.stringify({ type: 'service_account', project_id: 'sitewright-seo-123', private_key: '-----BEGIN PRIVATE KEY-----\n…', client_email: EMAIL });
const BING_KEY = '0123456789abcdef0123456789abcdef';

const EMPTY: WebmasterAccountsView = {
  google: { configured: false, clientEmail: null, projectId: null, updatedAt: null },
  bing: { configured: false, updatedAt: null },
};
const STORED: WebmasterAccountsView = {
  google: { configured: true, clientEmail: EMAIL, projectId: 'sitewright-seo-123', updatedAt: '2026-10-21T10:00:00.000Z' },
  bing: { configured: true, updatedAt: '2026-10-21T10:00:00.000Z' },
};

const file = (text: string, name = 'sitewright-seo-123-a1b2c3.json'): File => new File([text], name, { type: 'application/json' });
async function pick(f: File): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Google service-account key file'), { target: { files: [f] } });
  });
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.putWebmasterAccounts.mockImplementation(async () => STORED);
});

describe('WebmasterAccountsSettings', () => {
  it('uploads a key file and a Bing key on save, then shows whose key is stored and never the secrets', async () => {
    api.getWebmasterAccounts.mockResolvedValue(EMPTY);
    const ref = createRef<WebmasterAccountsSettingsHandle>();
    render(<WebmasterAccountsSettings ref={ref} />);
    expect(await screen.findByText(/No key stored/)).toBeInTheDocument();
    for (const b of screen.getAllByRole('button', { name: 'Test saved credentials' })) expect(b).toBeDisabled();

    await pick(file(KEY_FILE));
    expect(screen.getByText(`sitewright-seo-123-a1b2c3.json: the key for ${EMAIL}, stored when you save.`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Bing Webmaster API key'), { target: { value: ` ${BING_KEY} ` } });

    expect(ref.current!.validate()).toBeNull();
    await act(() => ref.current!.save());
    expect(api.putWebmasterAccounts).toHaveBeenCalledWith({ google: { keyFile: KEY_FILE }, bing: { apiKey: BING_KEY } });
    expect(screen.getByText(`Key stored for ${EMAIL} (Google Cloud project sitewright-seo-123).`)).toBeInTheDocument();
    expect(screen.getByLabelText('Bing Webmaster API key')).toHaveValue('');
    expect(screen.getByLabelText('Bing Webmaster API key')).toHaveAttribute('placeholder', '•••••• (leave blank to keep)');
    expect(document.body.textContent).not.toContain('PRIVATE KEY');

    // Nothing changed since: a second save sends nothing.
    await act(() => ref.current!.save());
    expect(api.putWebmasterAccounts).toHaveBeenCalledTimes(1);
  });

  it('names a wrong file at once, keeps nothing from it, and never blocks the rest of the save', async () => {
    api.getWebmasterAccounts.mockResolvedValue(EMPTY);
    const ref = createRef<WebmasterAccountsSettingsHandle>();
    render(<WebmasterAccountsSettings ref={ref} />);
    await screen.findByText(/No key stored/);

    await pick(file('{"installed":{"client_id":"x"}}', 'client_secret.json'));
    const wrongKind = 'That file is not a Google service-account key: create a JSON key on the service account (Keys → Add key).';
    expect(screen.getByText(`${wrongKind} Nothing from it will be saved.`)).toBeInTheDocument();
    // The file was never kept: the settings page can still save, and this card sends nothing.
    expect(ref.current!.validate()).toBeNull();
    await act(() => ref.current!.save());
    expect(api.putWebmasterAccounts).not.toHaveBeenCalled();

    await pick(file('not json'));
    expect(screen.getByText(/^That file is not a Google service-account key: it is not JSON\./)).toBeInTheDocument();
    await pick(file('x'.repeat(17 * 1024)));
    expect(screen.getByText(/^That file is too large to be a Google service-account key\./)).toBeInTheDocument();
    const unreadable = file(KEY_FILE);
    unreadable.text = () => Promise.reject(new Error('NotReadableError'));
    await pick(unreadable);
    expect(screen.getByText(/^That file could not be read\./)).toBeInTheDocument();

    // A good file clears the notice.
    await pick(file(KEY_FILE));
    expect(screen.queryByText(/Nothing from it will be saved/)).toBeNull();

    fireEvent.change(screen.getByLabelText('Bing Webmaster API key'), { target: { value: 'my bing key' } });
    expect(ref.current!.validate()).toMatch(/^The Bing API key is 16 to 128 letters and digits/);
    await expect(ref.current!.save()).rejects.toThrow(/^The Bing API key is 16 to 128 letters and digits/);
    expect(api.putWebmasterAccounts).not.toHaveBeenCalled();
  });

  it('"Remove" also clears a notice about a refused file', async () => {
    api.getWebmasterAccounts.mockResolvedValue(STORED);
    render(<WebmasterAccountsSettings />);
    const google = within(await screen.findByRole('region', { name: 'Google service account' }));
    await pick(file('not json'));
    expect(google.getByText(/Nothing from it will be saved/)).toBeInTheDocument();
    fireEvent.click(google.getByRole('button', { name: 'Remove' }));
    expect(google.queryByText(/Nothing from it will be saved/)).toBeNull();
    expect(google.getByText('The stored key will be removed when you save.')).toBeInTheDocument();
  });

  it('removes a stored key on save, and "Keep it" takes the removal back', async () => {
    api.getWebmasterAccounts.mockResolvedValue(STORED);
    api.putWebmasterAccounts.mockResolvedValue(EMPTY);
    const ref = createRef<WebmasterAccountsSettingsHandle>();
    render(<WebmasterAccountsSettings ref={ref} />);
    const google = within(await screen.findByRole('region', { name: 'Google service account' }));
    const bing = within(screen.getByRole('region', { name: 'Bing Webmaster Tools' }));

    fireEvent.click(google.getByRole('button', { name: 'Remove' }));
    expect(google.getByText('The stored key will be removed when you save.')).toBeInTheDocument();
    fireEvent.click(google.getByRole('button', { name: 'Keep it' }));
    expect(google.getByText(`Key stored for ${EMAIL} (Google Cloud project sitewright-seo-123).`)).toBeInTheDocument();

    fireEvent.click(google.getByRole('button', { name: 'Remove' }));
    fireEvent.click(bing.getByRole('button', { name: 'Remove' }));
    expect(bing.getByText('The stored key will be removed when you save.')).toBeInTheDocument();
    await act(() => ref.current!.save());
    expect(api.putWebmasterAccounts).toHaveBeenCalledWith({ google: null, bing: null });
    expect(await screen.findByText(/No key stored/)).toBeInTheDocument();
  });

  it('discarding a picked file goes back to the stored key, not to removing it', async () => {
    api.getWebmasterAccounts.mockResolvedValue(STORED);
    const ref = createRef<WebmasterAccountsSettingsHandle>();
    render(<WebmasterAccountsSettings ref={ref} />);
    const google = within(await screen.findByRole('region', { name: 'Google service account' }));
    await pick(file(KEY_FILE));
    fireEvent.click(google.getByRole('button', { name: 'Discard file' }));
    expect(google.getByText(`Key stored for ${EMAIL} (Google Cloud project sitewright-seo-123).`)).toBeInTheDocument();
    await act(() => ref.current!.save());
    expect(api.putWebmasterAccounts).not.toHaveBeenCalled();
  });

  it('tests each stored account and shows what it found or why it was refused', async () => {
    api.getWebmasterAccounts.mockResolvedValue(STORED);
    api.testWebmasterAccount.mockImplementation(async (service: string) =>
      service === 'google'
        ? { ok: true, detail: `Connected as ${EMAIL} · 0 sites verified · 0 in Search Console` }
        : { ok: false, error: 'Bing refused the API key' },
    );
    render(<WebmasterAccountsSettings />);
    const google = within(await screen.findByRole('region', { name: 'Google service account' }));
    const bing = within(screen.getByRole('region', { name: 'Bing Webmaster Tools' }));
    fireEvent.click(google.getByRole('button', { name: 'Test saved credentials' }));
    expect(await google.findByText(`✓ Connected as ${EMAIL} · 0 sites verified · 0 in Search Console`)).toBeInTheDocument();
    fireEvent.click(bing.getByRole('button', { name: 'Test saved credentials' }));
    expect(await bing.findByText('✗ Bing refused the API key')).toBeInTheDocument();

    api.testWebmasterAccount.mockRejectedValueOnce(new Error('instance admin access required'));
    fireEvent.click(google.getByRole('button', { name: 'Test saved credentials' }));
    expect(await google.findByText('✗ instance admin access required')).toBeInTheDocument();
  });

  it('says so when the accounts cannot be loaded', async () => {
    api.getWebmasterAccounts.mockRejectedValue(new Error('instance admin access required'));
    render(<WebmasterAccountsSettings />);
    expect(await screen.findByText('instance admin access required')).toBeInTheDocument();
  });

  /** The server's 409 when sites are still registered with the accounts being removed or replaced: one entry each. */
  type InUse = { service: 'google' | 'bing'; action: 'remove' | 'replace'; count: number; error: string };
  const inUse = (...accounts: InUse[]): Error =>
    Object.assign(new Error(accounts.map((a) => a.error).join(' ')), {
      status: 409,
      code: 'account-in-use',
      body: { error: accounts.map((a) => a.error).join(' '), code: 'account-in-use', count: accounts.reduce((n, a) => n + a.count, 0), accounts },
    });
  const BING_REFUSED = '2 sites are switched on with this Bing Webmaster account. Switch them off in the Search engines tile first, or, if the Bing API key no longer works, remove it anyway: those 2 sites stay registered at the old account, to be removed there by hand.';
  const BING_IN_USE: InUse = { service: 'bing', action: 'remove', count: 2, error: BING_REFUSED };

  /** Starts a save that waits on the dialog; wrapped, since an async function returning a promise would await it. */
  async function saveInBackground(ref: React.RefObject<WebmasterAccountsSettingsHandle | null>): Promise<{ saved: Promise<void> }> {
    let saved!: Promise<void>;
    await act(async () => {
      saved = ref.current!.save();
      saved.catch(() => undefined); // asserted by the caller
    });
    return { saved };
  }

  async function removeBingAndSave(ref: React.RefObject<WebmasterAccountsSettingsHandle | null>): Promise<{ saved: Promise<void> }> {
    const bing = within(await screen.findByRole('region', { name: 'Bing Webmaster Tools' }));
    fireEvent.click(bing.getByRole('button', { name: 'Remove' }));
    return saveInBackground(ref);
  }

  it('★ removing an account sites are registered with asks first, saying how many stay there; yes saves it with force', async () => {
    api.getWebmasterAccounts.mockResolvedValue(STORED);
    api.putWebmasterAccounts.mockRejectedValueOnce(inUse(BING_IN_USE)).mockResolvedValueOnce({ ...STORED, bing: { configured: false, updatedAt: null } });
    const ref = createRef<WebmasterAccountsSettingsHandle>();
    render(<WebmasterAccountsSettings ref={ref} />);
    const { saved } = await removeBingAndSave(ref);

    expect(await screen.findByText('Remove the Bing account anyway?')).toBeInTheDocument();
    expect(screen.getByText(BING_REFUSED)).toBeInTheDocument();
    expect(screen.getByText('Remove anyway — 2 sites stay registered at the old account; remove them there by hand.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }));
      await saved;
    });
    expect(api.putWebmasterAccounts.mock.calls).toEqual([[{ bing: null }], [{ bing: null, force: true }]]);
  });

  it('declined, nothing more is sent and the save fails with the server’s reason', async () => {
    api.getWebmasterAccounts.mockResolvedValue(STORED);
    api.putWebmasterAccounts.mockRejectedValueOnce(inUse(BING_IN_USE));
    const ref = createRef<WebmasterAccountsSettingsHandle>();
    render(<WebmasterAccountsSettings ref={ref} />);
    const { saved } = await removeBingAndSave(ref);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await expect(saved).rejects.toThrow(BING_REFUSED);
    expect(api.putWebmasterAccounts).toHaveBeenCalledTimes(1);
  });

  it('a replaced key that is refused asks to replace it anyway; any other refusal is not a question', async () => {
    api.getWebmasterAccounts.mockResolvedValue(STORED);
    api.putWebmasterAccounts
      .mockRejectedValueOnce(inUse({ service: 'bing', action: 'replace', count: 1, error: 'refused' }))
      .mockRejectedValueOnce(new Error('The Bing API key is not valid'));
    const ref = createRef<WebmasterAccountsSettingsHandle>();
    render(<WebmasterAccountsSettings ref={ref} />);
    await screen.findByRole('region', { name: 'Bing Webmaster Tools' });
    fireEvent.change(screen.getByLabelText('Bing Webmaster API key'), { target: { value: BING_KEY } });
    const { saved } = await saveInBackground(ref);
    expect(await screen.findByText('Replace the Bing account anyway?')).toBeInTheDocument();
    expect(screen.getByText('Replace anyway — 1 site stays registered at the old account; remove it there by hand.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Replace anyway' }));
    await expect(saved).rejects.toThrow('The Bing API key is not valid');
    expect(api.putWebmasterAccounts.mock.calls.at(-1)).toEqual([{ bing: { apiKey: BING_KEY }, force: true }]);
  });

  it('★ replacing Google while removing Bing words each account by what happens to it, with its own count', async () => {
    api.getWebmasterAccounts.mockResolvedValue(STORED);
    const google: InUse = { service: 'google', action: 'replace', count: 1, error: 'Google: the service account holds 1 site.' };
    api.putWebmasterAccounts.mockRejectedValueOnce(inUse(google, BING_IN_USE)).mockResolvedValueOnce(STORED);
    const ref = createRef<WebmasterAccountsSettingsHandle>();
    render(<WebmasterAccountsSettings ref={ref} />);
    await screen.findByRole('region', { name: 'Google service account' });
    await pick(file(KEY_FILE));
    const { saved } = await removeBingAndSave(ref);

    expect(await screen.findByText('Change both search engine accounts anyway?')).toBeInTheDocument();
    expect(screen.getByText('Google: Replace anyway — 1 site stays registered at the old account; remove it there by hand.')).toBeInTheDocument();
    expect(screen.getByText('Bing: Remove anyway — 2 sites stay registered at the old account; remove them there by hand.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove and replace anyway' }));
      await saved;
    });
    expect(api.putWebmasterAccounts.mock.calls.at(-1)).toEqual([{ google: { keyFile: KEY_FILE }, bing: null, force: true }]);
  });
});
