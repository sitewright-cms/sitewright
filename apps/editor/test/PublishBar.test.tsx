import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

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
import { LONG_PRESS_MS } from '../src/lib/use-long-press';

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
    // Accessible name keeps the target (aria-label/title), but the VISIBLE label is just "Deploy".
    const primary = await screen.findByRole('button', { name: 'Deploy to Local Hosting' });
    expect(primary).toHaveTextContent('Deploy');
    expect(primary.textContent).not.toContain('Local Hosting');
    primary.click();
    await waitFor(() => expect(publish).toHaveBeenCalledWith('p'));
  });

  it('CLEARS the deploy dot once that target has received the content — the reported bug', async () => {
    // ★ The dot came from the project-wide `dirty`, which is derived from the LOCAL release record.
    // A project deployed only over SFTP has no local release at all, so it stayed green with "changes
    // to deploy" FOREVER — seconds after a successful upload. Confirmed on a real instance: right
    // after a 255-file SFTP deploy the API still reported status "unpublished", dirty true.
    const deployed = { ...remote, lastDeployedAt: '2026-01-02T00:00:00.000Z' };
    listDeployTargets.mockResolvedValue({ items: [deployed] });
    publishStatus.mockResolvedValue({
      release: null, // remote-only: there is no local release, and there never will be
      url: '',
      dirty: true, // the project-wide flag stays true — the button must no longer believe it
      latestContentAt: '2026-01-01T00:00:00.000Z', // content is OLDER than the deploy
      localHosting: false,
    });
    render(<PublishBar project={project} />);
    const primary = await screen.findByRole('button', { name: 'Deploy to Production' });
    await waitFor(() => expect(primary.className).not.toContain('emerald'));
    expect(primary.querySelector('span[aria-hidden]')).toBeNull();
  });

  it('KEEPS the dot when the content is newer than that target\'s last deploy', async () => {
    const stale = { ...remote, lastDeployedAt: '2026-01-01T00:00:00.000Z' };
    listDeployTargets.mockResolvedValue({ items: [stale] });
    publishStatus.mockResolvedValue({
      release: null, url: '', dirty: false, // even with the project-wide flag CLEAR…
      latestContentAt: '2026-01-02T00:00:00.000Z', // …this target is behind
      localHosting: false,
    });
    render(<PublishBar project={project} />);
    const primary = await screen.findByRole('button', { name: 'Deploy to Production' });
    await waitFor(() => expect(primary.className).toContain('emerald'));
    expect(primary.querySelector('span[aria-hidden]')).not.toBeNull();
  });

  it('a target that has NEVER been deployed always has something to send', async () => {
    listDeployTargets.mockResolvedValue({ items: [remote] }); // no lastDeployedAt
    publishStatus.mockResolvedValue({ release: null, url: '', dirty: false, latestContentAt: '2026-01-01T00:00:00.000Z', localHosting: false });
    render(<PublishBar project={project} />);
    const primary = await screen.findByRole('button', { name: 'Deploy to Production' });
    await waitFor(() => expect(primary.className).toContain('emerald'));
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

  it('offers Download .zip with NO targets configured — the manual deployment path', async () => {
    // ★ THE BUG: the ▾ only rendered when targets.length > 0, so the menu holding "Download .zip"
    // could not be opened at all without a deploy target — and a zip download is what you reach for
    // precisely BECAUSE you have no target. The route agrees: with no retained build it builds a
    // fresh archive for exactly this case.
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: false, localHosting: false });
    listDeployTargets.mockResolvedValue({ items: [] });
    render(<PublishBar project={project} />);
    (await screen.findByRole('button', { name: 'Choose a deploy target' })).click();
    const download = await screen.findByRole('menuitem', { name: /Download/ });
    expect(download).toHaveAttribute('href', '/projects/p/publish/archive');
    // …and no empty "Deploy to…" heading above a list of nothing.
    expect(screen.queryByText('Deploy to…')).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Add a target/ })).toBeInTheDocument();
  });

  it('with no targets the primary button still opens the config modal', async () => {
    const onOpenDeploy = vi.fn();
    listDeployTargets.mockResolvedValue({ items: [] });
    render(<PublishBar project={project} onOpenDeploy={onOpenDeploy} />);
    (await screen.findByRole('button', { name: 'Deploy' })).click();
    expect(onOpenDeploy).toHaveBeenCalled(); // unchanged behaviour — only the ▾ beside it is new
  });

  it('DISABLES Download .zip until the site has been published, with the reason', async () => {
    // The archive is the site AS PUBLISHED, so the route answers 409 until a release exists. As a
    // bare link that 409 opened a tab of raw JSON.
    publishStatus.mockResolvedValue({ release: null, url: '', dirty: false, localHosting: false });
    listDeployTargets.mockResolvedValue({ items: [local] });
    render(<PublishBar project={project} />);
    (await screen.findByRole('button', { name: 'Choose a deploy target' })).click();
    const download = await screen.findByRole('menuitem', { name: /Download/ });
    expect(download).toHaveAttribute('aria-disabled', 'true');
    expect(download).not.toHaveAttribute('href');
    expect(download.getAttribute('title')).toMatch(/publish the site first/i);
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
    // It lives in the deploy dropdown now, not in the bar — same family as the rest of that menu, and
    // it stops being a control that comes and goes as you edit.
    fireEvent.click(screen.getByRole('button', { name: 'Choose a deploy target' }));
    const view = await screen.findByRole('menuitem', { name: 'View the live site' });
    expect(view).toHaveAttribute('href', '/sites/acme/');
  });

  it('hides View-live when there is no local hosting target', async () => {
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: false, localHosting: false });
    listDeployTargets.mockResolvedValue({ items: [remote] });
    render(<PublishBar project={project} />);
    await screen.findByRole('button', { name: 'Deploy to Production' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose a deploy target' }));
    expect(screen.queryByRole('menuitem', { name: 'View the live site' })).toBeNull();
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

/**
 * COMPACT (a phone-sized header). Found by the mobile E2E overflow guard, not by reading the code: at
 * 412px this bar measured 447px — wider than the whole screen on its own. That is not just ugly.
 * Mobile Chrome WIDENS THE LAYOUT VIEWPORT to fit overflowing content, and `position: fixed` is
 * relative to that viewport — so the bottom rail tabs were laid out at y=1136 on a 915px-tall device
 * and no tap could reach them. An overflowing header broke controls nowhere near it.
 */
describe('PublishBar in a compact header', () => {
  const both = { ...project };

  it('keeps BOTH primary actions, as icons, and drops the labels', async () => {
    listDeployTargets.mockResolvedValue({ items: [local] });
    render(<PublishBar project={both} compact />);
    // Still reachable — and still named, so nothing is lost to a screen reader.
    expect(await screen.findByRole('button', { name: 'Preview the live site' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Deploy/ })).toBeInTheDocument();
    // …but the visible text labels are what cost the width.
    expect(screen.queryByText('Preview')).not.toBeInTheDocument();
    expect(screen.queryByText('Deploy')).not.toBeInTheDocument();
  });

  it('drops the split-button carets — those open CONFIGURATION, not the action', async () => {
    listDeployTargets.mockResolvedValue({ items: [local, remote] });
    render(<PublishBar project={both} compact />);
    await screen.findByRole('button', { name: 'Preview the live site' });
    // Share links, choosing a target and Download .zip all remain reachable from the gear menu's
    // Publish & Deploy Options.
    expect(screen.queryByRole('button', { name: 'Preview options' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose a deploy target' })).not.toBeInTheDocument();
  });

  it('drops the "Connect an agent" nudge, but NOT a live agent indicator', async () => {
    // Nothing connected → the pill is pure suggestion, and suggestion is what a 412px row cannot afford.
    const { unmount } = render(<PublishBar project={both} compact />);
    await screen.findByRole('button', { name: 'Preview the live site' });
    expect(screen.queryByRole('button', { name: /Connect an agent/i })).not.toBeInTheDocument();
    unmount();

    // Connected → it is live status, and it stays.
    listAgentConnections.mockResolvedValue({ items: [{ id: 'a1', name: 'agent' }] });
    render(<PublishBar project={both} compact />);
    expect(await screen.findByRole('button', { name: /Agent connected/i })).toBeInTheDocument();
  });

  it('★ LONG-PRESS opens what the dropped caret used to open', async () => {
    // Dropping a control is only acceptable if what it opened is still reachable. The caret bought
    // ~88px of a 412px header; the gesture gives its menu back on the button it was attached to.
    vi.useFakeTimers();
    try {
      listDeployTargets.mockResolvedValue({ items: [local] });
      render(<PublishBar project={both} compact />);
      await act(async () => {});
      const deploy = screen.getByRole('button', { name: /^Deploy/ });
      fireEvent.touchStart(deploy, { touches: [{ clientX: 10, clientY: 10 }] });
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS);
      });
      expect(screen.getByRole('menu')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps every one of them at full size on desktop', async () => {
    listDeployTargets.mockResolvedValue({ items: [local] });
    render(<PublishBar project={both} />);
    expect(await screen.findByRole('button', { name: 'Preview options' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Choose a deploy target' })).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });
});
