import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { Project } from '../src/api';

const { duplicateProject } = vi.hoisted(() => ({ duplicateProject: vi.fn() }));
vi.mock('../src/api', () => ({ api: { duplicateProject } }));

import { DuplicateProjectModal } from '../src/views/DuplicateProjectModal';

const project: Project = { id: 'p1', name: 'Acme', slug: 'acme', role: 'owner' };

beforeEach(() => {
  cleanup(); // ensure a prior test's portalled modal is gone before this render
  duplicateProject.mockReset();
});
afterEach(() => cleanup());

describe('DuplicateProjectModal', () => {
  it('duplicates and hands the copy back to onDuplicated', async () => {
    const copy: Project = { id: 'p2', name: 'Acme (copy)', slug: 'acme-2', role: 'owner' };
    duplicateProject.mockResolvedValue({ project: copy });
    const onDuplicated = vi.fn();
    render(<DuplicateProjectModal project={project} onClose={vi.fn()} onDuplicated={onDuplicated} />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(onDuplicated).toHaveBeenCalledWith(copy));
    expect(duplicateProject).toHaveBeenCalledWith('p1');
  });

  it('surfaces an error and stays open on failure', async () => {
    duplicateProject.mockRejectedValue(new Error('slug clash'));
    const onDuplicated = vi.fn();
    render(<DuplicateProjectModal project={project} onClose={vi.fn()} onDuplicated={onDuplicated} />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('slug clash');
    expect(onDuplicated).not.toHaveBeenCalled();
  });
});
