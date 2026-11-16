import { Worker } from 'node:worker_threads';
import { PublishError, type ReleaseManifest } from './build.js';
import type { BuildJob, BuildRunner } from './runner.js';
import type { FromThread, SerializedError, ThreadJob, ToThread } from './build-thread.js';
import { deserializeError, serializeError } from './build-thread.js';

/**
 * Runs whole-site builds on WORKER THREADS, so they stop competing with every request for the API's one
 * main thread.
 *
 * MEASURED on a 1.5 GiB, 6-CPU container under several agents' load: the main thread was pegged at 100%
 * while the container used ~2 of its 6 cores, and every preview, publish and audit build queued on that
 * one thread (a preview after an edit took minutes at the worst). A build is CPU on the main thread —
 * rendering pages, Tailwind, the search index — so it can only go faster on another thread.
 *
 * - **Persistent threads**, up to `size`, each running one build at a time; a thread idle for `idleMs`
 *   is retired, so an idle instance holds no build heap. Warm threads keep their JIT and caches.
 * - **New threads only while memory allows** (`mayStartThread`); a warm thread is always reused. Under
 *   pressure a build that finds no free thread runs on the main thread.
 * - **The instance's limits stay on the main thread.** A thread asks the main thread to admit each image
 *   encode (the one encode gate and memory ledger), and the site-build gate in app.ts still decides how
 *   many builds run at all.
 * - **Never worse than before.** A build runs on the main thread, exactly as it did, whenever a thread
 *   cannot take it: no thread is free (the page-speed audit's build, which bypasses the build gate), the
 *   job carries media functions but no `mediaSource` to rebuild them from, the thread cannot start, or
 *   it runs out of heap or dies mid-build (that build is then re-run on the main thread). One CPU or a
 *   thousand, a build always has somewhere to run.
 */
export interface ThreadRunnerOptions {
  /** Threads at most. At least 1. */
  size: number;
  /** Each thread's V8 old-space ceiling (MB). */
  heapMb: number;
  /**
   * Re-run a build that ran its thread out of heap on the main thread — only sensible when the threads'
   * ceiling is SMALLER than the main thread's (it is split between several threads), so the main thread
   * may still fit it. With the same ceiling the main thread would run out too, and there it takes the
   * whole process down; then the build fails instead.
   */
  retryOutOfHeap?: boolean;
  /** Retire a thread idle this long (default 30 s). */
  idleMs?: number;
  /**
   * Asked before STARTING a new thread: is there memory for one? A thread is a second V8 isolate with its
   * own heap — more memory than the same build sharing the main thread's — so when this says no the build
   * runs on the main thread instead. A warm idle thread is reused without asking: it holds its memory
   * already, and retiring it under pressure only to start a cold one later was what made builds slow
   * (MEASURED: 45 threads started in five minutes of medium load, each paying module load, a cold JIT and
   * empty minify caches — previews ~30% slower than on the main thread).
   */
  mayStartThread?: () => boolean | Promise<boolean>;
  /** Give up on a thread that has not started after this long (default 30 s); the build falls back. */
  readyTimeoutMs?: number;
  /** Where a build goes when no thread can take it (default: in-process). */
  fallback: BuildRunner;
  /** The thread's entry module (default: build-thread.js beside this file). */
  workerUrl?: URL;
  /** Extra Node flags for the thread (a test loads TypeScript sources this way). */
  execArgv?: string[];
  /** Told when a build fell back to the main thread, and why. */
  onFallback?: (reason: string, err?: unknown) => void;
}

interface Slot {
  worker: Worker;
  ready: Promise<void>;
  busy: boolean;
  idleTimer?: ReturnType<typeof setTimeout>;
  /** The build this thread is running: its settle functions, and the encode slots it holds. */
  current?: Running;
}

interface Running {
  id: number;
  job: BuildJob;
  resolve: (m: ReleaseManifest) => void;
  reject: (err: unknown) => void;
  /** Encode admissions the main thread holds for this build, by encode id → release. */
  grants: Map<number, () => void>;
  onAbort?: () => void;
}

const FUNCTION_FIELDS = ['readMedia', 'storeMedia', 'mediaFilePath', 'runEncode', 'onProgress', 'signal'] as const;

/** A thread died under a build — the build is re-run on the main thread rather than failed. */
class ThreadLostError extends Error {
  constructor(
    readonly reason: string,
    readonly detail?: unknown,
    /** The thread hit its heap ceiling — the build itself is too big, not the thread at fault. */
    readonly outOfHeap = false,
  ) {
    super(`build thread lost: ${reason}`);
    this.name = 'ThreadLostError';
  }
}

export class ThreadBuildRunner implements BuildRunner {
  private readonly slots = new Set<Slot>();
  private nextId = 0;
  private closed = false;

