import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { listDeployTargets, createDeployTarget, deploy, deleteDeployTarget } = vi.hoisted(() => ({
  listDeployTargets: vi.fn<(id: string) => Promise<{ items: unknown[] }>>(() => Promise.resolve({ items: [] })),
  createDeployTarget: vi.fn(() => Promise.resolve({ target: { id: 't1' } })),
  deploy: vi.fn(),
  deleteDeployTarget: vi.fn(() => Promise.resolve()),
}));
vi.mock('../src/api', () => ({
  api: {
    listDeployTargets: (id: string) => listDeployTargets(id),
    createDeployTarget: (id: string, cfg: unknown) => createDeployTarget(id, cfg),
    deploy: (id: string, cfg: unknown) => deploy(id, cfg),
    deleteDeployTarget: (id: string, tid: string) => deleteDeployTarget(id, tid),
    getSettings: vi.fn(() => Promise.resolve({ item: { website: {} } })),
  },
}));
vi.mock('../src/views/ui/Dialogs', () => ({ useDialogs: () => ({ confirm: vi.fn(() => Promise.resolve(true)), dialog: null }) }));

import { DeployForm } from '../src/views/publish/DeployForm';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };

beforeEach(() => {
  listDeployTargets.mockReset();
  listDeployTargets.mockResolvedValue({ items: [] });
  createDeployTarget.mockReset();
  createDeployTarget.mockResolvedValue({ target: { id: 't1' } });
});

describe('DeployForm — git target', () => {
  it('switching to Git shows repoUrl/branch/token (not host) and saves a git target', async () => {
    render(<DeployForm project={project} />);
    // The saved-targets list loads (empty) → the Save section appears.
    await waitFor(() => expect(screen.getByLabelText('Target name')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Deploy protocol'), { target: { value: 'git' } });
    // Git fields replace the FTP fields.
    expect(screen.getByLabelText('Git repository URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Git branch')).toBeInTheDocument();
    expect(screen.getByLabelText('Git access token')).toBeInTheDocument();
    expect(screen.queryByLabelText('Deploy host')).toBeNull();
    // No ad-hoc Deploy button for git (it is saved, then deployed from the header).
    expect(screen.queryByRole('button', { name: 'Deploy' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Git repository URL'), { target: { value: 'https://github.com/me/site.git' } });
    fireEvent.change(screen.getByLabelText('Git access token'), { target: { value: 'ghp_secret' } });
    fireEvent.change(screen.getByLabelText('Target name'), { target: { value: 'GitHub Pages' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save target' }));

    await waitFor(() =>
      expect(createDeployTarget).toHaveBeenCalledWith('p', {
        name: 'GitHub Pages',
        protocol: 'git',
        repoUrl: 'https://github.com/me/site.git',
        branch: 'gh-pages',
        token: 'ghp_secret',
      }),
    );
  });

  it('refuses to save a git target with no token', async () => {
    render(<DeployForm project={project} />);
    await waitFor(() => expect(screen.getByLabelText('Target name')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Deploy protocol'), { target: { value: 'git' } });
    fireEvent.change(screen.getByLabelText('Git repository URL'), { target: { value: 'https://github.com/me/site.git' } });
    fireEvent.change(screen.getByLabelText('Target name'), { target: { value: 'GH' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save target' }));
    await waitFor(() => expect(screen.getByText(/access token are required/i)).toBeInTheDocument());
    expect(createDeployTarget).not.toHaveBeenCalled();
  });
});
