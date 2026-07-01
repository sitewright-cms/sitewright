import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SettingsBundle } from '../src/api';
import { ToastProvider } from '../src/views/ui/Toast';

const { getSettings, putSettings, FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { getSettings: vi.fn(), putSettings: vi.fn(), FakeApiError };
});
vi.mock('../src/api', () => ({
  ApiError: FakeApiError,
  api: {
    getSettings: (p: string) => getSettings(p),
    putSettings: (p: string, b: SettingsBundle) => putSettings(p, b),
    // IdentitySection loads the project's font library assets on mount.
    listMedia: () => Promise.resolve({ items: [] }),
    // WebsiteSection loads the "fork existing effect" snippets on mount.
    listEffectForks: () => Promise.resolve({ nav: [], button: [], preloader: [] }),
  },
}));

import { SettingsView } from '../src/views/settings/SettingsView';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };

const bundle: SettingsBundle = {
  identity: { name: 'Acme', legalName: 'Acme Inc.', colors: { primary: '#0a7' } },
  settings: { defaultLocale: 'en', locales: ['en'] },
};

// Toasts are the save/discard confirmation channel, so every render goes through the provider
// (without it `useToast()` is a no-op and no confirmation text would appear).
function renderView() {
  return render(
    <ToastProvider>
      <SettingsView project={project} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  getSettings.mockReset();
  putSettings.mockReset();
  getSettings.mockResolvedValue({ item: bundle });
  putSettings.mockResolvedValue({ item: bundle });
});

describe('SettingsView', () => {
  it('loads the identity and renders both section tabs', async () => {
    renderView();
    expect(await screen.findByLabelText('Display name')).toHaveValue('Acme');
    expect(screen.getByRole('tab', { name: 'Corporate Identity' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Website' })).toBeInTheDocument();
  });

  it('starts from defaults when no settings exist yet (404)', async () => {
    getSettings.mockRejectedValue(new FakeApiError(404, 'not found'));
    renderView();
    // Falls back to the project name as the identity display name.
    expect(await screen.findByLabelText('Display name')).toHaveValue('Acme');
  });

  it('keeps Save + Discard disabled until there are unsaved changes', async () => {
    renderView();
    await screen.findByLabelText('Display name');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Legal name'), { target: { value: 'Acme Corporation' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeEnabled();
  });

  it('edits a field and saves the assembled bundle, then toasts success', async () => {
    renderView();
    const legal = await screen.findByLabelText('Legal name');
    fireEvent.change(legal, { target: { value: 'Acme Corporation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    const sent = putSettings.mock.calls[0]![1] as SettingsBundle;
    expect(sent.identity.legalName).toBe('Acme Corporation');
    expect(sent.identity.name).toBe('Acme');
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
    // After a successful save the form matches the new baseline → buttons disable again.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
  });

  it('discards unsaved edits, reverting fields and re-disabling the buttons', async () => {
    renderView();
    const legal = await screen.findByLabelText('Legal name');
    fireEvent.change(legal, { target: { value: 'Changed Inc.' } });
    expect(legal).toHaveValue('Changed Inc.');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(await screen.findByLabelText('Legal name')).toHaveValue('Acme Inc.');
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(await screen.findByText('Changes discarded')).toBeInTheDocument();
    // Discarding must not hit the API.
    expect(putSettings).not.toHaveBeenCalled();
  });

  it('switches to the Website section and edits siteUrl into the saved bundle', async () => {
    renderView();
    await screen.findByLabelText('Display name');
    fireEvent.click(screen.getByRole('tab', { name: 'Website' }));
    const siteUrl = await screen.findByLabelText(/Production URL/);
    fireEvent.change(siteUrl, { target: { value: 'https://acme.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    expect((putSettings.mock.calls[0]![1] as SettingsBundle).website?.siteUrl).toBe('https://acme.com');
  });

  it('shows an inline error for a malformed siteUrl on input and clears it once corrected', async () => {
    renderView();
    await screen.findByLabelText('Display name');
    fireEvent.click(screen.getByRole('tab', { name: 'Website' }));
    const siteUrl = await screen.findByLabelText(/Production URL/);
    // A scheme-less value is invalid → the inline message appears + the input is marked invalid.
    fireEvent.change(siteUrl, { target: { value: 'acme.com' } });
    expect(await screen.findByText(/starts with https:\/\//i)).toBeInTheDocument();
    expect(siteUrl).toHaveAttribute('aria-invalid', 'true');
    // A query string is rejected too (would break the sitemap <loc>).
    fireEvent.change(siteUrl, { target: { value: 'https://acme.com?x=1' } });
    expect(await screen.findByText(/no "\?" query/i)).toBeInTheDocument();
    // Correcting it clears the error (and a trailing slash is accepted — normalized at build).
    fireEvent.change(siteUrl, { target: { value: 'https://acme.com/' } });
    await waitFor(() => expect(screen.queryByText(/starts with https:\/\//i)).toBeNull());
    expect(siteUrl).not.toHaveAttribute('aria-invalid');
  });

  it('toasts a save error', async () => {
    putSettings.mockRejectedValue(new Error('input too large'));
    renderView();
    const legal = await screen.findByLabelText('Legal name');
    fireEvent.change(legal, { target: { value: 'Acme Corporation' } }); // dirty → Save enabled
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('input too large')).toBeInTheDocument();
  });

  it('tracks dirty state independently per section', async () => {
    renderView();
    await screen.findByLabelText('Display name');
    // Edit an IDENTITY field → CI is dirty.
    fireEvent.change(screen.getByLabelText('Legal name'), { target: { value: 'Acme Corp' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    // Switch to Website → its OWN (clean) state: the buttons are disabled there.
    fireEvent.click(screen.getByRole('tab', { name: 'Website' }));
    await screen.findByLabelText(/Production URL/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
    // Back on CI → the identity edit is still pending (preserved across the switch).
    fireEvent.click(screen.getByRole('tab', { name: 'Corporate Identity' }));
    expect(await screen.findByLabelText('Legal name')).toHaveValue('Acme Corp');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('saves only the active section, leaving the other section’s edits pending', async () => {
    renderView();
    await screen.findByLabelText('Display name');
    // Make a pending WEBSITE edit first…
    fireEvent.click(screen.getByRole('tab', { name: 'Website' }));
    fireEvent.change(await screen.findByLabelText(/Production URL/), { target: { value: 'https://acme.com' } });
    // …then go to CI, edit + Save.
    fireEvent.click(screen.getByRole('tab', { name: 'Corporate Identity' }));
    fireEvent.change(await screen.findByLabelText('Legal name'), { target: { value: 'Acme Corp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    const sent = putSettings.mock.calls[0]![1] as SettingsBundle;
    expect(sent.identity.legalName).toBe('Acme Corp');
    // The CI save must NOT carry the pending website edit (base.website was undefined).
    expect(sent.website?.siteUrl).toBeUndefined();
    // Back on Website → the edit survives and is still pending.
    fireEvent.click(screen.getByRole('tab', { name: 'Website' }));
    expect(await screen.findByLabelText(/Production URL/)).toHaveValue('https://acme.com');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
