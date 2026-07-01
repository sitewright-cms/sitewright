import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AiConfigInput } from '../src/api';

const getAiConfig = vi.fn();
const putAiConfig = vi.fn();
vi.mock('../src/api', () => ({
  api: {
    getAiConfig: () => getAiConfig(),
    putAiConfig: (_p: string, body: AiConfigInput) => putAiConfig(body),
    deleteAiConfig: () => Promise.resolve(),
  },
}));

import { AiConfig } from '../src/views/AiConfig';

beforeEach(() => {
  getAiConfig.mockReset();
  putAiConfig.mockReset();
  putAiConfig.mockResolvedValue({ aiConfig: { id: 'ai-config', enabled: true, provider: 'anthropic', hasKey: true } });
});

describe('AiConfig', () => {
  it('saves a new BYO config (key + limit included only when typed)', async () => {
    getAiConfig.mockResolvedValue({ aiConfig: null });
    render(<AiConfig projectId="p" />);
    fireEvent.click(await screen.findByLabelText("Use this project's own AI provider")); // enable → fields appear
    fireEvent.change(screen.getByLabelText('AI model'), { target: { value: 'claude-opus-4-8' } });
    fireEvent.change(screen.getByLabelText('AI API key'), { target: { value: 'sk-proj' } });
    fireEvent.change(screen.getByLabelText('Monthly token cap'), { target: { value: '50000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save AI config' }));
    await waitFor(() => expect(putAiConfig).toHaveBeenCalled());
    const body = putAiConfig.mock.calls[0]![0] as AiConfigInput;
    expect(body).toMatchObject({ enabled: true, provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-proj', monthlyTokenLimit: 50000 });
  });

  it('hydrates an existing config, shows the base URL for openai, and omits the key on save when blank', async () => {
    getAiConfig.mockResolvedValue({ aiConfig: { id: 'ai-config', enabled: true, provider: 'openai', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', hasKey: true } });
    render(<AiConfig projectId="p" />);
    expect(await screen.findByLabelText('AI model')).toHaveValue('gpt-4o-mini');
    expect(screen.getByLabelText('AI base URL')).toHaveValue('https://api.openai.com/v1'); // openai → visible
    const key = screen.getByLabelText('AI API key') as HTMLInputElement;
    expect(key.value).toBe('');
    expect(key.placeholder).toContain('leave blank to keep');
    fireEvent.click(screen.getByRole('button', { name: 'Save AI config' }));
    await waitFor(() => expect(putAiConfig).toHaveBeenCalled());
    const body = putAiConfig.mock.calls[0]![0] as AiConfigInput;
    expect('apiKey' in body).toBe(false); // blank → omitted (retain)
    expect(body).toMatchObject({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' });
  });

  it('saves a disabled config (PUT enabled:false) when unchecked', async () => {
    getAiConfig.mockResolvedValue({ aiConfig: { id: 'ai-config', enabled: true, provider: 'anthropic', hasKey: true } });
    render(<AiConfig projectId="p" />);
    fireEvent.click(await screen.findByLabelText("Use this project's own AI provider")); // uncheck (was enabled)
    fireEvent.click(screen.getByRole('button', { name: 'Save AI config' }));
    await waitFor(() => expect(putAiConfig).toHaveBeenCalled());
    const body = putAiConfig.mock.calls[0]![0] as AiConfigInput;
    expect(body.enabled).toBe(false);
  });

  it('surfaces a load failure (403 for a non-writer)', async () => {
    getAiConfig.mockRejectedValue(new Error('insufficient role for this operation'));
    render(<AiConfig projectId="p" />);
    expect(await screen.findByText(/insufficient role/)).toBeInTheDocument();
  });
});
