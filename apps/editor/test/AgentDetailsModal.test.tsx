import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { listAgentConnections, deleteApiKey } = vi.hoisted(() => ({
  listAgentConnections: vi.fn<(id: string) => Promise<{ items: unknown[] }>>(),
  deleteApiKey: vi.fn<(pid: string, id: string) => Promise<void>>(),
}));
vi.mock('../src/api', () => ({
  api: {
    listAgentConnections: (id: string) => listAgentConnections(id),
    deleteApiKey: (pid: string, id: string) => deleteApiKey(pid, id),
  },
}));

import { AgentDetailsModal } from '../src/views/AgentDetailsModal';

const conn = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  name: 'ChatGPT',
  role: 'owner',
  capabilities: ['content:read', 'content:write'],
  tokenPrefix: 'sw_abcd',
  expiresAt: '2030-01-01T00:00:00.000Z',
  revokedAt: null,
  lastUsedAt: '2026-06-10T00:00:00.000Z',
  createdAt: '2026-06-09T00:00:00.000Z',
  source: 'oauth',
  ...over,
});

beforeEach(() => {
  listAgentConnections.mockReset();
  deleteApiKey.mockReset();
});

describe('AgentDetailsModal', () => {
  it('lists an active connection with its source badge and capabilities', async () => {
    listAgentConnections.mockResolvedValue({ items: [conn()] });
    render(<AgentDetailsModal projectId="p" onClose={() => {}} />);
    expect(await screen.findByText('ChatGPT')).toBeInTheDocument();
    expect(screen.getByText('OAuth / MCP')).toBeInTheDocument();
    expect(screen.getByText('content:write')).toBeInTheDocument();
  });

  it('distinguishes a personal token from an OAuth session', async () => {
    listAgentConnections.mockResolvedValue({ items: [conn({ id: 'k2', name: 'CI bot', source: 'pat' })] });
    render(<AgentDetailsModal projectId="p" onClose={() => {}} />);
    expect(await screen.findByText('Personal token')).toBeInTheDocument();
  });

  it('shows an empty state when there are no active connections', async () => {
    listAgentConnections.mockResolvedValue({ items: [] });
    render(<AgentDetailsModal projectId="p" onClose={() => {}} />);
    expect(await screen.findByText('No active agent connections.')).toBeInTheDocument();
  });

  it('disconnects only after a two-step confirm, then reloads the list', async () => {
    listAgentConnections.mockResolvedValueOnce({ items: [conn()] }).mockResolvedValueOnce({ items: [] });
    deleteApiKey.mockResolvedValue(undefined);
    render(<AgentDetailsModal projectId="p" onClose={() => {}} />);

    // First click arms the confirm; nothing is revoked yet.
    (await screen.findByRole('button', { name: 'Disconnect' })).click();
    expect(deleteApiKey).not.toHaveBeenCalled();

    // The confirm click actually revokes the token, then the list reloads to empty.
    (await screen.findByRole('button', { name: 'Confirm' })).click();
    await waitFor(() => expect(deleteApiKey).toHaveBeenCalledWith('p', 'k1'));
    expect(await screen.findByText('No active agent connections.')).toBeInTheDocument();
  });

  it('surfaces a load error', async () => {
    listAgentConnections.mockRejectedValue(new Error('boom'));
    render(<AgentDetailsModal projectId="p" onClose={() => {}} />);
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
