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
  localStorage.clear(); // the drawer persists the transcript per project — isolate tests
});

describe('AgentDrawer', () => {
  it('persists the transcript across a reload and clears it on New chat', async () => {
    getAgentGrant.mockResolvedValue({ configured: true, capabilities: ['content:read', 'content:write'], autonomy: 'full' });
    streamAgentMessage.mockImplementation(async (_id: string, _body: unknown, handlers: AgentChatHandlers) => {
      handlers.onStart?.({ conversationId: 'c1', model: 'm' });
      handlers.onText?.('Done.');
      handlers.onDone?.('Done.');
    });
    const first = render(<AgentDrawer projectId="persist-proj" open onClose={() => {}} getPath={() => '/'} />);
    fireEvent.change(await screen.findByPlaceholderText(/Ask the assistant/), { target: { value: 'change the headline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Done.')).toBeInTheDocument();
    first.unmount();

    // "Reload": a fresh mount rehydrates the transcript from localStorage.
    render(<AgentDrawer projectId="persist-proj" open onClose={() => {}} getPath={() => '/'} />);
    expect(await screen.findByText('change the headline')).toBeInTheDocument();
    expect(screen.getByText('Done.')).toBeInTheDocument();

    // New chat clears it (and localStorage), so a further reload shows nothing.
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(screen.queryByText('change the headline')).not.toBeInTheDocument();
    expect(localStorage.getItem('sw-agent-chat:persist-proj')).toBeNull();
  });

  it('opens a NEW bubble when the agent talks again after a tool, and totals session tokens', async () => {
    getAgentGrant.mockResolvedValue({ configured: true, capabilities: ['content:read', 'content:write'], autonomy: 'full' });
    streamAgentMessage.mockImplementation(async (_id: string, _body: unknown, handlers: AgentChatHandlers) => {
      handlers.onStart?.({ conversationId: 'c1', model: 'm' });
      handlers.onText?.('Adding the hero.');
      handlers.onTool?.({ id: 't1', name: 'put_page', input: {} });
      handlers.onToolResult?.({ id: 't1', name: 'put_page', ok: true, summary: 'saved' });
      handlers.onText?.('Now the features section.'); // resumes AFTER the tool → new bubble
      handlers.onUsage?.({ inputTokens: 900, outputTokens: 200, projectMonthToDate: 1 });
      handlers.onDone?.('Now the features section.');
    });
    render(<AgentDrawer projectId="p" open onClose={() => {}} getPath={() => '/'} />);
    fireEvent.change(await screen.findByPlaceholderText(/Ask the assistant/), { target: { value: 'build a landing page' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    // Two SEPARATE assistant bubbles (not one concatenated blob).
    expect(await screen.findByText('Adding the hero.')).toBeInTheDocument();
    expect(await screen.findByText('Now the features section.')).toBeInTheDocument();
    // Session token total in the header (exact "1,100 tok", distinct from the per-bubble "… tokens").
    expect(await screen.findByText('1,100 tok')).toBeInTheDocument();
  });

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

  it('attaches an image and sends it with the message', async () => {
    getAgentGrant.mockResolvedValue({ configured: true, capabilities: ['content:read', 'content:write'], autonomy: 'full' });
    streamAgentMessage.mockResolvedValue(undefined);
    const { container } = render(<AgentDrawer projectId="p" open onClose={() => {}} getPath={() => '/' } />);
    await screen.findByPlaceholderText(/Ask the assistant/);

    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    // The attachment chip shows the filename once the FileReader resolves.
    expect(await screen.findByText('shot.png')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(streamAgentMessage).toHaveBeenCalled());
    const body = streamAgentMessage.mock.calls[0]![1] as { attachments?: Array<{ kind: string; mimeType: string; data: string }> };
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments![0]).toMatchObject({ kind: 'image', mimeType: 'image/png' });
    expect(body.attachments![0]!.data.length).toBeGreaterThan(0); // base64, no data: prefix
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

  it('shows WHY an edit failed and the response token count', async () => {
    getAgentGrant.mockResolvedValue({ configured: true, capabilities: ['content:read', 'content:write'], autonomy: 'full' });
    streamAgentMessage.mockImplementation(async (_id: string, _body: unknown, handlers: AgentChatHandlers) => {
      handlers.onStart?.({ conversationId: 'c1', model: 'm' });
      handlers.onTool?.({ id: 't1', name: 'put_page', input: {} });
      handlers.onToolResult?.({ id: 't1', name: 'put_page', ok: false, summary: 'unsafe template: an inline "onclick" event-handler attribute.' });
      handlers.onUsage?.({ inputTokens: 1200, outputTokens: 340, projectMonthToDate: 5000 });
      handlers.onDone?.('I could not apply that change.');
    });
    render(<AgentDrawer projectId="p" open onClose={() => {}} getPath={() => '/'} />);
    fireEvent.change(await screen.findByPlaceholderText(/Ask the assistant/), { target: { value: 'add a script' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    // The failure reason is shown (not just a ✗), and the per-response token total appears.
    expect(await screen.findByText(/unsafe template: an inline "onclick"/)).toBeInTheDocument();
    expect(await screen.findByText(/1,540 tokens/)).toBeInTheDocument();
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
