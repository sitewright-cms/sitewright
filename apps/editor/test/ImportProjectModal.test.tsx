import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ProjectImportReport } from '../src/api';

const { importProjectZipStream } = vi.hoisted(() => ({ importProjectZipStream: vi.fn() }));
vi.mock('../src/api', () => ({ api: { importProjectZipStream } }));

import { ImportProjectModal } from '../src/views/ImportProjectModal';

beforeEach(() => {
  cleanup(); // ensure a prior test's portalled modal is gone before this render
  importProjectZipStream.mockReset();
});
afterEach(() => cleanup());

function chooseFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array([1, 2, 3])], 'proj.zip', { type: 'application/zip' });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('ImportProjectModal', () => {
  it('disables Import until a file is chosen', () => {
    render(<ImportProjectModal onClose={vi.fn()} onImported={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    chooseFile();
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
  });

  it('streams the import and opens the new project from the report', async () => {
    const report: ProjectImportReport = { projectId: 'np', slug: 'site-2', name: 'Site', imported: 5, media: 3 };
    importProjectZipStream.mockImplementation((_file, handlers) => {
      handlers.onProgress?.({ phase: 'content' });
      handlers.onDone?.(report);
      return Promise.resolve();
    });
    const onImported = vi.fn();
    render(<ImportProjectModal onClose={vi.fn()} onImported={onImported} />);
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    // Report step renders; "Open project" hands back a Project built from the report.
    const open = await screen.findByRole('button', { name: 'Open project' });
    fireEvent.click(open);
    await waitFor(() =>
      expect(onImported).toHaveBeenCalledWith({ id: 'np', name: 'Site', slug: 'site-2', role: 'owner' }),
    );
  });

  it('shows the error and returns to the source step on failure', async () => {
    importProjectZipStream.mockImplementation((_file, handlers) => {
      handlers.onError?.('invalid project bundle');
      return Promise.resolve();
    });
    render(<ImportProjectModal onClose={vi.fn()} onImported={vi.fn()} />);
    chooseFile();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('invalid project bundle')).toBeInTheDocument();
    // Back on the source step, ready to retry.
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument();
  });
});
