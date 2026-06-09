import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const { publishStatus, publish, archiveUrl } = vi.hoisted(() => ({
  publishStatus: vi.fn(),
  publish: vi.fn(),
  archiveUrl: vi.fn<(id: string) => string>(() => '/projects/p/publish/archive'),
}));
vi.mock('../src/api', () => ({
  api: {
    publishStatus: (id: string) => publishStatus(id),
    publish: (id: string) => publish(id),
    archiveUrl: (id: string) => archiveUrl(id),
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
    const listeners: Array<() => void> = [];
    class CtrlEventSource {
      addEventListener(_type: string, cb: () => void) {
        listeners.push(cb);
      }
      close() {}
    }
    vi.stubGlobal('EventSource', CtrlEventSource);
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: false });
    render(<PublishBar project={project} />);
    await screen.findByRole('link', { name: /Preview/ }); // published + clean → Preview
    act(() => listeners.forEach((cb) => cb())); // an edit lands on the change stream
    expect(await screen.findByRole('button', { name: 'Publish' })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
