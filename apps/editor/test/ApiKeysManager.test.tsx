import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Project } from '../src/api';

const { listApiKeys, createApiKey } = vi.hoisted(() => ({ listApiKeys: vi.fn(), createApiKey: vi.fn() }));
vi.mock('../src/api', () => ({
  api: {
    listApiKeys: (id: string) => listApiKeys(id),
    createApiKey: (id: string, body: unknown) => createApiKey(id, body),
  },
}));
vi.mock('../src/views/ui/Dialogs', () => ({ useDialogs: () => ({ confirm: vi.fn(), dialog: null }) }));

import { ApiKeysManager } from '../src/views/ApiKeysManager';

const project = { id: 'p1', name: 'Shop', slug: 'shop', role: 'owner' } as Project;

beforeEach(() => {
  listApiKeys.mockReset().mockResolvedValue({ items: [] });
  createApiKey.mockReset().mockResolvedValue({ token: 'swk_secret' });
});

describe('ApiKeysManager — payments:provider:write', () => {
  it('is not offered to anyone but an instance admin', async () => {
    render(<ApiKeysManager project={project} />);
    await waitFor(() => expect(listApiKeys).toHaveBeenCalled());
    expect(screen.queryByRole('checkbox', { name: /payments:provider:write/ })).toBeNull();
  });

  it('an instance admin can grant it — off until they do', async () => {
    render(<ApiKeysManager project={project} isInstanceAdmin />);
    const box = (await screen.findByRole('checkbox', { name: /payments:provider:write/ })) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    fireEvent.change(screen.getByLabelText('API key name'), { target: { value: 'provider agent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
    await waitFor(() => expect(createApiKey).toHaveBeenCalledTimes(1));
    expect((createApiKey.mock.calls[0]?.[1] as { capabilities: string[] }).capabilities).toEqual(['content:read', 'content:write', 'payments:provider:write']);
  });
});
