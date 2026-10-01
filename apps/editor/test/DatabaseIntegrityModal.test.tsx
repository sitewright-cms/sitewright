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

  it('FIX ALL runs the safe repair for every issue, and never the destructive alternative', async () => {
    // ★ An issue's actions are ALTERNATIVES. Orphaned entries offer "Recreate the dataset" AND
    // "Delete the entries"; running both would recreate the rows and then delete them. Fix all picks
    // exactly one per issue, and always the one that cannot lose content.
    const scopeIssue: IntegrityIssue = {
      code: 'entry_scope_mismatch',
      severity: 'warning',
      projectId: 'p2',
      projectSlug: 'beta',
      subject: 'posts',
      count: 4,
      sample: ['e9'],
      detail: 'rows are stored under the wrong scope.',
      actions: [{ id: 'fix_entry_scope', label: 'Repair storage scope', destructive: false, detail: 'Re-derives the scope.' }],
    };
    checkDatabaseIntegrity.mockImplementation(stream(report({ issues: [orphanIssue, scopeIssue] })));
    render(<DatabaseIntegrityModal onClose={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /Fix all issues \(2\)/ }));
    const dialog = await screen.findByRole('dialog', { name: /Fix 2 issues\?/ });
    expect(within(dialog).getByText(/None of these delete anything/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fix them' }));

    await waitFor(() => expect(repairIntegrity).toHaveBeenCalledTimes(2));
    expect(repairIntegrity).toHaveBeenCalledWith({ action: 'recreate_dataset', projectId: 'p1', subject: 'items' });
    expect(repairIntegrity).toHaveBeenCalledWith({ action: 'fix_entry_scope', projectId: 'p2', subject: 'posts' });
    // The destructive alternative was never run.
    expect(repairIntegrity).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'delete_orphan_entries' }));
  });

  it('LEAVES issues that need a decision, and says how many', async () => {
    // Only a deletion on offer, or a dataset the operator must choose: there is no safe default, so
    // bulk-fixing must not guess — and must not quietly do less than it says either.
    const deleteOnly: IntegrityIssue = {
      ...orphanIssue,
      subject: 'stranded-history',
      code: 'orphan_history',
      actions: [{ id: 'delete_orphan_history', label: 'Delete the stranded history', destructive: true, detail: 'Removes snapshots.' }],
    };
    const chooseOne: IntegrityIssue = {
      ...orphanIssue,
      subject: 'needs-target',
      actions: [{ id: 'reassign_entries', label: 'Move to an existing dataset', destructive: false, detail: 'Re-points the rows.' }],
    };
    checkDatabaseIntegrity.mockImplementation(stream(report({ issues: [orphanIssue, deleteOnly, chooseOne] })));
    render(<DatabaseIntegrityModal onClose={() => {}} />);

    // Three issues, but only ONE is safely automatic.
    fireEvent.click(await screen.findByRole('button', { name: /Fix all issues \(1\)/ }));
    const dialog = await screen.findByRole('dialog', { name: /Fix 1 issue\?/ });
    expect(within(dialog).getByText(/2 issues need a decision and will be LEFT ALONE/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fix them' }));

    await waitFor(() => expect(repairIntegrity).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/2 left for you to decide on/)).toBeInTheDocument();
  });

  it('keeps going when one repair fails, and reports which', async () => {
    const second: IntegrityIssue = { ...orphanIssue, projectId: 'p2', projectSlug: 'beta', subject: 'posts' };
    checkDatabaseIntegrity.mockImplementation(stream(report({ issues: [orphanIssue, second] })));
    repairIntegrity.mockRejectedValueOnce(new Error('dataset slug is taken'));
    repairIntegrity.mockResolvedValueOnce({ action: 'recreate_dataset', changed: 1, message: 'ok' });
    render(<DatabaseIntegrityModal onClose={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /Fix all issues \(2\)/ }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: /Fix 2 issues\?/ })).getByRole('button', { name: 'Fix them' }));

    // One failure must not abort the rest — a later repair is often the one that would have worked.
    await waitFor(() => expect(repairIntegrity).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/1 could not be applied/)).toBeInTheDocument();
  });

  it('offers no Fix all button when nothing can be fixed unattended', async () => {
    const deleteOnly: IntegrityIssue = {
      ...orphanIssue,
      actions: [{ id: 'delete_orphan_entries', label: 'Delete the entries', destructive: true, detail: 'Removes rows.' }],
    };
    checkDatabaseIntegrity.mockImplementation(stream(report({ issues: [deleteOnly] })));
    render(<DatabaseIntegrityModal onClose={() => {}} />);
    expect(await screen.findByText('1 issue found')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fix all issues/ })).toBeNull();
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
