import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { useEffect } from 'react'; // used by the AgentDrawer mock's factory (below) at render time

const { agentPresence, previewLocate, previewBase, agentStatus, drawerStatus } = vi.hoisted(() => ({
  agentPresence: vi.fn<(id: string) => Promise<{ connected: number }>>(() => Promise.resolve({ connected: 0 })),
  previewLocate: vi.fn<(id: string, entity: string) => Promise<{ path: string | null }>>(() =>
    Promise.resolve({ path: null }),
  ),
  previewBase: vi.fn<(id: string) => Promise<{ base: string }>>(() => Promise.resolve({ base: '/preview-site/p/sig123/' })),
  agentStatus: vi.fn<(id: string) => Promise<{ enabled: boolean }>>(() => Promise.resolve({ enabled: false })),
  // Lets a test drive the live turn status the drawer would report up to the shell.
  drawerStatus: { current: 'idle' as 'idle' | 'thinking' | 'working' },
}));
vi.mock('../src/api', () => ({
  api: {
    agentPresence: (id: string) => agentPresence(id),
    previewLocate: (id: string, entity: string) => previewLocate(id, entity),
    previewBase: (id: string) => previewBase(id),
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
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  });

  it('copies the share-able preview URL when the button is clicked', async () => {
    stubEventSource();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    const btn = await screen.findByRole('button', { name: 'Copy preview link' });
    await act(async () => {
      btn.click();
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/preview-site/p/sig123/'));
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
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
