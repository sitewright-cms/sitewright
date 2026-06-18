import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const { publishStatus, publish, archiveUrl, listDeployTargets, listAgentConnections } = vi.hoisted(() => ({
  publishStatus: vi.fn(),
  publish: vi.fn(),
  archiveUrl: vi.fn<(id: string) => string>(() => '/projects/p/publish/archive'),
  listDeployTargets: vi.fn<(id: string) => Promise<{ items: unknown[] }>>(() => Promise.resolve({ items: [] })),
  listAgentConnections: vi.fn<(id: string) => Promise<{ items: unknown[] }>>(() => Promise.resolve({ items: [] })),
}));
vi.mock('../src/api', () => ({
  api: {
    publishStatus: (id: string) => publishStatus(id),
    publish: (id: string) => publish(id),
    archiveUrl: (id: string) => archiveUrl(id),
    listDeployTargets: (id: string) => listDeployTargets(id),
    listAgentConnections: (id: string) => listAgentConnections(id),
    disconnectAgent: vi.fn(() => Promise.resolve()),
  },
  eventsUrl: (id: string) => `/projects/${id}/events`,
}));
// PublishBar renders the streaming DeployModal for remote deploys; stub it to a probe.
vi.mock('../src/views/publish/DeployModal', () => ({
  DeployModal: ({ target }: { target: { name: string } }) => <div data-testid="deploy-modal">{target.name}</div>,
}));

import { PublishBar } from '../src/views/PublishBar';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };
const release = { publishedAt: '2026-01-01T00:00:00.000Z', routes: 3, bytes: 100 };
const local = { id: 'lt', name: 'Local Hosting', protocol: 'local' as const };
const remote = { id: 'rt', name: 'Production', protocol: 'sftp' as const, host: 'host.example' };

beforeEach(() => {
  publishStatus.mockReset();
  publishStatus.mockResolvedValue({ release: null, url: '/sites/acme/', dirty: false, localHosting: false });
  publish.mockReset();
  listDeployTargets.mockReset();
  listDeployTargets.mockResolvedValue({ items: [] });
  listAgentConnections.mockReset();
  listAgentConnections.mockResolvedValue({ items: [] });
  try {
    localStorage.clear();
  } catch {
    /* no-op */
  }
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PublishBar — deploy split button', () => {
  it('with no targets, the Deploy button opens the config modal', async () => {
    const onOpenDeploy = vi.fn();
    render(<PublishBar project={project} onOpenDeploy={onOpenDeploy} />);
    const btn = await screen.findByRole('button', { name: 'Deploy' });
    btn.click();
    expect(onOpenDeploy).toHaveBeenCalled();
  });

  it('with targets, the primary defaults to Local Hosting and deploys it via publish', async () => {
    listDeployTargets.mockResolvedValue({ items: [remote, local] });
    publish.mockResolvedValue({ release, url: '/sites/acme/', dirty: false });
    render(<PublishBar project={project} />);
    const primary = await screen.findByRole('button', { name: 'Deploy to Local Hosting' });
    primary.click();
    await waitFor(() => expect(publish).toHaveBeenCalledWith('p'));
  });

  it('the ▾ opens a dropdown listing every target plus Add + Download', async () => {
    listDeployTargets.mockResolvedValue({ items: [local, remote] });
    render(<PublishBar project={project} />);
    (await screen.findByRole('button', { name: 'Choose a deploy target' })).click();
    expect(await screen.findByRole('menuitem', { name: /Local Hosting/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Production/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Add a target/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Download/ })).toBeInTheDocument();
  });

  it('deploying a remote target from the dropdown opens the streaming deploy modal', async () => {
    listDeployTargets.mockResolvedValue({ items: [local, remote] });
    render(<PublishBar project={project} />);
    (await screen.findByRole('button', { name: 'Choose a deploy target' })).click();
    (await screen.findByRole('menuitem', { name: /Production/ })).click();
    expect(await screen.findByTestId('deploy-modal')).toHaveTextContent('Production');
    expect(publish).not.toHaveBeenCalled(); // remote → no local publish
  });

  it('the last-used target (localStorage) becomes the primary action', async () => {
    localStorage.setItem('sw:lastDeployTarget:p', 'rt'); // last deployed Production
    listDeployTargets.mockResolvedValue({ items: [local, remote] });
    render(<PublishBar project={project} />);
    expect(await screen.findByRole('button', { name: 'Deploy to Production' })).toBeInTheDocument();
  });

  it('shows a View-live link only when local hosting is configured + published + clean', async () => {
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: false, localHosting: true });
    listDeployTargets.mockResolvedValue({ items: [local] });
    render(<PublishBar project={project} />);
    const view = await screen.findByRole('link', { name: 'View the live site' });
    expect(view).toHaveAttribute('href', '/sites/acme/');
  });

  it('hides View-live when there is no local hosting target', async () => {
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: false, localHosting: false });
    listDeployTargets.mockResolvedValue({ items: [remote] });
    render(<PublishBar project={project} />);
    await screen.findByRole('button', { name: 'Deploy to Production' });
    expect(screen.queryByRole('link', { name: 'View the live site' })).toBeNull();
  });
});

describe('PublishBar — agent presence', () => {
  it('nudges "Connect an agent" when none is connected', async () => {
    render(<PublishBar project={project} />);
    expect(await screen.findByText('Connect an agent')).toBeInTheDocument();
  });

  it('shows the WORKING indicator on an agent-sourced change', async () => {
    const listeners: Array<(e: { data: string }) => void> = [];
    class CtrlEventSource {
      addEventListener(_t: string, cb: (e: { data: string }) => void) {
        listeners.push(cb);
      }
      close() {}
    }
    vi.stubGlobal('EventSource', CtrlEventSource);
    render(<PublishBar project={project} />);
    await screen.findByText('Connect an agent');
    act(() => listeners.forEach((cb) => cb({ data: JSON.stringify({ actor: 'agent' }) })));
    expect(await screen.findByText('Agent working…')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows the IDLE indicator when a connection exists but no agent is editing', async () => {
    listAgentConnections.mockResolvedValue({
      items: [{ id: 'oauth:u1', kind: 'oauth', name: 'ChatGPT', role: 'owner', capabilities: ['content:read'], connectedAt: '2026-06-09T00:00:00.000Z', expiresAt: null, lastUsedAt: null }],
    });
    render(<PublishBar project={project} />);
    expect(await screen.findByText('Agent connected')).toBeInTheDocument();
  });

  it('opens the AI agent details modal when the indicator is clicked', async () => {
    render(<PublishBar project={project} />);
    (await screen.findByText('Connect an agent')).click();
    expect(await screen.findByRole('heading', { name: 'AI agent details' })).toBeInTheDocument();
  });
});