  constructor(private readonly opts: ThreadRunnerOptions) {}

  /** Threads currently alive (busy or idle). Test seam. */
  get threads(): number {
    return this.slots.size;
  }

  async run(job: BuildJob): Promise<ReleaseManifest> {
    job.signal?.throwIfAborted();
    const usesMedia = Boolean(job.readMedia || job.storeMedia || job.mediaFilePath);
    if (this.closed || (usesMedia && !job.mediaSource)) return this.opts.fallback.run(job);
    const slot = this.takeIdleSlot() ?? (await this.startSlot());
    if (!slot) return this.opts.fallback.run(job);
    let lost: ThreadLostError;
    try {
      await this.whenReady(slot);
      return await this.runOn(slot, job);
    } catch (err) {
      // Shutting down terminated the thread under it: that is not a reason to build on the main thread.
      if (!(err instanceof ThreadLostError) || this.closed) throw err;
      lost = err;
    } finally {
      // Released BEFORE any fallback below: the thread may be healthy (a job that could not be sent).
      this.release(slot);
    }
    // ★ A build that ran its thread out of heap is NOT re-run on the main thread unless the threads have a
    // smaller ceiling than it (`retryOutOfHeap`): with the same ceiling it would exhaust that too — and
    // there it takes the PROCESS down, every tenant with it. Contained on the thread, it fails as a build.
    if (lost.outOfHeap && !this.opts.retryOutOfHeap) {
      throw new PublishError('this site is too large to build in the memory this instance has — the build ran out of heap');
    }
    // Never fail a build because of the thread it ran on: build it on the main thread instead.
    this.opts.onFallback?.(lost.reason, lost.detail);
    job.signal?.throwIfAborted();
    return this.opts.fallback.run(job);
  }

