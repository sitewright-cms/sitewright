import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const getSettings = vi.fn();
vi.mock('../src/api', () => ({ api: { getSettings: (...a: unknown[]) => getSettings(...a) } }));

import { LocalDeployModal } from '../src/views/publish/LocalDeployModal';
import { displayAddress, withPreviewToken } from '../src/views/publish/DeployLinks';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };
const target = { id: 'lt', name: 'Local Hosting', protocol: 'local' as const };
const release = { publishedAt: '2026-10-14T10:00:00.000Z', routes: 7, bytes: 1000 };
const done = (url: string | null) => ({ kind: 'done' as const, release, url });
const settingsWith = (siteUrl?: string) => ({ item: { website: siteUrl ? { siteUrl } : {} } });

beforeEach(() => {
  getSettings.mockReset();
  getSettings.mockResolvedValue(settingsWith('https://www.acme.example/'));
});

const props = { project, target, onClose: vi.fn() };

describe('LocalDeployModal', () => {
  it('shows the build while it runs, with no link yet', async () => {
    render(<LocalDeployModal {...props} state={{ kind: 'running' }} />);
    expect(screen.getByText('Building and publishing…')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open live site/ })).toBeNull();
  });

  it('★ ends on the address the site is live at, as a remote deploy ends on its production URL', async () => {
    render(<LocalDeployModal {...props} state={done('https://acme.sites.example/')} />);
    // Announced to a screen reader, as the toast it replaces was.
    expect(screen.getByRole('status')).toHaveTextContent('Published to Local Hosting · 7 pages');
    const live = screen.getByRole('link', { name: /Open live site/ });
    expect(live).toHaveAttribute('href', 'https://acme.sites.example/');
    expect(live).toHaveAttribute('target', '_blank');
    // The address itself is on screen, not only behind a click.
    expect(screen.getByText('acme.sites.example')).toBeInTheDocument();
    // A production URL on ANOTHER host is a second place to look.
    expect(await screen.findByRole('link', { name: /Open production site/ })).toHaveAttribute('href', 'https://www.acme.example/');
  });

  it('carries the preview token on the live link, as View live does — the gated site is otherwise refused', () => {
    render(<LocalDeployModal {...props} previewToken="t 1" state={done('/sites/acme/')} />);
    expect(screen.getByRole('link', { name: /Open live site/ })).toHaveAttribute('href', '/sites/acme/?token=t%201');
    // The displayed address never shows the token.
    expect(screen.getByText(`${window.location.host}/sites/acme/`)).toBeInTheDocument();
  });

  it('offers ONE link when the production URL is the live address', async () => {
    getSettings.mockResolvedValue(settingsWith('https://www.acme.example'));
    render(<LocalDeployModal {...props} state={done('https://www.acme.example/')} />);
    // Let the settings read settle before asserting an absence — before it does, neither shows anyway.
    await act(async () => {});
    expect(getSettings).toHaveBeenCalledWith('p');
    expect(screen.queryByRole('link', { name: /Open production site/ })).toBeNull();
    expect(screen.queryByText(/Production URL is not configured/)).toBeNull();
  });

  it('warns, accurately, when no production URL is configured', async () => {
    getSettings.mockResolvedValue(settingsWith(undefined));
    render(<LocalDeployModal {...props} state={done('https://acme.sites.example/')} />);
    // robots.txt IS written without one — only the sitemap (and robots' pointer to it) is missing.
    expect(await screen.findByText(/no sitemap\.xml is generated, and robots\.txt does not point to one/)).toBeInTheDocument();
  });

  it('never puts a non-http(s) production URL in an href', async () => {
    // The schema refuses one on save; a row written past the API must still not become a link.
    getSettings.mockResolvedValue(settingsWith('javascript:alert(1)'));
    render(<LocalDeployModal {...props} state={done('https://acme.sites.example/')} />);
    expect(await screen.findByText(/Production URL is not configured/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open production site/ })).toBeNull();
  });

  it('shows a failed build in the dialog, with no link', () => {
    render(<LocalDeployModal {...props} state={{ kind: 'error', message: 'a build is already in progress for this project' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('a build is already in progress for this project');
    expect(screen.queryByRole('link', { name: /Open live site/ })).toBeNull();
  });

  it('says "1 page", not "1 pages"', () => {
    render(<LocalDeployModal {...props} state={{ kind: 'done', release: { ...release, routes: 1 }, url: '/sites/acme/' }} />);
    expect(screen.getByText('Published to Local Hosting · 1 page')).toBeInTheDocument();
  });
});

describe('deploy link helpers', () => {
  it('withPreviewToken appends the token with the right separator, and leaves an ungated address alone', () => {
    expect(withPreviewToken('/sites/acme/', undefined)).toBe('/sites/acme/');
    expect(withPreviewToken('/sites/acme/', 'abc')).toBe('/sites/acme/?token=abc');
    expect(withPreviewToken('/sites/acme/?x=1', 'abc')).toBe('/sites/acme/?x=1&token=abc');
  });

  it('displayAddress shows host (and path when there is one), never the scheme', () => {
    expect(displayAddress('https://acme.example/')).toBe('acme.example');
    expect(displayAddress('//acme.sites.example/')).toBe('acme.sites.example');
    expect(displayAddress('/sites/acme/')).toBe(`${window.location.host}/sites/acme/`);
  });
});
