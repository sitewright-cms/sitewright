import { describe, it, expect } from 'vitest';
import { ImportJobRegistry } from '../src/import/jobs.js';

const reg = (): ImportJobRegistry => new ImportJobRegistry();
const ac = (): AbortController => new AbortController();

describe('ImportJobRegistry', () => {
  it('tracks a job from running to done, keeping the report', () => {
    const r = reg();
    const job = r.start('p1', 'https://x.test/', ac());
    expect(r.get('p1', job.id)).toMatchObject({ status: 'running', url: 'https://x.test/' });
    r.finish(job.id, { pagesImported: 22 });
    expect(r.get('p1', job.id)).toMatchObject({ status: 'done', report: { pagesImported: 22 } });
  });

  it('records a failure reason instead of losing it', () => {
    const r = reg();
    const job = r.start('p1', 'https://x.test/', ac());
    r.fail(job.id, 'no pages could be crawled');
    expect(r.get('p1', job.id)).toMatchObject({ status: 'failed', error: 'no pages could be crawled' });
  });

  // A job id is short and sequential, so it is guessable — the project scope is what stops one tenant
  // reading another's import.
  it('is scoped to its project: the id alone is not enough', () => {
    const r = reg();
    const job = r.start('p1', 'https://x.test/', ac());
    expect(r.get('p2', job.id)).toBeUndefined();
    expect(r.cancel('p2', job.id)).toBe(false);
    expect(r.get('p1', job.id)).toBeDefined();
  });

  it('never leaks the abort handle or the owning project to a poller', () => {
    const r = reg();
    const job = r.start('p1', 'https://x.test/', ac());
    const view = r.get('p1', job.id) as Record<string, unknown>;
    expect(view.abort).toBeUndefined();
    expect(view.projectId).toBeUndefined();
  });

  it('keeps only the TAIL of the progress stream, and ignores junk events', () => {
    const r = reg();
    const job = r.start('p1', 'https://x.test/', ac());
    for (let i = 0; i < 30; i++) r.progress(job.id, { phase: 'crawl', detail: `page ${i}` });
    const view = r.get('p1', job.id)!;
    expect(view.progress).toHaveLength(20); // MAX_PROGRESS
    expect(view.progress.at(-1)).toBe('crawl: page 29'); // newest last
    // Non-events and events without a phase are dropped rather than stored as noise.
    r.progress(job.id, 'nope');
    r.progress(job.id, { detail: 'orphan' });
    r.progress(job.id, null);
    expect(r.get('p1', job.id)!.progress).toHaveLength(20);
  });

  it('stops recording progress once the job is finished', () => {
    const r = reg();
    const job = r.start('p1', 'https://x.test/', ac());
    r.finish(job.id, {});
    r.progress(job.id, { phase: 'crawl', detail: 'late' });
    expect(r.get('p1', job.id)!.progress).toEqual([]);
  });

  it('cancels a RUNNING job through its abort signal, and only once', () => {
    const r = reg();
    const abort = ac();
    const job = r.start('p1', 'https://x.test/', abort);
    expect(r.cancel('p1', job.id)).toBe(true);
    expect(abort.signal.aborted).toBe(true);
    r.finish(job.id, {});
    expect(r.cancel('p1', job.id)).toBe(false); // already terminal
  });

  it('sweeps EXPIRED terminal jobs but never one still running', () => {
    const r = reg();
    const old = r.start('p1', 'https://old.test/', ac(), 0);
    const live = r.start('p1', 'https://live.test/', ac(), 0);
    r.finish(old.id, {}, 0);
    // A start an hour later sweeps: the finished job is past retention, the running one is untouched.
    r.start('p1', 'https://new.test/', ac(), 60 * 60 * 1000);
    expect(r.get('p1', old.id)).toBeUndefined();
    expect(r.get('p1', live.id)).toMatchObject({ status: 'running' });
  });

  it('gives each job a distinct id even when started in the same millisecond', () => {
    const r = reg();
    const ids = new Set(Array.from({ length: 50 }, () => r.start('p1', 'https://x.test/', ac(), 1234).id));
    expect(ids.size).toBe(50);
  });

  it('is inert for an unknown id rather than throwing', () => {
    const r = reg();
    expect(() => r.finish('nope', {})).not.toThrow();
    expect(() => r.fail('nope', 'x')).not.toThrow();
    expect(() => r.progress('nope', { phase: 'crawl' })).not.toThrow();
    expect(r.get('p1', 'nope')).toBeUndefined();
  });
});
