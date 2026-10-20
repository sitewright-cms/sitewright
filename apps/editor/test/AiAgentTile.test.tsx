import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AiConfigView } from '@sitewright/schema';

const api = vi.hoisted(() => ({ getAiConfig: vi.fn(), setAiBuiltIn: vi.fn(), putAiConfig: vi.fn(), deleteAiConfig: vi.fn(), testAiConfig: vi.fn() }));
vi.mock('../src/api', () => ({ api }));

import { AiAgentTile, aiAgentStatus } from '../src/views/settings/AiAgentTile';

const own: AiConfigView = { id: 'ai-config', enabled: true, provider: 'anthropic', hasKey: true };

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('the AI Agent tile', () => {
  it('shows a client their own agent and the built-in switch locked, saying who decides', async () => {
    api.getAiConfig.mockResolvedValue({ aiConfig: own, canSetBuiltIn: false });
    render(<AiAgentTile projectId="p1" />);
    expect(await screen.findByText('Anthropic')).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: "Use the platform's built-in agent on this project" });
    expect(sw).toBeDisabled();
    expect(sw).toHaveAccessibleDescription("Your agency (an admin or a developer) decides whether this project uses the platform's agent.");
  });

  it('lets staff switch the built-in agent on', async () => {
    api.getAiConfig.mockResolvedValue({ aiConfig: null, canSetBuiltIn: true });
    api.setAiBuiltIn.mockResolvedValue({ aiConfig: { id: 'ai-config', enabled: false, provider: 'anthropic', hasKey: false, useBuiltIn: true } });
    render(<AiAgentTile projectId="p1" />);
    const sw = await screen.findByRole('switch', { name: "Use the platform's built-in agent on this project" });
    expect(sw).toBeEnabled(); // never drawn locked first: the tile waits for the read
    fireEvent.click(sw);
    await waitFor(() => expect(api.setAiBuiltIn).toHaveBeenCalledWith('p1', true));
    await waitFor(() => expect(screen.getByRole('switch', { name: "Use the platform's built-in agent on this project" })).toBeChecked());
  });

  it("opens the project's own agent settings, for every writer", async () => {
    api.getAiConfig.mockResolvedValue({ aiConfig: null, canSetBuiltIn: false });
    render(<AiAgentTile projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: "Edit this project's own AI agent" }));
    expect(await screen.findByRole('dialog', { name: 'AI Agent' })).toBeInTheDocument();
    await waitFor(() => expect(api.getAiConfig).toHaveBeenCalledTimes(2)); // the form loads its own copy
  });

  it('says when the AI settings are unavailable (no encryption key on the instance)', async () => {
    api.getAiConfig.mockRejectedValue(new Error('not found'));
    render(<AiAgentTile projectId="p1" />);
    expect(await screen.findByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('summarises what answers on the tile', () => {
    expect(aiAgentStatus(null)).toEqual({ kind: 'default', label: 'Platform default' });
    expect(aiAgentStatus(own)).toEqual({ kind: 'set', label: 'Own agent' });
    expect(aiAgentStatus({ ...own, useBuiltIn: true })).toEqual({ kind: 'set', label: 'Own + built-in' });
    expect(aiAgentStatus({ ...own, enabled: false, useBuiltIn: true })).toEqual({ kind: 'set', label: 'Built-in' });
    expect(aiAgentStatus({ ...own, hasKey: false })).toEqual({ kind: 'default', label: 'Platform default' });
  });
});
