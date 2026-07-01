import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AgentChatHandlers } from '../src/api';

const getAgentGrant = vi.fn();
const putAgentGrant = vi.fn();
const streamAgentMessage = vi.fn();
vi.mock('../src/api', () => ({
  api: {
    getAgentGrant: (id: string) => getAgentGrant(id),
    putAgentGrant: (id: string, body: unknown) => putAgentGrant(id, body),
    streamAgentMessage: (id: string, body: unknown, handlers: AgentChatHandlers, signal?: AbortSignal) => streamAgentMessage(id, body, handlers, signal),
  },
}));

import { AgentDrawer } from '../src/views/AgentDrawer';

beforeEach(() => {
  getAgentGrant.mockReset();
  putAgentGrant.mockReset();
  streamAgentMessage.mockReset();
});

describe('AgentDrawer', () => {
  it('shows the consent panel first, saves the narrowed grant, then reveals the chat', async () => {
    getAgentGrant.mockResolvedValue({ configured: false, capabilities: ['content:read', 'content:write', 'content:delete', 'publish'], autonomy: 'full' });
    putAgentGrant.mockResolvedValue({ configured: true, capabilities: ['content:read', 'content:write', 'publish'], autonomy: 'full' });
    render(<AgentDrawer projectId="p" open onClose={() => {}} getPath={() => '/'} />);

    expect(await screen.findByText(/Choose what the assistant may do/)).toBeInTheDocument();
    // content:read is on + disabled; uncheck delete before approving.
    expect((screen.getByLabelText('Read content') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Delete content'));
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(putAgentGrant).toHaveBeenCalled());
    expect(putAgentGrant.mock.calls[0]![1]).toEqual({ capabilities: ['content:read', 'content:write', 'publish'], autonomy: 'full' });
    // chat composer appears
    expect(await screen.findByPlaceholderText(/Ask the assistant/)).toBeInTheDocument();
  });

  it('sends a message with the current page as context and streams the reply', async () => {
    getAgentGrant.mockResolvedValue({ configured: true, capabilities: ['content:read', 'content:write'], autonomy: 'full' });
    streamAgentMessage.mockImplementation(async (_id: string, _body: unknown, handlers: AgentChatHandlers) => {
      handlers.onStart?.({ conversationId: 'c1', model: 'm' });
      handlers.onTool?.({ id: 't1', name: 'put_page', input: {} });
      handlers.onToolResult?.({ id: 't1', name: 'put_page', ok: true, summary: 'done' });
      handlers.onText?.('Updated the headline.');
      handlers.onDone?.('Updated the headline.');
    });
    render(<AgentDrawer projectId="p" open onClose={() => {}} getPath={() => '/about'} />);

    const input = await screen.findByPlaceholderText(/Ask the assistant/);
    fireEvent.change(input, { target: { value: 'shorten the headline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(streamAgentMessage).toHaveBeenCalled());
    expect(streamAgentMessage.mock.calls[0]![1]).toMatchObject({ message: 'shorten the headline', context: { path: '/about' } });
    expect(await screen.findByText('shorten the headline')).toBeInTheDocument(); // user bubble
    expect(await screen.findByText('Updated the headline.')).toBeInTheDocument(); // assistant reply
    expect(screen.getByText('Editing a page')).toBeInTheDocument(); // the tool activity line
  });

  it('aborts the in-flight stream when the drawer closes', async () => {
    getAgentGrant.mockResolvedValue({ configured: true, capabilities: ['content:read'], autonomy: 'full' });
    let capturedSignal: AbortSignal | undefined;
    streamAgentMessage.mockImplementation((_id: string, _body: unknown, _h: AgentChatHandlers, signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<void>(() => {}); // never resolves — a live stream
    });
    const { rerender } = render(<AgentDrawer projectId="p" open onClose={() => {}} getPath={() => '/'} />);
    fireEvent.change(await screen.findByPlaceholderText(/Ask the assistant/), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal!.aborted).toBe(false);
    rerender(<AgentDrawer projectId="p" open={false} onClose={() => {}} getPath={() => '/'} />);
    expect(capturedSignal!.aborted).toBe(true);
  });

  it('surfaces a stream error', async () => {
    getAgentGrant.mockResolvedValue({ configured: true, capabilities: ['content:read'], autonomy: 'full' });
    streamAgentMessage.mockImplementation(async (_id: string, _body: unknown, handlers: AgentChatHandlers) => {
      handlers.onError?.('AI project quota exhausted for this month');
    });
    render(<AgentDrawer projectId="p" open onClose={() => {}} getPath={() => '/'} />);
    fireEvent.change(await screen.findByPlaceholderText(/Ask the assistant/), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/quota exhausted/)).toBeInTheDocument();
  });
});