  /** A thread that neither starts nor fails (stuck loading) is discarded rather than waited on forever. */
  private whenReady(slot: Slot): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        void this.discard(slot);
        reject(new ThreadLostError('a build thread did not start in time'));
      }, this.opts.readyTimeoutMs ?? 30_000);
      timer.unref?.();
    });
    return Promise.race([slot.ready, timeout]).finally(() => clearTimeout(timer));
  }

  /** Terminate every thread (shutdown). Builds still running reject; new ones run on the main thread. */
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.slots].map((s) => this.discard(s)));
  }

  /** A warm thread that is free, claimed — reused without any memory check (it holds its memory already). */
  private takeIdleSlot(): Slot | undefined {
    for (const slot of this.slots) {
      if (!slot.busy) {
        slot.busy = true;
        if (slot.idleTimer) clearTimeout(slot.idleTimer);
        return slot;
      }
    }
    return undefined;
  }

  /** A NEW thread, when the pool has room and memory allows one; undefined → build on the main thread. */
  private async startSlot(): Promise<Slot | undefined> {
    if (this.slots.size >= Math.max(1, this.opts.size)) {
      this.opts.onFallback?.('every build thread is busy');
      return undefined;
    }
    if (this.opts.mayStartThread && !(await this.opts.mayStartThread())) {
      this.opts.onFallback?.('memory is tight');
      return undefined;
    }
    // Re-checked after the await: another build may have taken the last place meanwhile.
    if (this.closed || this.slots.size >= Math.max(1, this.opts.size)) return this.takeIdleSlot();
    try {
      const slot = this.spawn();
      slot.busy = true;
      return slot;
    } catch (err) {
      this.opts.onFallback?.('a build thread could not start', err);
      return undefined;
    }
  }

  private spawn(): Slot {
    const worker = new Worker(this.opts.workerUrl ?? new URL('./build-thread.js', import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: Math.max(64, Math.floor(this.opts.heapMb)) },
      ...(this.opts.execArgv ? { execArgv: this.opts.execArgv } : {}),
    });
    // An idle thread must not keep the process alive at shutdown.
    worker.unref();
    let markReady!: () => void;
    let markFailed!: (err: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      markFailed = reject;
    });
    // A thread that dies before it is ready rejects `ready`; nobody may be awaiting it yet.
    ready.catch(() => {});
    const slot: Slot = { worker, ready, busy: false };
    this.slots.add(slot);
    worker.on('message', (msg: FromThread) => {
      if (msg.type === 'ready') markReady();
      else this.onMessage(slot, msg);
    });
    const lost = (reason: string, cause?: unknown, outOfHeap = false): void => {
      markFailed(new ThreadLostError(reason, cause, outOfHeap));
      this.slots.delete(slot);
      if (slot.idleTimer) clearTimeout(slot.idleTimer);
      const running = slot.current;
      if (running) this.settle(slot, running, () => running.reject(new ThreadLostError(reason, cause, outOfHeap)));
    };
    worker.on('error', (err: Error & { code?: string }) =>
      err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? lost('the build thread ran out of heap', err, true) : lost('the build thread crashed', err),
    );
    worker.on('exit', (code) => lost(`the build thread exited (code ${code})`));
    return slot;
  }

  private runOn(slot: Slot, job: BuildJob): Promise<ReleaseManifest> {
    const id = this.nextId++;
    const threadJob = { ...job } as Record<string, unknown>;
    for (const field of FUNCTION_FIELDS) delete threadJob[field];
    return new Promise<ReleaseManifest>((resolve, reject) => {
      // The thread may have died after it was ready; nothing would ever answer this build then.
      if (!this.slots.has(slot)) return reject(new ThreadLostError('the build thread exited before the build started'));
      // An abort while the thread was starting has already fired — a listener added now never would.
      if (job.signal?.aborted) return reject(job.signal.reason);
      const running: Running = { id, job, resolve, reject, grants: new Map() };
      slot.current = running;
      if (job.signal) {
        running.onAbort = () => this.post(slot, { type: 'abort', id });
        job.signal.addEventListener('abort', running.onAbort, { once: true });
      }
      const sent = this.post(slot, {
        type: 'build',
        id,
        job: threadJob as ThreadJob,
        admitEncodes: Boolean(job.runEncode),
        reportProgress: Boolean(job.onProgress),
      });
      // A job that cannot be copied to the thread (a value structured clone refuses) would otherwise wait
      // forever for an answer that never comes.
      if (!sent) this.settle(slot, running, () => reject(new ThreadLostError('the job could not be sent to a build thread')));
    });
  }

  private onMessage(slot: Slot, msg: FromThread): void {
    const running = slot.current;
    if (!running || msg.type === 'ready' || msg.id !== running.id) return;
    switch (msg.type) {
      case 'progress':
        try {
          running.job.onProgress?.(msg.progress);
        } catch {
          // A progress listener that throws must not take the build down from the main thread.
        }
        return;
      case 'encode': {
        const admit = running.job.runEncode;
        if (!admit) {
          this.post(slot, { type: 'denied', id: running.id, encodeId: msg.encodeId, error: { name: 'Error', message: 'no encode admission' } });
          return;
        }
        // Through a promise, so even an admission that throws synchronously answers the thread — a throw
        // escaping this 'message' listener would be an uncaught exception on the main thread.
        Promise.resolve()
          .then(() =>
            admit(msg.bytes, () => {
              // Admitted: hold the slot until the thread says this encode finished (or the build ends).
              return new Promise<void>((release) => {
                if (slot.current !== running) return release(); // the build already ended
                running.grants.set(msg.encodeId, release);
                this.post(slot, { type: 'granted', id: running.id, encodeId: msg.encodeId });
              });
            }),
          )
          .catch((err: unknown) => this.post(slot, { type: 'denied', id: running.id, encodeId: msg.encodeId, error: serializeError(err) }));
        return;
      }
      case 'encoded':
        running.grants.get(msg.encodeId)?.();
        running.grants.delete(msg.encodeId);
        return;
      case 'done':
        this.settle(slot, running, () => running.resolve(msg.manifest));
        return;
      case 'failed':
        this.settle(slot, running, () => running.reject(this.rebuildError(running.job, msg.error)));
        return;
    }
  }

  /** End `running`: release every encode slot it still holds, detach the abort listener, then settle. */
  private settle(slot: Slot, running: Running, finish: () => void): void {
    if (slot.current === running) slot.current = undefined;
    for (const release of running.grants.values()) release();
    running.grants.clear();
    if (running.onAbort) running.job.signal?.removeEventListener('abort', running.onAbort);
    finish();
  }

  private rebuildError(job: BuildJob, e: SerializedError): unknown {
    // An abort is reported as the caller's own reason, as an in-process build reports it.
    if (job.signal?.aborted) return job.signal.reason;
    return deserializeError(e);
  }

  /** False when the message could not be sent (the thread is gone — its 'exit' handler settles the build). */
  private post(slot: Slot, msg: ToThread): boolean {
    try {
      slot.worker.postMessage(msg);
      return true;
    } catch {
      return false;
    }
  }

  private release(slot: Slot): void {
    slot.busy = false;
    if (!this.slots.has(slot)) return;
    if (this.closed) {
      void this.discard(slot);
      return;
    }
    const idleMs = this.opts.idleMs ?? 30_000;
    slot.idleTimer = setTimeout(() => void this.discard(slot), idleMs);
    slot.idleTimer.unref?.();
  }

  private async discard(slot: Slot): Promise<void> {
    this.slots.delete(slot);
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    await slot.worker.terminate().catch(() => 0);
  }
}
