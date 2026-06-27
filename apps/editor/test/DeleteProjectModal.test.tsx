import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { deleteProject } = vi.hoisted(() => ({ deleteProject: vi.fn() }));
vi.mock('../src/api', () => ({ api: { deleteProject: (id: string) => deleteProject(id) } }));

import { DeleteProjectModal } from '../src/views/DeleteProjectModal';

const project = { id: 'p1', name: 'Acme', slug: 'acme', role: 'owner' as const };

beforeEach(() => vi.clearAllMocks());

describe('DeleteProjectModal (type-to-confirm)', () => {
  it('arms the delete only when the typed name matches exactly, then soft-deletes + calls onDeleted', async () => {
    deleteProject.mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    render(<DeleteProjectModal project={project} onClose={() => {}} onDeleted={onDeleted} />);

    const btn = screen.getByRole('button', { name: 'Delete project' });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/type the project name/i), { target: { value: 'Acme' } });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith('p1'));
    expect(onDeleted).toHaveBeenCalled();
  });

  it('stays disabled for a non-matching name (case-sensitive)', () => {
    render(<DeleteProjectModal project={project} onClose={() => {}} onDeleted={() => {}} />);
    fireEvent.change(screen.getByLabelText(/type the project name/i), { target: { value: 'acme' } });
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeDisabled();
  });

  it('surfaces a delete error and does not call onDeleted', async () => {
    deleteProject.mockRejectedValue(new Error('boom'));
    const onDeleted = vi.fn();
    render(<DeleteProjectModal project={project} onClose={() => {}} onDeleted={onDeleted} />);
    fireEvent.change(screen.getByLabelText(/type the project name/i), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
