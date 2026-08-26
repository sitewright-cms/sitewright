import { PREVIEW_SANDBOX_ATTR } from '@sitewright/schema';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { useEffect } from 'react'; // used by the AgentDrawer mock's factory (below) at render time

const { agentPresence, previewLocate, previewBase, previewProgress, agentStatus, drawerStatus } = vi.hoisted(() => ({
  agentPresence: vi.fn<(id: string) => Promise<{ connected: number }>>(() => Promise.resolve({ connected: 0 })),
  previewLocate: vi.fn<(id: string, entity: string) => Promise<{ path: string | null }>>(() =>
    Promise.resolve({ path: null }),
  ),
  previewBase: vi.fn<
    (id: string) => Promise<{ base: string; pageFailures?: Array<{ page: string; path: string; message: string }> }>
  >(() => Promise.resolve({ base: '/preview-site/p/sig123/' })),
  previewProgress: vi.fn<
    (id: string) => Promise<{ building: boolean; phase?: string; done?: number; total?: number }>
  >(() => Promise.resolve({ building: false })),
  agentStatus: vi.fn<(id: string) => Promise<{ enabled: boolean }>>(() => Promise.resolve({ enabled: false })),
  // Lets a test drive the live turn status the drawer would report up to the shell.
  drawerStatus: { current: 'idle' as 'idle' | 'thinking' | 'working' },
}));
vi.mock('../src/api', () => ({
  api: {
    agentPresence: (id: string) => agentPresence(id),
    previewLocate: (id: string, entity: string) => previewLocate(id, entity),
    previewBase: (id: string) => previewBase(id),
    previewProgress: (id: string) => previewProgress(id),
    agentStatus: (id: string) => agentStatus(id),
  },
  eventsUrl: (id: string) => `/projects/${id}/events`,
  // Mirror the real implementation's trailing-slash logic so assertions match production behavior.
  previewUrlFrom: (base: string, path = '') => {
    const c = path.replace(/^\/+/, '');
    return `${base}${c}${c === '' || c.endsWith('/') ? '' : '/'}`;
  },
}));
// Stub the drawer: it emits the configured turn status up to the shell (which animates the FAB).
vi.mock('../src/views/AgentDrawer', () => ({
  AgentDrawer: ({ onStatusChange }: { onStatusChange?: (s: 'idle' | 'thinking' | 'working') => void }) => {
    useEffect(() => onStatusChange?.(drawerStatus.current), [onStatusChange]);
    return null;
  },
}));

import { SitePreview } from '../src/views/SitePreview';

/** A controllable EventSource: captures the 'content' listeners so a test can fire events. */
function stubEventSource() {
  const listeners: Array<(e: { data: string }) => void> = [];
  class CtrlEventSource {
    addEventListener(_type: string, cb: (e: { data: string }) => void) {
      listeners.push(cb);
    }
    close() {}
  }
  vi.stubGlobal('EventSource', CtrlEventSource);
  return {
    fire: (payload: object) => act(() => listeners.forEach((cb) => cb({ data: JSON.stringify(payload) }))),
  };
}

