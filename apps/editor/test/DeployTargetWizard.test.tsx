import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { listDeployTargets, createDeployTarget, updateDeployTarget, deleteDeployTarget } = vi.hoisted(() => ({
  listDeployTargets: vi.fn<(id: string) => Promise<{ items: unknown[] }>>(() => Promise.resolve({ items: [] })),
  createDeployTarget: vi.fn<(id: string, cfg: unknown) => Promise<{ target: { id: string } }>>(() => Promise.resolve({ target: { id: 't1' } })),
  updateDeployTarget: vi.fn<(id: string, tid: string, cfg: unknown) => Promise<{ target: { id: string } }>>(() => Promise.resolve({ target: { id: 't1' } })),
  deleteDeployTarget: vi.fn<(id: string, tid: string) => Promise<void>>(() => Promise.resolve()),
}));
vi.mock('../src/api', () => ({
  api: {
    listDeployTargets: (id: string) => listDeployTargets(id),
    createDeployTarget: (id: string, cfg: unknown) => createDeployTarget(id, cfg),
    updateDeployTarget: (id: string, tid: string, cfg: unknown) => updateDeployTarget(id, tid, cfg),
    deleteDeployTarget: (id: string, tid: string) => deleteDeployTarget(id, tid),
  },
}));
vi.mock('../src/views/ui/Dialogs', () => ({ useDialogs: () => ({ confirm: vi.fn(() => Promise.resolve(true)), dialog: null }) }));
vi.mock('../src/views/publish/DeployModal', () => ({ DeployModal: () => null }));

import { DeployTargetWizard } from '../src/views/publish/DeployTargetWizard';

const project = { id: 'p', name: 'Acme', slug: 'acme', role: 'owner' as const };

beforeEach(() => {
  for (const m of [listDeployTargets, createDeployTarget, updateDeployTarget, deleteDeployTarget]) m.mockReset();
  listDeployTargets.mockResolvedValue({ items: [] });
  createDeployTarget.mockResolvedValue({ target: { id: 't1' } });
  updateDeployTarget.mockResolvedValue({ target: { id: 't1' } });
});

describe('DeployTargetWizard', () => {
  it('shows the four entry points and opens the Git config to save a token target', async () => {
    render(<DeployTargetWizard project={project} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Git Deploy/ })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Local Hosting/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /FTP \/ FTPS Upload/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /SSH \/ SFTP Upload/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Git Deploy/ }));
    expect(screen.getByLabelText('Repository URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Branch')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'GitHub Pages' } });
    fireEvent.change(screen.getByLabelText('Repository URL'), { target: { value: 'https://github.com/me/site.git' } });
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'ghp_secret' } });
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

  it('configures Local Hosting with Minify + an unlisted secret link', async () => {
    render(<DeployTargetWizard project={project} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Local Hosting/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Local Hosting/ }));
    fireEvent.click(screen.getByLabelText('Minify HTML'));
    fireEvent.click(screen.getByLabelText('Require a secret link (unlisted)'));
    fireEvent.click(screen.getByRole('button', { name: 'Save target' }));

    await waitFor(() => expect(createDeployTarget).toHaveBeenCalled());
    const cfg = createDeployTarget.mock.calls[0]![1] as { protocol: string; minifyHtml?: boolean; previewToken?: string };
    expect(cfg.protocol).toBe('local');
    expect(cfg.minifyHtml).toBe(true);
    expect(typeof cfg.previewToken).toBe('string');
    expect((cfg.previewToken ?? '').length).toBeGreaterThanOrEqual(16);
  });

  it('FTP/FTPS card defaults to plain FTP and flips to FTPS via the TLS toggle', async () => {
    render(<DeployTargetWizard project={project} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /FTP \/ FTPS Upload/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /FTP \/ FTPS Upload/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Web' } });
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'ftp.example.com' } });
    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'deployer' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } }); // create-mode label is plain "Password"
    fireEvent.click(screen.getByLabelText('Use TLS (FTPS)'));
    fireEvent.click(screen.getByRole('button', { name: 'Save target' }));
    await waitFor(() => expect(createDeployTarget).toHaveBeenCalled());
    const cfg = createDeployTarget.mock.calls[0]![1] as { protocol: string };
    expect(cfg.protocol).toBe('ftps');
  });

  it('creates an SFTP target with private-key auth', async () => {
    render(<DeployTargetWizard project={project} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /SSH \/ SFTP Upload/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /SSH \/ SFTP Upload/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Box' } });
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'box.example.com' } });
    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'deployer' } });
    fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'key' } });
    fireEvent.change(screen.getByLabelText('Private key (PEM / OpenSSH)'), { target: { value: '-----BEGIN OPENSSH PRIVATE KEY-----\nk\n-----END OPENSSH PRIVATE KEY-----' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save target' }));
    await waitFor(() => expect(createDeployTarget).toHaveBeenCalled());
    const cfg = createDeployTarget.mock.calls[0]![1] as { protocol: string; privateKey?: string; password?: string };
    expect(cfg.protocol).toBe('sftp');
    expect(cfg.privateKey).toContain('OPENSSH PRIVATE KEY');
    expect(cfg.password).toBeUndefined();
  });

  it('edits a git target (rotates the token; protocol/branch sent, secret blank by default)', async () => {
    listDeployTargets.mockResolvedValue({
      items: [{ id: 'g1', name: 'Pages', protocol: 'git', repoUrl: 'https://github.com/me/site.git', branch: 'gh-pages' }],
    });
    render(<DeployTargetWizard project={project} />);
    await waitFor(() => expect(screen.getByText('Pages')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Pages' }));
    expect((screen.getByLabelText('Repository URL') as HTMLInputElement).value).toBe('https://github.com/me/site.git');
    // Rotate the token (the field is blank on edit until typed).
    fireEvent.change(screen.getByLabelText('Access token (keep blank to keep)'), { target: { value: 'ghp_new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateDeployTarget).toHaveBeenCalled());
    const [, tid, cfg] = updateDeployTarget.mock.calls[0]! as [string, string, Record<string, unknown>];
    expect(tid).toBe('g1');
    expect(cfg).toMatchObject({ branch: 'gh-pages', token: 'ghp_new' });
    expect(cfg).not.toHaveProperty('protocol');
  });

  it('hides the Local Hosting card once a local target exists, and edits a remote target in place', async () => {
    listDeployTargets.mockResolvedValue({
      items: [
        { id: 'L', name: 'Local Hosting', protocol: 'local' },
        { id: 's1', name: 'Prod', protocol: 'sftp', host: 'h.example', user: 'u', remoteDir: '/www' },
      ],
    });
    render(<DeployTargetWizard project={project} />);
    await waitFor(() => expect(screen.getByText('Prod')).toBeInTheDocument());
    // Local is a singleton → its add-card is gone.
    expect(screen.queryByRole('button', { name: /^Local Hosting/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Prod' }));
    // Edit prefills non-secret fields; protocol is locked (no protocol sent on PUT).
    expect((screen.getByLabelText('Host') as HTMLInputElement).value).toBe('h.example');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Prod 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateDeployTarget).toHaveBeenCalled());
    const [, tid, cfg] = updateDeployTarget.mock.calls[0]! as [string, string, Record<string, unknown>];
    expect(tid).toBe('s1');
    expect(cfg).toMatchObject({ name: 'Prod 2', host: 'h.example', user: 'u' });
    expect(cfg).not.toHaveProperty('protocol');
    expect(cfg).not.toHaveProperty('password'); // blank → not sent → secret preserved
  });
});
