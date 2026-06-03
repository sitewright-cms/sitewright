import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SettingsBundle } from '../src/api';

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
  },
}));

import { SettingsView } from '../src/views/settings/SettingsView';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };

const bundle: SettingsBundle = {
  identity: { name: 'Acme', legalName: 'Acme Inc.', colors: { primary: '#0a7' } },
  settings: { defaultLocale: 'en', locales: ['en'] },
};

beforeEach(() => {
  getSettings.mockReset();
  putSettings.mockReset();
  getSettings.mockResolvedValue({ item: bundle });
  putSettings.mockResolvedValue({ item: bundle });
});

describe('SettingsView', () => {
  it('loads the identity and renders both section tabs', async () => {
    render(<SettingsView project={project} />);
    expect(await screen.findByLabelText('Display name')).toHaveValue('Acme');
    expect(screen.getByRole('tab', { name: 'Corporate Identity' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Website' })).toBeInTheDocument();
  });

  it('starts from defaults when no settings exist yet (404)', async () => {
    getSettings.mockRejectedValue(new FakeApiError(404, 'not found'));
    render(<SettingsView project={project} />);
    // Falls back to the project name as the identity display name.
    expect(await screen.findByLabelText('Display name')).toHaveValue('Acme');
  });

  it('edits a field and saves the assembled bundle, then shows Saved', async () => {
    render(<SettingsView project={project} />);
    const legal = await screen.findByLabelText('Legal name');
    fireEvent.change(legal, { target: { value: 'Acme Corporation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    const sent = putSettings.mock.calls[0]![1] as SettingsBundle;
    expect(sent.identity.legalName).toBe('Acme Corporation');
    expect(sent.identity.name).toBe('Acme');
    expect(await screen.findByText('✓ Saved')).toBeInTheDocument();
  });

  it('switches to the Website section and edits siteUrl into the saved bundle', async () => {
    render(<SettingsView project={project} />);
    await screen.findByLabelText('Display name');
    fireEvent.click(screen.getByRole('tab', { name: 'Website' }));
    const siteUrl = await screen.findByLabelText(/Production URL/);
    fireEvent.change(siteUrl, { target: { value: 'https://acme.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(putSettings).toHaveBeenCalledTimes(1));
    expect((putSettings.mock.calls[0]![1] as SettingsBundle).website?.siteUrl).toBe('https://acme.com');
  });

  it('surfaces a save error', async () => {
    putSettings.mockRejectedValue(new Error('input too large'));
    render(<SettingsView project={project} />);
    await screen.findByLabelText('Display name');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('input too large')).toBeInTheDocument();
  });
});
