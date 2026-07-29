import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { DatabaseIntegrityReport, IntegrityIssue } from '../src/api';

const { checkDatabaseIntegrity, repairIntegrity, listDatasets } = vi.hoisted(() => ({
  checkDatabaseIntegrity: vi.fn(),
  repairIntegrity: vi.fn(),
  listDatasets: vi.fn(),
}));
vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return {
    ...actual,
    api: {
      checkDatabaseIntegrity: (h: unknown, s: unknown) => checkDatabaseIntegrity(h, s),
      repairIntegrity: (i: unknown) => repairIntegrity(i),
      listDatasets: (p: string) => listDatasets(p),
    },
  };
});

import { DatabaseIntegrityModal } from '../src/views/settings/DatabaseIntegrityModal';

const orphanIssue: IntegrityIssue = {
  code: 'orphan_entry',
  severity: 'error',
  projectId: 'p1',
  projectSlug: 'acme',
  subject: 'items',
  count: 336,
  sample: ['e1', 'e2'],
  detail: 'entries belong to dataset "items", which does not exist.',
  actions: [
    { id: 'recreate_dataset', label: 'Recreate the dataset', destructive: false, detail: 'Creates a dataset with the missing slug.' },
    { id: 'delete_orphan_entries', label: 'Delete the entries', destructive: true, detail: 'Permanently removes the rows.' },
  ],
};

const report = (over: Partial<DatabaseIntegrityReport> = {}): DatabaseIntegrityReport => ({
  ok: false,
  durationMs: 1234,
  projectsScanned: 3,
  checks: [
    { id: 'sqlite', label: 'SQLite structural integrity', status: 'ok', scanned: 1, issueCount: 0 },
    { id: 'orphan_entries', label: 'Dataset entries reach their dataset', status: 'issues', scanned: 500, issueCount: 1 },
  ],
  issues: [orphanIssue],
  ...over,
});

/** Drives the streaming client: emits progress frames, then the report. */
function stream(r: DatabaseIntegrityReport) {
  return async (handlers: { onProgress?: (p: unknown) => void; onDone?: (r: unknown) => void }) => {
    handlers.onProgress?.({ step: 1, total: 12, label: 'SQLite structural integrity' });
    handlers.onProgress?.({ step: 12, total: 12, label: 'Deleted projects holding slugs' });
    handlers.onDone?.(r);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listDatasets.mockResolvedValue({ items: [{ slug: 'live_one' }, { slug: 'live_two' }] });
  repairIntegrity.mockResolvedValue({ action: 'recreate_dataset', changed: 336, message: 'Recreated dataset "items".' });
});

describe('DatabaseIntegrityModal', () => {
  it('scans on open and renders the findings with their actions', async () => {
    checkDatabaseIntegrity.mockImplementation(stream(report()));
    render(<DatabaseIntegrityModal onClose={() => {}} />);

    expect(await screen.findByText('1 issue found')).toBeInTheDocument();
    expect(screen.getByText(/2 checks over 3 projects/)).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
    expect(screen.getByText('336 affected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recreate the dataset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete the entries' })).toBeInTheDocument();
  });

  it('shows a clean database as an affirmative result, not an empty list', async () => {
    checkDatabaseIntegrity.mockImplementation(stream(report({ ok: true, issues: [] })));
    render(<DatabaseIntegrityModal onClose={() => {}} />);

    expect(await screen.findByText('No integrity problems found')).toBeInTheDocument();
    // The checks that ran are still listed — "clean" must be evidence, not an absence of output.
    fireEvent.click(screen.getByText(/Checks performed/));
    expect(screen.getByText('SQLite structural integrity')).toBeInTheDocument();
    expect(screen.getByText(/500 scanned/)).toBeInTheDocument();
  });

  it('runs a non-destructive repair without a confirmation, then re-scans', async () => {
    checkDatabaseIntegrity.mockImplementation(stream(report()));
    render(<DatabaseIntegrityModal onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Recreate the dataset' }));

    await waitFor(() =>
      expect(repairIntegrity).toHaveBeenCalledWith({ action: 'recreate_dataset', projectId: 'p1', subject: 'items', targetDataset: undefined }),
    );
    expect(await screen.findByText('Recreated dataset "items".')).toBeInTheDocument();
    // Re-scanned rather than patching local state — one repair can resolve other issues too.
    await waitFor(() => expect(checkDatabaseIntegrity).toHaveBeenCalledTimes(2));
  });

  it('CONFIRMS before a destructive repair, and does nothing if declined', async () => {
    checkDatabaseIntegrity.mockImplementation(stream(report()));
    render(<DatabaseIntegrityModal onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete the entries' }));

    const dialog = await screen.findByRole('dialog', { name: /Delete the entries/ });
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/i }));
    await waitFor(() => expect(repairIntegrity).not.toHaveBeenCalled());
  });

  it('surfaces a stream error instead of pretending the database is clean', async () => {
    checkDatabaseIntegrity.mockImplementation(async (h: { onError?: (m: string) => void }) => {
      h.onError?.('the integrity check could not complete');
    });
    render(<DatabaseIntegrityModal onClose={() => {}} />);

    expect(await screen.findByText('the integrity check could not complete')).toBeInTheDocument();
    expect(screen.queryByText('No integrity problems found')).toBeNull();
  });

  it('offers real datasets as re-assignment targets and blocks the action until one is chosen', async () => {
    const reassign: IntegrityIssue = {
      ...orphanIssue,
      actions: [{ id: 'reassign_entries', label: 'Move to an existing dataset', destructive: false, detail: 'Re-points the entries.' }],
    };
    checkDatabaseIntegrity.mockImplementation(stream(report({ issues: [reassign] })));
    render(<DatabaseIntegrityModal onClose={() => {}} />);

    const button = await screen.findByRole('button', { name: 'Move to an existing dataset' });
    expect(button).toBeDisabled(); // no target picked yet
    await waitFor(() => expect(listDatasets).toHaveBeenCalledWith('p1'));

    fireEvent.change(await screen.findByLabelText('Target dataset for items'), { target: { value: 'live_two' } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(repairIntegrity).toHaveBeenCalledWith({ action: 'reassign_entries', projectId: 'p1', subject: 'items', targetDataset: 'live_two' }),
    );
  });
});
