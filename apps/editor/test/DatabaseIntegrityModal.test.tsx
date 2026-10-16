import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ApiError, type DatabaseIntegrityReport, type IntegrityAction, type IntegrityActionInput, type IntegrityIssue } from '../src/api';

const { checkDatabaseIntegrity, repairIntegrity, repairIntegrityBatch, listDatasets } = vi.hoisted(() => ({
  checkDatabaseIntegrity: vi.fn(),
  repairIntegrity: vi.fn(),
  repairIntegrityBatch: vi.fn(),
  listDatasets: vi.fn(),
}));
vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return {
    ...actual,
    api: {
      checkDatabaseIntegrity: (h: unknown, s: unknown) => checkDatabaseIntegrity(h, s),
      repairIntegrity: (i: unknown) => repairIntegrity(i),
      repairIntegrityBatch: (r: unknown) => repairIntegrityBatch(r),
      listDatasets: (p: string) => listDatasets(p),
    },
  };
});

import { DatabaseIntegrityModal, fixPlan, repairSummary, runRepairBatches } from '../src/views/settings/DatabaseIntegrityModal';

/** The server's action catalogue, with the flags that decide what Fix all may run (integrity.ts ACTIONS). */
const A = {
  recreate: { id: 'recreate_dataset', label: 'Recreate the dataset', destructive: false, unattended: true, reversible: true, detail: 'Creates a dataset with the missing slug.' },
  deleteEntries: { id: 'delete_orphan_entries', label: 'Delete the entries', destructive: true, unattended: false, reversible: true, detail: 'Permanently removes the rows.' },
  reassign: { id: 'reassign_entries', label: 'Move to an existing dataset', destructive: false, unattended: false, reversible: true, detail: 'Re-points the entries.' },
  scope: { id: 'fix_entry_scope', label: 'Repair storage scope', destructive: false, unattended: true, reversible: true, detail: 'Re-derives the scope.' },
  history: { id: 'delete_orphan_history', label: 'Delete the stranded history', destructive: true, unattended: true, reversible: false, detail: 'Removes snapshots.' },
  reparent: { id: 'reparent_pages', label: 'Move under the home page', destructive: false, unattended: true, reversible: true, detail: 'Hangs pages under home.' },
  translations: { id: 'delete_orphan_translations', label: 'Delete the translations', destructive: true, unattended: true, reversible: true, detail: 'Removes titles.' },
  release: { id: 'release_domains', label: 'Release the hostnames', destructive: true, unattended: false, reversible: false, detail: 'Frees hostnames.' },
} satisfies Record<string, IntegrityAction>;

const orphanIssue: IntegrityIssue = {
  code: 'orphan_entry',
  severity: 'error',
  projectId: 'p1',
  projectSlug: 'acme',
  subject: 'items',
  count: 336,
  sample: ['e1', 'e2'],
  detail: 'entries belong to dataset "items", which does not exist.',
  actions: [A.recreate, A.deleteEntries],
};

/** An issue of another kind, built from the orphan fixture so only what matters to a test is spelled out. */
const issueOf = (over: Partial<IntegrityIssue>): IntegrityIssue => ({ ...orphanIssue, ...over });

