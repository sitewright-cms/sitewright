import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { listAgentConnections, disconnectAgent } = vi.hoisted(() => ({
  listAgentConnections: vi.fn<(id: string) => Promise<{ items: unknown[] }>>(),
  disconnectAgent: vi.fn<(pid: string, id: string) => Promise<void>>(),
}));
vi.mock('../src/api', () => ({
  api: {
    listAgentConnections: (id: string) => listAgentConnections(id),
    disconnectAgent: (pid: string, id: string) => disconnectAgent(pid, id),
  },
}));

import { AgentDetailsModal } from '../src/views/AgentDetailsModal';

const conn = (over: Record<string, unknown> = {}) => ({
  id: 'oauth:u1',
  kind: 'oauth',
  name: 'ChatGPT',
  role: 'owner',
  capabilities: ['content:read', 'content:write'],
  connectedAt: '2026-06-09T00:00:00.000Z',
  expiresAt: '2030-01-01T00:00:00.000Z',
  lastUsedAt: '2026-06-10T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  listAgentConnections.mockReset();
  disconnectAgent.mockReset();
});

describe('AgentDetailsModal', () => {
  it('lists a live OAuth/MCP session with its badge and capabilities', async () => {
    listAgentConnections.mockResolvedValue({ items: [conn()] });
    render(<AgentDetailsModal projectId="p" onClose={() => {}} />);
    expect(await screen.findByText('ChatGPT')).toBeInTheDocument();
    expect(screen.getByText('OAuth / MCP')).toBeInTheDocument();
    expect(screen.getByText('content:write')).toBeInTheDocument();
  });

  it('distinguishes a personal token from an OAuth session', async () => {
    listAgentConnections.mockResolvedValue({ items: [conn({ id: 'k2', name: 'CI bot', kind: 'pat' })] });
    render(<AgentDetailsModal projectId="p" onClose={() => {}} />);
    expect(await screen.findByText('Personal token')).toBeInTheDocument();
  });

  it('leads with the connect guide (4 tabs) when there are no connections', async () => {
    listAgentConnections.mockResolvedValue({ items: [] });
    render(<AgentDetailsModal projectId="p" onClose={() => {}} />);
    expect(await screen.findByText('Connect an agent')).toBeInTheDocument();
    // Four connect options, as tabs: three hosted (ChatGPT / Claude.ai / Le Chat) + local CLI.
    expect(screen.getByRole('tab', { name: 'ChatGPT.com' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Claude.ai' })).toBeInTheDocument();
    const leChatTab = screen.getByRole('tab', { name: 'Le Chat' });
    const cliTab = screen.getByRole('tab', { name: 'Local CLI Agents' });
    // The default (ChatGPT) tab shows the remote MCP server URL (origin/mcp) and the accurate
    // plan note — Developer mode is a staged beta that's been reachable on free accounts too.
    expect(screen.getByText(/\/mcp$/)).toBeInTheDocument();
    expect(screen.getByText(/reachable on free accounts/)).toBeInTheDocument();
    // Claude.ai custom connectors DO work on Free (one connector).
    screen.getByRole('tab', { name: 'Claude.ai' }).click();
    expect(await screen.findByText(/including Free/)).toBeInTheDocument();
    // Le Chat is also free.
    leChatTab.click();
    expect(await screen.findByText(/Free plan/)).toBeInTheDocument();
    // The CLI tab carries the install step, the universal mcpServers block, and the config helper.
    cliTab.click();
    expect(await screen.findByText(/npm install -g @sitewright\/cli/)).toBeInTheDocument();
    expect(screen.getByText(/"mcpServers"/)).toBeInTheDocument();
    expect(screen.getByText(/sitewright config/)).toBeInTheDocument();
  });

  it('disconnects only after a two-step confirm, reloads, and notifies onChanged', async () => {
    listAgentConnections.mockResolvedValueOnce({ items: [conn()] }).mockResolvedValueOnce({ items: [] });
    disconnectAgent.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(<AgentDetailsModal projectId="p" onClose={() => {}} onChanged={onChanged} />);

    // First click arms the confirm; nothing is revoked yet.
    (await screen.findByRole('button', { name: 'Disconnect' })).click();
    expect(disconnectAgent).not.toHaveBeenCalled();

    // The confirm click severs the session (by its opaque oauth:<user> id), then the list reloads.
    (await screen.findByRole('button', { name: 'Confirm' })).click();
    await waitFor(() => expect(disconnectAgent).toHaveBeenCalledWith('p', 'oauth:u1'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(await screen.findByText('Connect an agent')).toBeInTheDocument(); // now empty → guide leads
  });

  it('surfaces a load error', async () => {
    listAgentConnections.mockRejectedValue(new Error('boom'));
    render(<AgentDetailsModal projectId="p" onClose={() => {}} />);
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
