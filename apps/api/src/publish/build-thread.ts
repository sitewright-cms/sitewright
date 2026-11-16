/**
 * The worker-thread side of {@link ThreadBuildRunner} (thread-runner.ts): runs `buildSite` off the API's
 * main thread, one build at a time, for as long as the runner keeps the thread.
 *
 * A job arrives without its functions — they cannot cross a thread. Media access is rebuilt here from
 * `mediaSource` (the same MediaStorage calls the API makes; threads share the filesystem). Image encodes
 * run HERE, but each is first ADMITTED by the main thread: the instance's encode gate and memory ledger
 * are one per process, so a thread asks for a slot, runs the encode, and says when it is done. Progress
 * and the outcome go back as messages; an abort comes in as one.
 */
import { readlinkSync } from 'node:fs';
import { setPriority } from 'node:os';
import { parentPort } from 'node:worker_threads';
import { MediaStorage } from '../media/storage.js';
import { TemplateError } from '@sitewright/blocks';
import { buildSite, PublishError, type BuildProgress, type BuildSiteOptions } from './build.js';

/** A job as it crosses to the thread: the options, minus everything that is a function. */
export type ThreadJob = Omit<BuildSiteOptions, 'readMedia' | 'storeMedia' | 'mediaFilePath' | 'runEncode' | 'onProgress' | 'signal'>;

/** Main thread → build thread. */
export type ToThread =
  | { type: 'build'; id: number; job: ThreadJob; admitEncodes: boolean; reportProgress: boolean }
  | { type: 'granted'; id: number; encodeId: number }
  | { type: 'denied'; id: number; encodeId: number; error: SerializedError }
  | { type: 'abort'; id: number };

/** Build thread → main thread. */
export type FromThread =
  | { type: 'ready' }
  | { type: 'progress'; id: number; progress: BuildProgress }
  | { type: 'encode'; id: number; encodeId: number; bytes: number }
  | { type: 'encoded'; id: number; encodeId: number }
  | { type: 'done'; id: number; manifest: Awaited<ReturnType<typeof buildSite>> }
  | { type: 'failed'; id: number; error: SerializedError };

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  /** An author-correctable build error (PublishError → HTTP 409). Its class has no name of its own. */
  publish?: boolean;
  /** Properties the API's error handler dispatches on (`code`, `statusCode`, a template's position). */
  code?: string;
  statusCode?: number;
  line?: number;
  column?: number;
}

export function serializeError(err: unknown): SerializedError {
  if (!(err instanceof Error)) return { name: 'Error', message: String(err) };
  const e = err as Error & { code?: unknown; statusCode?: unknown; line?: unknown; column?: unknown };
  return {
    name: err.name,
    message: err.message,
    ...(err.stack ? { stack: err.stack } : {}),
    ...(err instanceof PublishError ? { publish: true } : {}),
    ...(typeof e.code === 'string' ? { code: e.code } : {}),
    ...(typeof e.statusCode === 'number' ? { statusCode: e.statusCode } : {}),
    ...(typeof e.line === 'number' ? { line: e.line } : {}),
    ...(typeof e.column === 'number' ? { column: e.column } : {}),
  };
}

/** The error classes the API's handler tells apart (`instanceof`), rebuilt as themselves. */
const BUILTIN_ERRORS: Record<string, new (message: string) => Error> = {
  RangeError,
  TypeError,
  SyntaxError,
  ReferenceError,
  URIError,
  EvalError,
};

/** Rebuild an error that crossed a thread: same class where it matters, same message, code and stack. */
export function deserializeError(e: SerializedError): Error {
  let err: Error;
  if (e.publish) err = new PublishError(e.message);
  else if (e.name === 'TemplateError') err = new TemplateError(e.message);
  else if (Object.prototype.hasOwnProperty.call(BUILTIN_ERRORS, e.name)) err = new BUILTIN_ERRORS[e.name]!(e.message);
  else {
    err = new Error(e.message);
    err.name = e.name;
  }
  const extra: Record<string, unknown> = {};
  if (e.code !== undefined) extra.code = e.code;
  if (e.statusCode !== undefined) extra.statusCode = e.statusCode;
  if (e.line !== undefined) extra.line = e.line;
  if (e.column !== undefined) extra.column = e.column;
  Object.assign(err, extra);
  // The thread's stack is the one that says where the build failed; the main thread's says nothing.
  if (e.stack) err.stack = e.stack;
  return err;
}