/** The batch endpoint's answer when every repair it was sent succeeded. */
const allApplied = async (repairs: IntegrityActionInput[]) => ({
  results: repairs.map((r) => ({ action: r.action, projectId: r.projectId, subject: r.subject, ok: true as const, changed: 1, message: 'ok' })),
});

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
  repairIntegrityBatch.mockImplementation(allApplied);
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

  it('FIX ALL runs the safe repair for every issue in ONE request, and never the destructive alternative', async () => {
    // ★ An issue's actions are ALTERNATIVES. Orphaned entries offer "Recreate the dataset" AND
    // "Delete the entries"; running both would recreate the rows and then delete them. Fix all picks
    // exactly one per issue, and always the one that cannot lose content.
    const scopeIssue = issueOf({ code: 'entry_scope_mismatch', severity: 'warning', projectId: 'p2', projectSlug: 'beta', subject: 'posts', count: 4, actions: [A.scope] });
    checkDatabaseIntegrity.mockImplementation(stream(report({ issues: [orphanIssue, scopeIssue] })));
    render(<DatabaseIntegrityModal onClose={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /Fix all issues \(2\)/ }));
    const dialog = await screen.findByRole('dialog', { name: /Fix 2 issues\?/ });
    expect(within(dialog).getByText(/Repairs — nothing is removed/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Removals/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fix them' }));

    // One request for the lot — not one per issue against the single-repair route's rate limit.
    await waitFor(() => expect(repairIntegrityBatch).toHaveBeenCalledTimes(1));
    expect(repairIntegrity).not.toHaveBeenCalled();
    expect(repairIntegrityBatch).toHaveBeenCalledWith([
      { action: 'recreate_dataset', projectId: 'p1', subject: 'items' },
      { action: 'fix_entry_scope', projectId: 'p2', subject: 'posts' },
    ]);
    expect(await screen.findByText('Repaired 2 issues.')).toBeInTheDocument();
    await waitFor(() => expect(checkDatabaseIntegrity).toHaveBeenCalledTimes(2)); // re-scanned once
  });

  it('FIX ALL includes the removals the server marks safe, says which can be undone, and runs them LAST', async () => {
    const translations = issueOf({ code: 'orphan_translation', severity: 'warning', subject: 'gone-page', count: 3, actions: [A.translations] });
    const history = issueOf({ code: 'orphan_entry_history', severity: 'warning', projectId: 'p2', projectSlug: 'beta', subject: 'old', count: 2, actions: [A.history] });
    const pages = issueOf({ code: 'missing_page_parent', severity: 'warning', subject: 'ghost', count: 5, actions: [A.reparent] });
    checkDatabaseIntegrity.mockImplementation(stream(report({ issues: [translations, history, pages] })));
    render(<DatabaseIntegrityModal onClose={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /Fix all issues \(3\)/ }));
    const dialog = await screen.findByRole('dialog', { name: /Fix 3 issues\?/ });
    expect(within(dialog).getByText(/Move under the home page — acme \(5 rows\)/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Delete the translations — acme \(3 rows\) · restorable from History/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Delete the stranded history — beta \(2 rows\) · cannot be undone/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fix them' }));

    await waitFor(() => expect(repairIntegrityBatch).toHaveBeenCalledTimes(1));
    // Re-pointing first, removing after.
    expect(repairIntegrityBatch.mock.calls[0]![0]).toEqual([
      { action: 'reparent_pages', projectId: 'p1', subject: 'ghost' },
      { action: 'delete_orphan_translations', projectId: 'p1', subject: 'gone-page' },
      { action: 'delete_orphan_history', projectId: 'p2', subject: 'old' },
    ]);
  });

  it('LEAVES issues that need a decision or cannot be fixed here, and says how many of each', async () => {
    // Only a deletion with a gentler alternative, or a dataset the operator must choose: no safe
    // default, so bulk-fixing must not guess — and must not quietly do less than it says either.
    const deleteOnly = issueOf({ subject: 'delete-only', actions: [A.deleteEntries] });
    const chooseOne = issueOf({ subject: 'needs-target', actions: [A.reassign] });
    // A deleted project keeps its hostnames so a restore brings them back — releasing them is a choice.
    const domains = issueOf({ code: 'domain_on_deleted_project', severity: 'warning', projectId: 'gone', projectSlug: 'gone', subject: 'custom domains', actions: [A.release] });
    const noRepair = issueOf({ code: 'unparseable_content', subject: 'page', actions: [] });
    const byDesign = issueOf({ code: 'deleted_project_holding_slug', severity: 'info', projectId: null, projectSlug: null, subject: 'deleted projects', actions: [] });
    checkDatabaseIntegrity.mockImplementation(stream(report({ issues: [orphanIssue, deleteOnly, chooseOne, domains, noRepair, byDesign] })));
    render(<DatabaseIntegrityModal onClose={() => {}} />);

    // Five problems and a note; only ONE problem is safely automatic.
    expect(await screen.findByText('5 issues found')).toBeInTheDocument();
    expect(screen.getByText(/· 1 note/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Fix all issues \(1\)/ }));
    const dialog = await screen.findByRole('dialog', { name: /Fix 1 issue\?/ });
    expect(within(dialog).getByText(/3 issues need a decision and will be LEFT ALONE/)).toBeInTheDocument();
    expect(within(dialog).getByText(/1 issue cannot be fixed from here/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fix them' }));

    await waitFor(() => expect(repairIntegrityBatch).toHaveBeenCalledTimes(1));
    expect(repairIntegrityBatch.mock.calls[0]![0]).toHaveLength(1);
    expect(await screen.findByText(/3 left for you to decide on\. 1 cannot be fixed from here\./)).toBeInTheDocument();
  });

  it('does not delete history that recreating its dataset in the same run brings back', () => {
    const history = issueOf({ code: 'orphan_entry_history', severity: 'warning', actions: [A.history] }); // same project + slug
    const elsewhere = issueOf({ code: 'orphan_entry_history', severity: 'warning', subject: 'other', actions: [A.history] });
    const { auto } = fixPlan([orphanIssue, history, elsewhere]);
    expect(auto.map((f) => [f.action.id, f.issue.subject])).toEqual([
      ['recreate_dataset', 'items'],
      ['delete_orphan_history', 'other'],
    ]);
  });

  it('keeps going when one repair fails, and reports which and why', async () => {
    const second = issueOf({ projectId: 'p2', projectSlug: 'beta', subject: 'posts' });
    checkDatabaseIntegrity.mockImplementation(stream(report({ issues: [orphanIssue, second] })));
    repairIntegrityBatch.mockResolvedValueOnce({
      results: [
        { action: 'recreate_dataset', projectId: 'p1', subject: 'items', ok: false, error: 'dataset slug is taken' },
        { action: 'recreate_dataset', projectId: 'p2', subject: 'posts', ok: true, changed: 1, message: 'ok' },
      ],
    });
    render(<DatabaseIntegrityModal onClose={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /Fix all issues \(2\)/ }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: /Fix 2 issues\?/ })).getByRole('button', { name: 'Fix them' }));

    expect(await screen.findByText(/Repaired 1 issue\. 1 could not be applied — items: dataset slug is taken/)).toBeInTheDocument();
  });

  it('sends a long report in batches, and reports the rest with the reason when a request is refused', async () => {
    // The WIRING only: batch sizes, stop-at-refusal and the summary wording are proven on the pure
    // functions below at the real 200-per-request size. Rendering hundreds of findings in jsdom to
    // prove them here timed out on a 2-core CI runner, so the batch size is injected instead.
    const many = Array.from({ length: 5 }, (_, i) => issueOf({ subject: `ds${i}` }));
    checkDatabaseIntegrity.mockImplementation(stream(report({ issues: many })));
    repairIntegrityBatch.mockImplementationOnce(allApplied).mockRejectedValueOnce(new ApiError(429, 'too many requests'));
    render(<DatabaseIntegrityModal onClose={() => {}} batchSize={2} />);

    fireEvent.click(await screen.findByRole('button', { name: /Fix all issues \(5\)/ }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: /Fix 5 issues\?/ })).getByRole('button', { name: 'Fix them' }));

    // 2 + 2 (+ 1): the second request is refused, so it and the third never ran — and say so.
    await waitFor(() => expect(repairIntegrityBatch).toHaveBeenCalledTimes(2));
    expect(repairIntegrityBatch.mock.calls.map((c) => (c[0] as IntegrityActionInput[]).map((r) => r.subject))).toEqual([
      ['ds0', 'ds1'],
      ['ds2', 'ds3'],
    ]);
    expect(
      await screen.findByText('Repaired 2 issues. 3 could not be applied — ds2: too many requests; ds3: too many requests; ds4: too many requests'),
    ).toBeInTheDocument();
    await waitFor(() => expect(checkDatabaseIntegrity).toHaveBeenCalledTimes(2)); // re-scanned once, after
  });

  it('shows Fix all DISABLED, with the reason, when nothing can be fixed unattended', async () => {
    checkDatabaseIntegrity.mockImplementation(stream(report({ issues: [issueOf({ actions: [A.deleteEntries] })] })));
    render(<DatabaseIntegrityModal onClose={() => {}} />);
    expect(await screen.findByText('1 issue found')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Fix all issues' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/None of these can be fixed automatically/);
  });

  it('treats a report with only INFO findings as clean, with no Fix all', async () => {
    const byDesign = issueOf({ code: 'deleted_project_holding_slug', severity: 'info', projectId: null, projectSlug: null, subject: 'deleted projects', actions: [] });
    checkDatabaseIntegrity.mockImplementation(stream(report({ ok: true, issues: [byDesign] })));
    render(<DatabaseIntegrityModal onClose={() => {}} />);
    expect(await screen.findByText('No integrity problems found')).toBeInTheDocument();
    expect(screen.getByText(/· 1 note/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fix all issues/ })).toBeNull();
  });

  it('releases a deleted project’s hostnames only from that issue’s own button, after confirming', async () => {
    const domains = issueOf({ code: 'domain_on_deleted_project', severity: 'warning', projectId: 'gone', projectSlug: 'gone', subject: 'custom domains', count: 2, actions: [A.release] });
    checkDatabaseIntegrity.mockImplementation(stream(report({ issues: [domains] })));
    repairIntegrity.mockResolvedValueOnce({ action: 'release_domains', changed: 2, message: 'Released 2 hostnames: a.example, b.example.' });
    render(<DatabaseIntegrityModal onClose={() => {}} />);

    // Not something Fix all may do on its own.
    expect(await screen.findByRole('button', { name: 'Fix all issues' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Release the hostnames' }));
    const dialog = await screen.findByRole('dialog', { name: /Release the hostnames/ });
    expect(within(dialog).getByText(/2 row\(s\) in “gone”/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release the hostnames' }));
    await waitFor(() =>
      expect(repairIntegrity).toHaveBeenCalledWith({ action: 'release_domains', projectId: 'gone', subject: 'custom domains', targetDataset: undefined }),
    );
    expect(await screen.findByText('Released 2 hostnames: a.example, b.example.')).toBeInTheDocument();
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
    const reassign = issueOf({ actions: [A.reassign] });
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

/** A Fix all plan of `count` safe repairs, subjects ds0…ds{count-1}, in the order Fix all sends them. */
const planOf = (count: number) => fixPlan(Array.from({ length: count }, (_, i) => issueOf({ subject: `ds${i}` }))).auto;
const subjects = (repairs: IntegrityActionInput[]) => repairs.map((r) => r.subject);

describe('runRepairBatches — Fix all, one request per 200 repairs', () => {
  it('sends 200 + 200 + 50, in plan order, and returns one result per repair', async () => {
    const send = vi.fn(allApplied);
    const results = await runRepairBatches(planOf(450), send);

    expect(send.mock.calls.map(([repairs]) => repairs.length)).toEqual([200, 200, 50]);
    expect(subjects(send.mock.calls[1]![0]).slice(0, 2)).toEqual(['ds200', 'ds201']);
    expect(send.mock.calls[0]![0][0]).toEqual({ action: 'recreate_dataset', projectId: 'p1', subject: 'ds0' });
    expect(results).toHaveLength(450);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('STOPS at a refused request: that chunk and every later one are never sent, and carry the reason', async () => {
    const send = vi.fn(allApplied).mockImplementationOnce(allApplied).mockRejectedValueOnce(new ApiError(429, 'too many requests'));
    const results = await runRepairBatches(planOf(450), send);

    expect(send).toHaveBeenCalledTimes(2); // the third (ds400…ds449) was never sent
    expect(results).toHaveLength(450);
    expect(results.slice(0, 200).every((r) => r.ok)).toBe(true);
    const failed = results.slice(200);
    expect(failed.every((r) => !r.ok && r.error === 'too many requests')).toBe(true);
    expect([failed[0]!.subject, failed[249]!.subject]).toEqual(['ds200', 'ds449']);
  });

  it('says a request with NO answer may have run, rather than claiming it did not', async () => {
    const results = await runRepairBatches(planOf(3), vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(results.map((r) => (r.ok ? 'ok' : r.error))).toEqual(
      Array(3).fill('no answer from the server — the re-check shows what was applied'),
    );
  });

  it('keeps going past ONE failed repair inside a request that succeeded', async () => {
    const send = vi.fn(async (repairs: IntegrityActionInput[]) => ({
      results: repairs.map((r) =>
        r.subject === 'ds1'
          ? { action: r.action, projectId: r.projectId, subject: r.subject, ok: false as const, error: 'dataset slug is taken' }
          : { action: r.action, projectId: r.projectId, subject: r.subject, ok: true as const, changed: 1, message: 'ok' },
      ),
    }));
    const results = await runRepairBatches(planOf(5), send, 2);

    expect(send.mock.calls.map(([repairs]) => subjects(repairs))).toEqual([['ds0', 'ds1'], ['ds2', 'ds3'], ['ds4']]);
    expect(results.filter((r) => !r.ok).map((r) => r.subject)).toEqual(['ds1']);
  });

  it('treats a batch size below one as one, instead of looping forever', async () => {
    const send = vi.fn(allApplied);
    await runRepairBatches(planOf(2), send, 0);
    expect(send.mock.calls.map(([repairs]) => subjects(repairs))).toEqual([['ds0'], ['ds1']]);
  });
});

describe('repairSummary — what Fix all says it did', () => {
  const ok = (subject: string) => ({ action: 'recreate_dataset' as const, projectId: 'p1', subject, ok: true as const, changed: 1, message: 'ok' });
  const no = (subject: string, error = 'too many requests') => ({ action: 'recreate_dataset' as const, projectId: 'p1', subject, ok: false as const, error });

  it('names the first five failures with their reason, and counts the rest', () => {
    const results = [...Array.from({ length: 200 }, (_, i) => ok(`ds${i}`)), ...Array.from({ length: 250 }, (_, i) => no(`ds${200 + i}`))];
    expect(repairSummary(results, { decide: 0, unfixable: 0 })).toEqual({
      tone: 'warn',
      text:
        'Repaired 200 issues. 250 could not be applied — ds200: too many requests; ds201: too many requests; ' +
        'ds202: too many requests; ds203: too many requests; ds204: too many requests … and 245 more',
    });
  });

  it('is a success note when everything applied, and still counts what the plan left alone', () => {
    expect(repairSummary([ok('items')], { decide: 3, unfixable: 1 })).toEqual({
      tone: 'ok',
      text: 'Repaired 1 issue. 3 left for you to decide on. 1 cannot be fixed from here.',
    });
  });

  it('says plainly when nothing was repaired', () => {
    expect(repairSummary([no('items', 'dataset slug is taken')], { decide: 0, unfixable: 0 })).toEqual({
      tone: 'warn',
      text: 'Nothing was repaired. 1 could not be applied — items: dataset slug is taken',
    });
  });
});
