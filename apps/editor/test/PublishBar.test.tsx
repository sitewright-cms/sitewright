import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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
}));
vi.mock('../src/views/publish/DeployForm', () => ({ DeployForm: () => <div>DEPLOY FORM</div> }));

import { PublishBar } from '../src/views/PublishBar';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };
const release = { publishedAt: '2026-01-01T00:00:00.000Z', routes: 3, bytes: 100 };

beforeEach(() => {
  publishStatus.mockReset();
  publish.mockReset();
});

describe('PublishBar dirty signal', () => {
  it('is GREEN with an "Unpublished changes" hint when dirty', async () => {
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: true });
    render(<PublishBar project={project} />);
    const btn = await screen.findByRole('button', { name: /Publish/ });
    await waitFor(() => expect(btn.className).toContain('bg-emerald-600'));
    expect(screen.getByText('Unpublished changes')).toBeInTheDocument();
  });

  it('is NEUTRAL (not green) when everything is published', async () => {
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: false });
    render(<PublishBar project={project} />);
    const btn = await screen.findByRole('button', { name: /Publish/ });
    await waitFor(() => expect(screen.getByText(/Published · 3 pages/)).toBeInTheDocument());
    expect(btn.className).not.toContain('bg-emerald-600');
  });

  it('clears dirty after a successful publish', async () => {
    publishStatus.mockResolvedValue({ release, url: '/sites/acme/', dirty: true });
    publish.mockResolvedValue({ release, url: '/sites/acme/', dirty: false });
    render(<PublishBar project={project} />);
    const btn = await screen.findByRole('button', { name: /Publish/ });
    await waitFor(() => expect(btn.className).toContain('bg-emerald-600'));
    btn.click();
    await waitFor(() => expect(publish).toHaveBeenCalledWith('p'));
    await waitFor(() => expect(btn.className).not.toContain('bg-emerald-600'));
  });
});
