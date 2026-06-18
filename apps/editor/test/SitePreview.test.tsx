import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const { agentPresence, previewLocate } = vi.hoisted(() => ({
  agentPresence: vi.fn<(id: string) => Promise<{ connected: number }>>(() => Promise.resolve({ connected: 0 })),
  previewLocate: vi.fn<(id: string, entity: string) => Promise<{ path: string | null }>>(() =>
    Promise.resolve({ path: null }),
  ),
}));
vi.mock('../src/api', () => ({
  api: {
    agentPresence: (id: string) => agentPresence(id),
    previewLocate: (id: string, entity: string) => previewLocate(id, entity),
  },
  eventsUrl: (id: string) => `/projects/${id}/events`,
  // Mirror the real implementation's trailing-slash logic so assertions match production behavior.
  previewSiteUrl: (id: string, path = '') => {
    const c = path.replace(/^\/+/, '');
    return `/projects/${id}/preview-site/${c}${c === '' || c.endsWith('/') ? '' : '/'}`;
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
    fire: (payload: object) =>
      act(() => listeners.forEach((cb) => cb({ data: JSON.stringify(payload) }))),
  };
}

beforeEach(() => {
  agentPresence.mockReset();
  agentPresence.mockResolvedValue({ connected: 0 });
  previewLocate.mockReset();
  previewLocate.mockResolvedValue({ path: null });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SitePreview', () => {
  it('embeds the home preview in a sandboxed iframe', async () => {
    stubEventSource();
    render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    const frame = screen.getByTitle('Site preview');
    expect(frame).toHaveAttribute('src', '/projects/p/preview-site/');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
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
    es.fire({ entityId: 'home', actor: 'agent' });
    expect(await screen.findByText('Agent working…')).toBeInTheDocument();
  });

  it('auto-navigates the iframe to a page that changed', async () => {
    const es = stubEventSource();
    previewLocate.mockResolvedValue({ path: 'about' });
    render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    es.fire({ entityId: 'about', actor: 'agent' });
    await waitFor(() =>
      expect(screen.getByTitle('Site preview')).toHaveAttribute('src', '/projects/p/preview-site/about/'),
    );
    expect(previewLocate).toHaveBeenCalledWith('p', 'about');
  });

  it('reloads the current page on a non-page (global) change', async () => {
    const es = stubEventSource();
    previewLocate.mockResolvedValue({ path: null }); // e.g. a settings change → no navigable route
    render(<SitePreview target={{ projectId: 'p', path: '' }} />);
    es.fire({ entityId: 'settings', actor: 'user' });
    // The src gets a cache-busting param (so the same page refetches) rather than navigating away.
    await waitFor(() =>
      expect(screen.getByTitle('Site preview').getAttribute('src')).toMatch(/preview-site\/\?r=\d+/),
    );
  });
});
