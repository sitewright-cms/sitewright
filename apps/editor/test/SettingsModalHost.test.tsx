import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// The System Settings header badge reads api.version(); stub it (and stub InstanceSettings so this
// test doesn't drag in the whole settings form's own api calls).
const version = vi.fn();
vi.mock('../src/api', () => ({ api: { version: () => version() } }));
vi.mock('../src/views/InstanceSettings', () => ({ InstanceSettings: () => <div>instance settings body</div> }));

import { SettingsModalHost } from '../src/views/SettingsModalHost';

describe('SettingsModalHost — System Settings version badge', () => {
  beforeEach(() => version.mockReset());

  it('shows the running instance version in the header', async () => {
    version.mockResolvedValue({ current: '0.3.0', latest: '0.3.0', updateAvailable: false, releaseUrl: null, build: 'abc123' });
    render(<SettingsModalHost view="system" project={null} onClose={() => {}} />);
    expect(await screen.findByText('v0.3.0')).toBeInTheDocument();
    // no update → the badge is plain text, not a link
    expect(screen.queryByRole('link', { name: /update available/i })).toBeNull();
  });

  it('links to the release notes when a newer version is available', async () => {
    version.mockResolvedValue({ current: '0.3.0', latest: '0.4.0', updateAvailable: true, releaseUrl: 'https://example.test/releases/0.4.0', build: 'abc123' });
    render(<SettingsModalHost view="system" project={null} onClose={() => {}} />);
    const link = await screen.findByRole('link', { name: /update available/i });
    expect(link).toHaveAttribute('href', 'https://example.test/releases/0.4.0');
    expect(within(link).getByText('v0.3.0')).toBeInTheDocument();
  });
});
