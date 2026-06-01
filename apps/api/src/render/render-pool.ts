// A pool of long-lived, pre-warmed CHILD-PROCESS render workers, all inside the one
// API container (no second container) — chosen for the curated, semi-trusted tenant
// model and "single container, low resource". Each worker is forked with a hard V8 heap
// ceiling (`--max-old-space-size`); the pool enforces a per-render TIMEOUT, respawns a
// worker on crash/OOM, RECYCLES a worker after N renders (bounds memory creep), and
// drains+kills on shutdown (k8s SIGTERM). One render in flight per worker.
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TemplateContext, RenderOptions } from '@sitewright/blocks';

export interface RenderPoolOptions {
  /** Number of warm workers. */
  size?: number;
  /** Override the forked worker entry (tests inject a fixture). */
  workerPath?: string;
  /** Per-worker V8 old-space ceiling in MiB (a render over this OOMs that worker). */
  memoryLimitMb?: number;
  /** Reject + kill+respawn a worker whose render exceeds this. */
  renderTimeoutMs?: number;
  /** Recycle (replace) a worker after this many renders, to bound heap creep. */
  maxRendersPerWorker?: number;
  /** Max queued (waiting) renders before new requests are rejected (bounds parent memory). */
  maxQueueDepth?: number;
}

interface Job {
  source: string;
  context: TemplateContext;
  opts: RenderOptions;
  resolve: (html: string) => void;
  reject: (err: Error) => void;
}

interface Slot {
  proc: ChildProcess;
  renders: number;
  /** True once we've signalled this worker to die (recycle/timeout) — never dispatch to it. */
  retiring?: boolean;
  current?: { id: number; job: Job; timer: NodeJS.Timeout };
}

const DEFAULTS = { size: 2, memoryLimitMb: 128, renderTimeoutMs: 5000, maxRendersPerWorker: 500, maxQueueDepth: 50 };

/** Thrown when a render cannot be completed by the pool (timeout, worker crash, shutdown). */
export class RenderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderUnavailableError';
  }
}

export class RenderPool {
  private readonly opts: Required<RenderPoolOptions>;
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private nextId = 1;
  private shuttingDown = false;

  constructor(options: RenderPoolOptions = {}) {
    this.opts = {
      size: options.size ?? DEFAULTS.size,
      workerPath: options.workerPath ?? fileURLToPath(new URL('./render-worker.js', import.meta.url)),
      memoryLimitMb: options.memoryLimitMb ?? DEFAULTS.memoryLimitMb,
      renderTimeoutMs: options.renderTimeoutMs ?? DEFAULTS.renderTimeoutMs,
      maxRendersPerWorker: options.maxRendersPerWorker ?? DEFAULTS.maxRendersPerWorker,
      maxQueueDepth: options.maxQueueDepth ?? DEFAULTS.maxQueueDepth,
    };
    for (let n = 0; n < this.opts.size; n += 1) this.slots.push(this.spawn());
  }

  /** Renders a template in an isolated worker. Rejects on timeout, crash/OOM, or shutdown. */
  render(source: string, context: TemplateContext, opts: RenderOptions = {}): Promise<string> {
    if (this.shuttingDown) return Promise.reject(new RenderUnavailableError('render pool is shutting down'));
    return new Promise<string>((resolve, reject) => {
      const job: Job = { source, context, opts, resolve, reject };
      const free = this.slots.find((s) => !s.current && !s.retiring);
      if (free) this.assign(free, job);
      else if (this.queue.length >= this.opts.maxQueueDepth) {
        reject(new RenderUnavailableError('render pool is busy'));
      } else this.queue.push(job);
    });
  }

