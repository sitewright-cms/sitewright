import { Worker } from 'node:worker_threads';
import { ICS_LIMITS, TOO_BIG, UNREADABLE, type IcsParseResult, type IcsReadOptions } from './ics-read.js';

export const TOO_SLOW = 'the calendar took too long to read';

/**
 * READING A FEED IN A WORKER THREAD, stopped at a deadline.
 *
 * ★ ical.js can loop forever INSIDE ONE CALL: a rule whose dates never come (`FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30`)
 * hangs its iterator's `next()` for good. MEASURED: on the API's own thread that froze the whole server, every
 * tenant's requests with it, and yielding between steps cannot help, as the call never returns. A worker is
 * terminated mid-loop: the calendar reads as unreadable (its resource fails closed) and the server carries on.
 * The parse of a large feed also runs off the main thread, in a heap of its own.
 */
export const ICS_WORKER = {
  /** The reader's own budget, plus the worker's start-up. */
  timeoutMs: ICS_LIMITS.maxMs + 3_000,
  heapMb: 192,
  /** Readings at once across the instance; the rest wait their turn. */
  concurrent: 2,
} as const;

/** Under test the reader is TypeScript: Node strips its types, and its `./x.js` imports are found as `./x.ts`. */
const RESOLVE_TS =
  "export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if ((s.startsWith('./') || s.startsWith('../')) && s.endsWith('.js')) return next(s.slice(0, -3) + '.ts', c); throw e; } }";

/**
 * The worker's whole program, `eval`'d: no separate entry file to ship or to resolve from sources. Dynamic imports
 * only, so it runs whether Node reads it as CommonJS or, under a parent started with `--input-type=module` (whose
 * flags a worker inherits), as a module.
 */
const WORKER_SOURCE = `
(async () => {
  const { parentPort, workerData } = await import('node:worker_threads');
  try {
    if (workerData.fromSource) (await import('node:module')).register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(RESOLVE_TS)}));
    const { readIcsBusy } = await import(workerData.moduleUrl);
    parentPort.postMessage(await readIcsBusy(workerData.text, workerData.opts));
  } catch {
    parentPort.postMessage({ ok: false, error: ${JSON.stringify(UNREADABLE)} });
  }
})();
`;

const fromSource = import.meta.url.endsWith('.ts');
const READER_URL = new URL(fromSource ? './ics-read.ts' : './ics-read.js', import.meta.url).href;

let running = 0;
const waiting: Array<() => void> = [];

/** Runs `fn` in one of the `concurrent` slots. A finished reading hands its slot straight to the next in line. */
async function inSlot<T>(cap: number, fn: () => Promise<T>): Promise<T> {
  if (running < cap) running += 1;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

function isResult(r: unknown): r is IcsParseResult {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return (o.ok === true && Array.isArray(o.intervals) && typeof o.events === 'number') || (o.ok === false && typeof o.error === 'string');
}

/** {@link readIcsBusy} in a worker thread. Never rejects: whatever goes wrong, the calendar is unreadable. */
export function readIcsIsolated(
  text: string,
  opts: Omit<IcsReadOptions, 'now'>,
  limits: { timeoutMs: number; heapMb: number; concurrent: number } = ICS_WORKER,
): Promise<IcsParseResult> {
  return inSlot(
    limits.concurrent,
    () =>
      new Promise<IcsParseResult>((resolve) => {
        let worker: Worker;
        try {
          worker = new Worker(WORKER_SOURCE, {
            eval: true,
            workerData: { moduleUrl: READER_URL, fromSource, text, opts },
            resourceLimits: { maxOldGenerationSizeMb: limits.heapMb },
          });
        } catch {
          resolve({ ok: false, error: UNREADABLE });
          return;
        }
        let settled = false;
        const done = (result: IcsParseResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          void worker.terminate();
          resolve(result);
        };
        // Stuck, or just too slow: stopped where it is.
        const timer = setTimeout(() => done({ ok: false, error: TOO_SLOW }), limits.timeoutMs);
        worker.once('message', (reply: unknown) => done(isResult(reply) ? reply : { ok: false, error: UNREADABLE }));
        worker.once('error', (err: Error & { code?: string }) => done({ ok: false, error: err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? TOO_BIG : UNREADABLE }));
        worker.once('exit', () => done({ ok: false, error: UNREADABLE }));
      }),
  );
}
