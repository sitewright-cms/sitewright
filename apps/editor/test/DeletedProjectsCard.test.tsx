import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { listDeletedProjects, restoreProject, reapProject, reapAllDeletedProjects } = vi.hoisted(() => ({
  listDeletedProjects: vi.fn(),
  restoreProject: vi.fn(),
  reapProject: vi.fn(),
  reapAllDeletedProjects: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    listDeletedProjects: () => listDeletedProjects(),
    restoreProject: (id: string) => restoreProject(id),
    reapProject: (id: string) => reapProject(id),
    reapAllDeletedProjects: () => reapAllDeletedProjects(),
  },
}));

import { DeletedProjectsCard } from '../src/views/DeletedProjectsCard';

const one = { id: 'p1', name: 'Acme', slug: 'acme', deletedAt: '2026-01-02T00:00:00.000Z', deletedBy: 'a@x.test' };

beforeEach(() => {
  vi.clearAllMocks();
  restoreProject.mockResolvedValue(undefined);
  reapProject.mockResolvedValue(undefined);
  reapAllDeletedProjects.mockResolvedValue({ reaped: 1 });
});

describe('DeletedProjectsCard (admin)', () => {
  it('shows the empty state when nothing is deleted', async () => {
    listDeletedProjects.mockResolvedValue({ projects: [] });
    render(<DeletedProjectsCard />);
    expect(await screen.findByText('No deleted projects.')).toBeInTheDocument();
  });

  it('lists a deleted project (with deleter) and restores it', async () => {
    listDeletedProjects.mockResolvedValue({ projects: [one] });
    render(<DeletedProjectsCard />);
    expect(await screen.findByText(/Acme/)).toBeInTheDocument();
    expect(screen.getByText(/by a@x.test/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(restoreProject).toHaveBeenCalledWith('p1'));
  });

  it('reaps a project only after the inline confirm', async () => {
    listDeletedProjects.mockResolvedValue({ projects: [one] });
    render(<DeletedProjectsCard />);
    await screen.findByText(/Acme/);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(reapProject).not.toHaveBeenCalled(); // not yet — needs the confirm
    fireEvent.click(screen.getByRole('button', { name: 'Delete forever' }));
    await waitFor(() => expect(reapProject).toHaveBeenCalledWith('p1'));
  });

  it('reaps all deleted projects after confirming', async () => {
    listDeletedProjects.mockResolvedValue({ projects: [one, { ...one, id: 'p2', name: 'Beta' }] });
    render(<DeletedProjectsCard />);
    await screen.findByText(/Beta/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove all deleted projects' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(reapAllDeletedProjects).toHaveBeenCalled());
  });
});