beforeEach(() => {
  agentPresence.mockReset();
  agentPresence.mockResolvedValue({ connected: 0 });
  previewLocate.mockReset();
  previewLocate.mockResolvedValue({ path: null });
  previewBase.mockReset();
  previewBase.mockResolvedValue({ base: '/preview-site/p/sig123/' });
  previewProgress.mockReset();
  previewProgress.mockResolvedValue({ building: false }); // nothing narrated unless a test asks for it
  agentStatus.mockReset();
  agentStatus.mockResolvedValue({ enabled: false }); // no on-page assistant button by default
  drawerStatus.current = 'idle';
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SitePreview', () => {
  it('embeds the home preview (at the signed base) in a sandboxed iframe', async () => {
    stubEventSource();
    render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    const frame = await screen.findByTitle('Site preview');
    expect(frame).toHaveAttribute('src', '/preview-site/p/sig123/');
    expect(frame).toHaveAttribute('sandbox', PREVIEW_SANDBOX_ATTR);
  });

  it('narrates the draft build while the first frame is still missing, then stops', async () => {
    // `previewBase` blocks for the whole build, so the wait is otherwise a blank shell. The pill is
    // gated on the iframe's FIRST load: once the preview is up, a build running in the background is
    // the editor's business, not a banner over the author's page.
    stubEventSource();
    previewProgress.mockResolvedValue({ building: true, phase: 'media' });
    render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    expect(await screen.findByText('Processing images…')).toBeInTheDocument();

    fireEvent.load(await screen.findByTitle('Site preview'));
    await waitFor(() => expect(screen.queryByText('Processing images…')).toBeNull());
  });

  it('names the pages the draft build could not render, and says the rest is current', async () => {
    // ★ A broken page no longer freezes the preview — but the author still has to LEARN about it, and
    // they may never browse onto that page. This is the only signal that reaches them off it.
    stubEventSource();
    previewBase.mockResolvedValue({
      base: '/preview-site/p/sig123/',
      pageFailures: [{ page: 'bad', path: '/bad', message: 'render error: unknown image map "gone"' }],
    });
    render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    expect(await screen.findByText('1 page could not be rendered')).toBeInTheDocument();
    expect(screen.getByText('/bad')).toBeInTheDocument();
    expect(screen.getByText(/unknown image map/)).toBeInTheDocument();
    expect(screen.getByText(/every other page in this preview is up to date/i)).toBeInTheDocument();
    // Dismissible — it must not sit on top of the preview forever.
    await act(async () => {
      screen.getByRole('button', { name: 'Dismiss' }).click();
    });
    expect(screen.queryByText('1 page could not be rendered')).not.toBeInTheDocument();
  });

  it('shows no failure banner when every page rendered', async () => {
    stubEventSource();
    render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    await screen.findByTitle('Site preview');
    expect(screen.queryByText(/could not be rendered/)).not.toBeInTheDocument();
  });

  // The "Copy preview link" button was REMOVED from this surface. It floated a low-contrast pill over
  // the customer's own page on every viewport, to duplicate something the editor already does properly:
  // preview share links are minted and managed in Settings → Preview share links, which is also the only
  // place that can issue a link outliving the member-minted, time-bucketed default. Asserted as an
  // absence so it cannot drift back in.
  //
  // Its two tests went with it — including the regression guarding the "Link copied" revert timer against
  // firing on an unmounted tree. That timer no longer exists, so neither does the failure mode.
  it('offers no copy-link button over the preview', async () => {
    stubEventSource();
    render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    await screen.findByTitle('Site preview');
    expect(screen.queryByRole('button', { name: /copy preview link/i })).not.toBeInTheDocument();
  });

  it('shows the agent pill only when a connection exists', async () => {
    stubEventSource();
    agentPresence.mockResolvedValue({ connected: 2 });
    render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    expect(await screen.findByText('Agent connected · 2')).toBeInTheDocument();
  });

  it('shows the WORKING state when an agent-sourced change arrives', async () => {
    const es = stubEventSource();
    render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    await screen.findByTitle('Site preview');
    es.fire({ entityId: 'home', actor: 'agent' });
    expect(await screen.findByText('Agent working…')).toBeInTheDocument();
  });

  it('auto-navigates the iframe to a page that changed', async () => {
    const es = stubEventSource();
    previewLocate.mockResolvedValue({ path: 'about' });
    render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    await screen.findByTitle('Site preview');
    es.fire({ entityId: 'about', actor: 'agent' });
    await waitFor(() =>
      expect(screen.getByTitle('Site preview')).toHaveAttribute('src', '/preview-site/p/sig123/about/'),
    );
    expect(previewLocate).toHaveBeenCalledWith('p', 'about');
  });

  it('reloads the current page on a non-page (global) change', async () => {
    const es = stubEventSource();
    previewLocate.mockResolvedValue({ path: null }); // e.g. a settings change → no navigable route
    render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    await screen.findByTitle('Site preview');
    es.fire({ entityId: 'settings', actor: 'user' });
    // The src gets a cache-busting param (so the same page refetches) rather than navigating away.
    await waitFor(() => expect(screen.getByTitle('Site preview').getAttribute('src')).toMatch(/sig123\/\?r=\d+/));
  });

  it('shows a prominent brand-gradient AI FAB (no halo) when the assistant is enabled + idle', async () => {
    stubEventSource();
    agentStatus.mockResolvedValue({ enabled: true });
    const { container } = render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    const fab = await screen.findByRole('button', { name: 'Open the AI assistant' });
    expect(fab).toHaveTextContent('AI Assistant');
    // Prominent: brand gradient + larger padding/text (not the old white/90 · text-sm pill).
    expect(fab.className).toMatch(/sw-brand-gradient/);
    expect(fab.className).toMatch(/text-base/);
    // Idle → no pulsing halo.
    expect(container.querySelector('.animate-ping')).toBeNull();
  });

  it('adds a pulsing halo + working label to the FAB while the agent is working', async () => {
    stubEventSource();
    agentStatus.mockResolvedValue({ enabled: true });
    drawerStatus.current = 'working';
    const { container } = render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    // The drawer stub reports "working" up → the FAB relabels and grows a pulsing halo.
    expect(await screen.findByRole('button', { name: 'AI is working' })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('.animate-ping')).not.toBeNull());
  });
});

/**
 * MOBILE: the assistant drawer is 26rem BESIDE a desktop page, but `max-w-[92vw]` ON a phone — it
 * covers the bottom-left corner the FAB lives in. So the FAB steps aside while the drawer is up.
 *
 * Nothing is lost by it: the FAB's second job is showing live turn status, and the drawer's own header
 * carries the same state (AgentDrawer's StatusPill) on the surface actually in front of the user.
 */
describe('SitePreview AI FAB on a phone', () => {
  function withMobileViewport() {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('max-width'),
      media: q,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }));
  }
  afterEach(() => vi.unstubAllGlobals());

  it('shows the FAB while the drawer is CLOSED, and hides it once the drawer is open', async () => {
    stubEventSource();
    agentStatus.mockResolvedValue({ enabled: true });
    withMobileViewport();
    render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    const fab = await screen.findByRole('button', { name: 'Open the AI assistant' });
    await act(async () => {
      fab.click();
    });
    expect(screen.queryByRole('button', { name: 'Close the AI assistant' })).not.toBeInTheDocument();
  });

  it('keeps the FAB visible with the drawer open on DESKTOP — there it sits beside the drawer', async () => {
    stubEventSource();
    agentStatus.mockResolvedValue({ enabled: true });
    render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    const fab = await screen.findByRole('button', { name: 'Open the AI assistant' });
    await act(async () => {
      fab.click();
    });
    expect(screen.getByRole('button', { name: 'Close the AI assistant' })).toBeInTheDocument();
  });
});
