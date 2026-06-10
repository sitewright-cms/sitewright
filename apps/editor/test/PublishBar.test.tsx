import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const { publishStatus, publish, archiveUrl, getSettings, listDeployTargets } = vi.hoisted(() => ({
  publishStatus: vi.fn(),
  publish: vi.fn(),
  archiveUrl: vi.fn<(id: string) => string>(() => '/projects/p/publish/archive'),
  // No preview token by default → the View/Preview link is the bare /sites/<slug>/ URL.
  getSettings: vi.fn<(id: string) => Promise<{ item: { website?: { previewToken?: string } } }>>(() =>
    Promise.resolve({ item: {} }),
  ),
  // No saved deploy targets by default → no header Deploy button.
  listDeployTargets: vi.fn<(id: string) => Promise<{ items: unknown[] }>>(() => Promise.resolve({ items: [] })),
}));
vi.mock('../src/api', () => ({
  api: {
    publishStatus: (id: string) => publishStatus(id),
    publish: (id: string) => publish(id),
    archiveUrl: (id: string) => archiveUrl(id),
    getSettings: (id: string) => getSettings(id),
    listDeployTargets: (id: string) => listDeployTargets(id),
  },
  eventsUrl: (id: string) => `/projects/${id}/events`,
}));
vi.mock('../src/views/publish/DeployForm', () => ({ DeployForm: () => <div>DEPLOY FORM</div> }));

import { PublishBar } from '../src/views/PublishBar';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };
const release = { publishedAt: '2026-01-01T00:00:00.000Z', routes: 3, bytes: 100 };

beforeEach(() => {
  publishStatus.mockReset();
  publish.mockReset();
});

describe('PublishBar', () => {
  it('is a GREEN Publish button with an "Unpublished changes" hint when dirty', async () => {
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: true });
    render(<PublishBar project={project} />);
    const btn = await screen.findByRole('button', { name: 'Publish' });
    await waitFor(() => expect(btn.className).toContain('bg-emerald-600'));
    expect(screen.getByText('Unpublished changes')).toBeInTheDocument();
  });

  it('becomes a PREVIEW link to the published site when everything is published', async () => {
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: false });
    render(<PublishBar project={project} />);
    const preview = await screen.findByRole('link', { name: /Preview/ });
    expect(preview).toHaveAttribute('href', '/sites/acme/');
    expect(screen.getByText(/Published · 3 pages/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  it('appends the preview token to the View/Preview link when the site is token-gated', async () => {
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: false });
    getSettings.mockResolvedValueOnce({ item: { website: { previewToken: 'tok_abcdefgh12345678' } } });
    render(<PublishBar project={project} />);
    const preview = await screen.findByRole('link', { name: /Preview/ });
    await waitFor(() => expect(preview).toHaveAttribute('href', '/sites/acme/?token=tok_abcdefgh12345678'));
  });

  it('switches Publish → Preview after a successful publish', async () => {
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: true });
    publish.mockResolvedValue({ release, url: '/sites/acme/', dirty: false });
    render(<PublishBar project={project} />);
    const btn = await screen.findByRole('button', { name: 'Publish' });
    btn.click();
    await waitFor(() => expect(publish).toHaveBeenCalledWith('p'));
    expect(await screen.findByRole('link', { name: /Preview/ })).toHaveAttribute('href', '/sites/acme/');
  });

  it('reverts Preview → Publish when a content change arrives on the SSE stream', async () => {
    const listeners: Array<(e: { data: string }) => void> = [];
    class CtrlEventSource {
      addEventListener(_type: string, cb: (e: { data: string }) => void) {
        listeners.push(cb);
      }
      close() {}
    }
    vi.stubGlobal('EventSource', CtrlEventSource);
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: false });
    render(<PublishBar project={project} />);
    await screen.findByRole('link', { name: /Preview/ }); // published + clean → Preview
    act(() => listeners.forEach((cb) => cb({ data: JSON.stringify({ kind: 'page', entityId: 'home', op: 'put', actor: 'user' }) }))); // an edit lands
    expect(await screen.findByRole('button', { name: 'Publish' })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows an "Agent editing" pill when an agent-sourced change arrives, but not for a user change', async () => {
    const listeners: Array<(e: { data: string }) => void> = [];
    class CtrlEventSource {
      addEventListener(_type: string, cb: (e: { data: string }) => void) {
        listeners.push(cb);
      }
      close() {}
    }
    vi.stubGlobal('EventSource', CtrlEventSource);
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: false });
    render(<PublishBar project={project} />);
    await screen.findByRole('link', { name: /Preview/ });
    const fire = (actor: string) =>
      act(() => listeners.forEach((cb) => cb({ data: JSON.stringify({ kind: 'page', entityId: 'home', op: 'put', actor }) })));

    fire('user'); // a human edit → no agent pill
    expect(screen.queryByText('Agent editing…')).toBeNull();

    fire('agent'); // a bearer/MCP edit → the pill appears
    expect(await screen.findByText('Agent editing…')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('clears the "Agent editing" pill after a ~12s lull', async () => {
    const listeners: Array<(e: { data: string }) => void> = [];
    class CtrlEventSource {
      addEventListener(_type: string, cb: (e: { data: string }) => void) {
        listeners.push(cb);
      }
      close() {}
    }
    vi.stubGlobal('EventSource', CtrlEventSource);
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: false });
    render(<PublishBar project={project} />);
    await screen.findByRole('link', { name: /Preview/ }); // real timers for the async publish-status fetch
    vi.useFakeTimers(); // enable BEFORE firing so the 12s setTimeout is fake…
    act(() => listeners.forEach((cb) => cb({ data: JSON.stringify({ kind: 'page', entityId: 'home', op: 'put', actor: 'agent' }) })));
    expect(screen.getByText('Agent editing…')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(12_001)); // …so advancing fires it
    expect(screen.queryByText('Agent editing…')).toBeNull();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows a Deploy button (→ onOpenDeploy) when a saved target exists and the site is published', async () => {
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: false });
    listDeployTargets.mockResolvedValueOnce({ items: [{ id: 't1' }] });
    const onOpenDeploy = vi.fn();
    render(<PublishBar project={project} onOpenDeploy={onOpenDeploy} />);
    const deploy = await screen.findByRole('button', { name: 'Deploy the published site' });
    deploy.click();
    expect(onOpenDeploy).toHaveBeenCalled();
  });
});
