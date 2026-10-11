import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// The System Settings header badge reads api.version(); stub it (and stub InstanceSettings so this
// test doesn't drag in the whole settings form's own api calls).
const version = vi.fn();
vi.mock('../src/api', () => ({ api: { version: () => version() } }));
vi.mock('../src/views/InstanceSettings', () => ({ InstanceSettings: () => <div>instance settings body</div> }));
// Same reason for the staff panel: the modal CHROME is what's under test here, not TeamManager's own
// /admin/users fetches.
vi.mock('../src/views/TeamManager', () => ({ TeamManager: () => <div>administrators body</div> }));

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

describe('SettingsModalHost — which surfaces need a project', () => {
  beforeEach(() => version.mockReset());

  // The gear menu offers "Administrators" to an instance admin regardless of context, including on the
  // "Pick a project to get started" home screen. The view used to sit BELOW the `!project` guard, so
  // that menu item was a dead click with no project open.
  it('opens Administrators with no project selected (it is instance-wide, not project-scoped)', () => {
    render(<SettingsModalHost view="team" project={null} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Administrators' })).toBeInTheDocument();
    expect(screen.getByText('administrators body')).toBeInTheDocument();
  });

  // The counterpart invariant: Project Members IS project-scoped and must stay behind the guard.
  it('renders nothing for Project Members with no project selected', () => {
    const { container } = render(<SettingsModalHost view="clients" project={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
