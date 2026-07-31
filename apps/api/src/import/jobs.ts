// In-memory registry for ASYNC website imports.
//
// A real crawl takes minutes; an agent's tool call times out in seconds. The agent import route used to
// run to completion inside the request, so a caller saw "The operation timed out" while the import went
// on to SUCCEED server-side — with no job id, no progress, and no way to tell whether a retry would
// duplicate the work or (as it once did) crash the process. The registry gives the caller something to
// poll instead.
//
// Deliberately IN-MEMORY, like the preview-build bookkeeping next to it: a job is progress metadata about
// a crawl in flight, not a durable record. A restart loses it, which is honest — the crawl died with the
// process too, and what actually landed is visible in the project's pages either way. The per-project
// import slot (not this registry) is what prevents two concurrent imports.

/** Terminal states keep their result this long, so a caller polling late still learns the outcome. */
const RETAIN_MS = 30 * 60 * 1000;
/** Hard cap on retained jobs per process — a bound, since finished jobs are only swept lazily. */
const MAX_JOBS = 200;
/** Progress lines kept per job (the tail — the newest are what a poller wants). */
const MAX_PROGRESS = 20;

export type ImportJobStatus = 'running' | 'done' | 'failed';

export interface ImportJob {
  id: string;
  projectId: string;
  url: string;
  status: ImportJobStatus;
  startedAt: number;
  finishedAt?: number;
  /** The last few progress events, newest last. */
  progress: string[];
  /** The import report, once `status` is `done`. */
  report?: Record<string, unknown>;
  /** Why it failed, once `status` is `failed`. */
  error?: string;
}

/** What a poller receives — the job without its abort handle. */
export type ImportJobView = Omit<ImportJob, 'projectId'>;

interface Entry extends ImportJob {
  abort: AbortController;
}

/** Render a progress event as one short line (the shapes the import emits are `{phase, detail}`). */
function progressLine(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const { phase, detail } = e as { phase?: unknown; detail?: unknown };
  if (typeof phase !== 'string') return undefined;
  return typeof detail === 'string' && detail !== '' ? `${phase}: ${detail}`.slice(0, 200) : phase;
}

export class ImportJobRegistry {
  private readonly jobs = new Map<string, Entry>();
  private seq = 0;

  /** Ids are process-local and short — they are looked up only alongside the owning project id. */
  private nextId(now: number): string {
    this.seq += 1;
    return `imp_${now.toString(36)}${this.seq.toString(36)}`;
  }

  /** Drop finished jobs past their retention, then enforce the count cap oldest-first. */
  private sweep(now: number): void {
    for (const [id, j] of this.jobs) {
      if (j.status !== 'running' && j.finishedAt !== undefined && now - j.finishedAt > RETAIN_MS) this.jobs.delete(id);
    }
    while (this.jobs.size > MAX_JOBS) {
      // Insertion order = oldest first; never evict a job still running.
      const victim = [...this.jobs.entries()].find(([, j]) => j.status !== 'running')?.[0] ?? this.jobs.keys().next().value;
      if (victim === undefined) break;
      this.jobs.delete(victim);
    }
  }

  start(projectId: string, url: string, abort: AbortController, now = Date.now()): ImportJob {
    this.sweep(now);
    const entry: Entry = { id: this.nextId(now), projectId, url, status: 'running', startedAt: now, progress: [], abort };
    this.jobs.set(entry.id, entry);
    return entry;
  }

  progress(id: string, e: unknown): void {
    const job = this.jobs.get(id);
    const line = progressLine(e);
    if (!job || job.status !== 'running' || line === undefined) return;
    job.progress.push(line);
    if (job.progress.length > MAX_PROGRESS) job.progress.shift();
  }

  finish(id: string, report: Record<string, unknown>, now = Date.now()): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'done';
    job.report = report;
    job.finishedAt = now;
  }

  fail(id: string, error: string, now = Date.now()): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'failed';
    job.error = error;
    job.finishedAt = now;
  }

  /**
   * A job, scoped to its project — the id alone must never be enough to read another tenant's import
   * (ids are short and sequential, so they are guessable by construction).
   */
  get(projectId: string, id: string): ImportJobView | undefined {
    const job = this.jobs.get(id);
    if (!job || job.projectId !== projectId) return undefined;
    // Built explicitly rather than by rest-destructuring the entry: the abort handle and the owning
    // project must never reach a response, and a future field on `Entry` should have to opt IN here.
    return {
      id: job.id,
      url: job.url,
      status: job.status,
      startedAt: job.startedAt,
      ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
      progress: [...job.progress],
      ...(job.report === undefined ? {} : { report: job.report }),
      ...(job.error === undefined ? {} : { error: job.error }),
    };
  }

  /** Cancel a running job (its crawl/import observes the abort signal). */
  cancel(projectId: string, id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.projectId !== projectId || job.status !== 'running') return false;
    job.abort.abort();
    return true;
  }
}
