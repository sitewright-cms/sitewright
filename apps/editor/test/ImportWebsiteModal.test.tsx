import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

interface Handlers {
  onProgress?: (e: unknown) => void;
  onDone?: (r: unknown) => void;
  onError?: (m: string) => void;
}

const { importWebsiteStream, importUploadStream } = vi.hoisted(() => ({
  importWebsiteStream: vi.fn(),
  importUploadStream: vi.fn(),
}));
vi.mock('../src/api', () => ({
  api: {
    importWebsiteStream: (pid: string, body: unknown, handlers: Handlers, signal?: AbortSignal) => importWebsiteStream(pid, body, handlers, signal),
    importUploadStream: (pid: string, file: File, handlers: Handlers, signal?: AbortSignal) => importUploadStream(pid, file, handlers, signal),
  },
}));

import { ImportWebsiteModal } from '../src/views/ImportWebsiteModal';

const REPORT = { pagesImported: 3, pagesFound: 4, mediaSelfHosted: 5, scriptsDropped: 2, chromeExtracted: true, truncated: false, warnings: ['style-removed: x'] };

beforeEach(() => {
  importWebsiteStream.mockReset();
  importUploadStream.mockReset();
});

function setup(onImported = vi.fn(), onClose = vi.fn()) {
  render(<ImportWebsiteModal projectId="p1" projectName="Acme" onClose={onClose} onImported={onImported} />);
  return { onImported, onClose };
}

describe('ImportWebsiteModal', () => {
  it('disables Start until a valid https URL is entered, then crawls', async () => {
    const user = userEvent.setup();
    let handlers: Handlers = {};
    importWebsiteStream.mockImplementation((_pid, _body, h: Handlers) => {
      handlers = h;
      return Promise.resolve();
    });
    setup();

    const start = screen.getByRole('button', { name: 'Clone with AI' });
    expect(start).toBeDisabled();
    await user.type(screen.getByLabelText('Website URL'), 'https://example.com');
    expect(start).toBeEnabled();
    await user.click(start);
    expect(importWebsiteStream).toHaveBeenCalledWith('p1', { url: 'https://example.com', maxPages: 50 }, expect.anything(), expect.anything());

    // Drive the stream to completion → report step.
    act(() => handlers.onDone?.(REPORT));
    expect(screen.getByText(/Foundation ready/)).toBeTruthy();
    expect(screen.getByText('3 of 4 found')).toBeTruthy();
    // The mechanical "Nativize" step is gone — replaced by the AI-authoring handoff.
    expect(screen.getByText('Author with AI')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Nativize/ })).toBeNull();
  });

  it('opens the project from the report step', async () => {
    const user = userEvent.setup();
    let handlers: Handlers = {};
    importWebsiteStream.mockImplementation((_pid, _body, h: Handlers) => {
      handlers = h;
      return Promise.resolve();
    });
    const onImported = vi.fn();
    setup(onImported);
    await user.type(screen.getByLabelText('Website URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Clone with AI' }));
    act(() => handlers.onDone?.(REPORT));
    await user.click(screen.getByRole('button', { name: 'Open project' }));
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('shows an error and returns to the source step', async () => {
    const user = userEvent.setup();
    let handlers: Handlers = {};
    importWebsiteStream.mockImplementation((_pid, _body, h: Handlers) => {
      handlers = h;
      return Promise.resolve();
    });
    setup();
    await user.type(screen.getByLabelText('Website URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Clone with AI' }));
    act(() => handlers.onError?.('only public https URLs can be imported'));
    expect(screen.getByText('only public https URLs can be imported')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clone with AI' })).toBeTruthy();
  });

  it('aborts the stream when closed mid-import', async () => {
    const user = userEvent.setup();
    let signal: AbortSignal | undefined;
    importWebsiteStream.mockImplementation((_pid, _body, _h: Handlers, s?: AbortSignal) => {
      signal = s;
      return new Promise<void>(() => {}); // never resolves — stays "running"
    });
    setup();
    await user.type(screen.getByLabelText('Website URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Clone with AI' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(signal?.aborted).toBe(true);
  });

  it('uploads a chosen file in upload mode', async () => {
    const user = userEvent.setup();
    importUploadStream.mockResolvedValue(undefined);
    setup();
    await user.click(screen.getByRole('button', { name: /Upload a bundle/ }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, new File(['PK'], 'site.zip', { type: 'application/zip' }));
    await user.click(screen.getByRole('button', { name: 'Clone with AI' }));
    expect(importUploadStream).toHaveBeenCalledTimes(1);
    expect(importUploadStream.mock.calls[0]![1].name).toBe('site.zip');
  });
});