  /** Drains the queue (rejecting), then terminates all workers. Idempotent. */
  async shutdown(graceMs = 2000): Promise<void> {
    this.shuttingDown = true;
    for (const job of this.queue.splice(0)) job.reject(new RenderUnavailableError('render pool is shutting down'));
    const exits = this.slots.map(
      (slot) =>
        new Promise<void>((done) => {
          if (slot.current) {
            clearTimeout(slot.current.timer);
            slot.current.job.reject(new RenderUnavailableError('render pool is shutting down'));
            slot.current = undefined;
          }
          slot.proc.once('exit', () => done());
          slot.proc.kill('SIGTERM');
          setTimeout(() => {
            if (slot.proc.killed === false || slot.proc.exitCode === null) slot.proc.kill('SIGKILL');
          }, graceMs).unref?.();
        }),
    );
    this.slots = [];
    await Promise.all(exits);
  }

  // ---- internals ----------------------------------------------------------
  private spawn(): Slot {
    const proc = fork(this.opts.workerPath, [], {
      execArgv: [`--max-old-space-size=${this.opts.memoryLimitMb}`],
      // stdout is IGNORED (a render must never write to the API's logs — closes the
      // {{log}} info-disclosure path); stderr is inherited for crash diagnostics only.
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      serialization: 'json',
    });
    const slot: Slot = { proc, renders: 0 };
    proc.on('message', (reply: { id: number; html?: string; error?: string }) => this.onReply(slot, reply));
    proc.on('exit', () => this.onExit(slot));
    // A child can emit 'error' (spawn failure, EPIPE on a closing channel). Swallow it —
    // the 'exit' handler owns lifecycle (reject in-flight + respawn). An unhandled 'error'
    // would otherwise crash the API process.
    proc.on('error', () => {});
    return slot;
  }

  private assign(slot: Slot, job: Job): void {
    const id = this.nextId++;
    const timer = setTimeout(() => this.onTimeout(slot), this.opts.renderTimeoutMs);
    timer.unref?.();
    slot.renders += 1;
    slot.current = { id, job, timer };
    // send can throw if the channel just closed (worker died mid-dispatch); treat that as
    // a crash — reject, retire the slot, and let the exit handler respawn.
    slot.proc.send({ id, source: job.source, context: job.context, opts: job.opts }, (err) => {
      if (err && slot.current?.id === id) {
        clearTimeout(slot.current.timer);
        slot.current = undefined;
        slot.retiring = true;
        job.reject(new RenderUnavailableError('render worker is unavailable'));
        slot.proc.kill('SIGKILL');
      }
    });
  }

  private onReply(slot: Slot, reply: { id: number; html?: string; error?: string }): void {
    const inflight = slot.current;
    if (!inflight || inflight.id !== reply.id) return; // stale/duplicate
    clearTimeout(inflight.timer);
    slot.current = undefined;
    if (reply.error !== undefined) inflight.job.reject(new Error(reply.error));
    else inflight.job.resolve(reply.html ?? '');
    this.afterFree(slot);
  }

  private onTimeout(slot: Slot): void {
    const inflight = slot.current;
    if (!inflight) return;
    slot.current = undefined;
    slot.retiring = true;
    inflight.job.reject(new RenderUnavailableError('render timed out'));
    slot.proc.kill('SIGKILL'); // a stuck worker — onExit will replace it
  }

  private onExit(slot: Slot): void {
    if (slot.current) {
      clearTimeout(slot.current.timer);
      slot.current.job.reject(new RenderUnavailableError('render worker exited (crash or out-of-memory)'));
      slot.current = undefined;
    }
    const idx = this.slots.indexOf(slot);
    if (idx !== -1) this.slots.splice(idx, 1);
    if (!this.shuttingDown) {
      const replacement = this.spawn();
      this.slots.push(replacement);
      this.drain(replacement);
    }
  }

  /** After a worker frees up: recycle it if over its render budget, else pull the next job. */
  private afterFree(slot: Slot): void {
    if (this.shuttingDown) return;
    if (slot.renders >= this.opts.maxRendersPerWorker) {
      slot.retiring = true;
      slot.proc.kill('SIGTERM'); // graceful recycle → onExit respawns a fresh worker
      return;
    }
    this.drain(slot);
  }

  private drain(slot: Slot): void {
    if (this.shuttingDown || slot.current || slot.retiring) return;
    const job = this.queue.shift();
    if (job) this.assign(slot, job);
  }
}