/** Wire one thread's message loop to `port`. Exported so a test can drive it over a MessageChannel. */
export function serveBuilds(port: { postMessage(msg: FromThread): void; on(event: 'message', fn: (msg: ToThread) => void): unknown }): void {
  const grants = new Map<number, { ok: () => void; fail: (err: Error) => void }>();
  const aborts = new Map<number, AbortController>();
  let nextEncode = 0;

  port.on('message', (msg: ToThread) => {
    if (msg.type === 'granted') {
      grants.get(msg.encodeId)?.ok();
      return;
    }
    if (msg.type === 'denied') {
      grants.get(msg.encodeId)?.fail(deserializeError(msg.error));
      return;
    }
    if (msg.type === 'abort') {
      aborts.get(msg.id)?.abort(new DOMException('The build was aborted', 'AbortError'));
      return;
    }
    const { id, job } = msg;
    const controller = new AbortController();
    aborts.set(id, controller);
    const store = job.mediaSource ? new MediaStorage(job.mediaSource.root) : undefined;
    const slug = job.mediaSource?.projectSlug ?? '';
    const runEncode = msg.admitEncodes
      ? <T>(bytes: number, fn: () => Promise<T>): Promise<T> =>
          new Promise<T>((resolve, reject) => {
            const encodeId = nextEncode++;
            grants.set(encodeId, {
              ok: () => {
                grants.delete(encodeId);
                // Started through a promise, so even an encode that throws synchronously rejects here
                // instead of escaping the 'message' listener and taking the thread down.
                Promise.resolve()
                  .then(fn)
                  .then(resolve, reject)
                  // ALWAYS hand the slot back, success or not — the main thread holds it until we do.
                  .finally(() => port.postMessage({ type: 'encoded', id, encodeId }));
              },
              fail: (err) => {
                grants.delete(encodeId);
                reject(err);
              },
            });
            port.postMessage({ type: 'encode', id, encodeId, bytes });
          })
      : undefined;
    const options: BuildSiteOptions = {
      ...job,
      ...(store
        ? {
            readMedia: (assetId: string, file: string) => store.readStored(slug, assetId, file),
            storeMedia: (assetId: string, file: string, data: Buffer) => store.storeFile(slug, assetId, file, data),
            mediaFilePath: (assetId: string, file: string) => store.resolveStoredPath(slug, assetId, file),
          }
        : {}),
      ...(runEncode ? { runEncode } : {}),
      ...(msg.reportProgress ? { onProgress: (progress: BuildProgress) => port.postMessage({ type: 'progress', id, progress }) } : {}),
      signal: controller.signal,
    };
    buildSite(options)
      .then((manifest) => port.postMessage({ type: 'done', id, manifest }))
      .catch((err: unknown) => port.postMessage({ type: 'failed', id, error: serializeError(err) }))
      .finally(() => aborts.delete(id));
  });
  port.postMessage({ type: 'ready' });
}

/**
 * Run this thread's builds at a LOWER CPU priority than the rest of the process. A build soaks up whatever
 * CPU it gets; under saturation it must not starve the requests, the image encodes and the browser that
 * share the container — MEASURED on a 6-CPU container under the heaviest load, builds off the main thread
 * left the cgroup throttled for 317 s of a 150 s phase. Linux applies a thread id's niceness to that
 * thread only; elsewhere, or where it is refused, the build simply runs at normal priority.
 */
function lowerThisThreadsPriority(): void {
  try {
    const tid = Number(readlinkSync('/proc/thread-self').split('/').pop());
    if (Number.isInteger(tid) && tid > 0) setPriority(tid, 10);
  } catch {
    // Not Linux, or not permitted: nothing to do.
  }
}

if (parentPort) {
  lowerThisThreadsPriority();
  serveBuilds(parentPort);
}
