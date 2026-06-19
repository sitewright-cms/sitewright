import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const { agentPresence, previewLocate, previewBase } = vi.hoisted(() => ({
  agentPresence: vi.fn<(id: string) => Promise<{ connected: number }>>(() => Promise.resolve({ connected: 0 })),
  previewLocate: vi.fn<(id: string, entity: string) => Promise<{ path: string | null }>>(() =>
    Promise.resolve({ path: null }),
  ),
  previewBase: vi.fn<(id: string) => Promise<{ base: string }>>(() => Promise.resolve({ base: '/preview-site/p/sig123/' })),
}));
vi.mock('../src/api', () => ({
  api: {
    agentPresence: (id: string) => agentPresence(id),
    previewLocate: (id: string, entity: string) => previewLocate(id, entity),
    previewBase: (id: string) => previewBase(id),
  },
  eventsUrl: (id: string) => `/projects/${id}/events`,
  // Mirror the real implementation's trailing-slash logic so assertions match production behavior.
  previewUrlFrom: (base: string, path = '') => {
    const c = path.replace(/^\/+/, '');
    return `${base}${c}${c === '' || c.endsWith('/') ? '' : '/'}`;
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
});
