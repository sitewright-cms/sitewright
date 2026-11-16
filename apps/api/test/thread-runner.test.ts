import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import type { MediaAsset } from '@sitewright/schema';
import type { ProjectBundle } from '@sitewright/core';
import { renderTrustedSvgToPng } from '@sitewright/image-pipeline';
import { PublishError, type ReleaseManifest } from '../src/publish/build.js';
import { InProcessBuildRunner, type BuildJob, type BuildRunner } from '../src/publish/runner.js';
import { ThreadBuildRunner } from '../src/publish/thread-runner.js';
import { deserializeError, serializeError, serveBuilds, type FromThread, type ToThread } from '../src/publish/build-thread.js';
import { MediaStorage } from '../src/media/storage.js';

/**
 * Whole-site builds on worker threads (ThreadBuildRunner). The thread runs the COMPILED entry
 * (dist/publish/build-thread.js) — a worker cannot load TypeScript — which the `test` task builds first.
 *
 * What matters: a build on a thread produces exactly the bytes an in-process build does, the instance's
 * encode admission still decides every encode, author errors and aborts cross back as themselves, and a
 * build NEVER fails because of its thread — it runs on the main thread instead.
 */

const WORKER = new URL('../dist/publish/build-thread.js', import.meta.url);
const PUBLISHED_AT = '2026-11-16T00:00:00.000Z';
const SLUG = 'acme';

const roots: string[] = [];
const runners: ThreadBuildRunner[] = [];
async function tempDir(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  roots.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(runners.splice(0).map((r) => r.close()));
});
afterAll(async () => {
  await Promise.all(roots.map((d) => rm(d, { recursive: true, force: true })));
});

beforeAll(() => {
  if (!existsSync(fileURLToPath(WORKER))) throw new Error('dist/publish/build-thread.js is missing — run `pnpm -F @sitewright/api build` first');
});

type ImageAsset = Extract<MediaAsset, { kind: 'image' }>;
const HERO: ImageAsset = {
  kind: 'image',
  id: 'a1',
  folder: '',
  filename: 'hero.png',
  format: 'png',
  bytes: 1,
  width: 1200,
  height: 600,
  hasAlpha: false,
  animated: false,
  original: 'hero.png',
  url: `/media/${SLUG}/a1-hero.png`,
  placeholder: 'data:image/webp;base64,UklGRg==',
};

function bundle(pages = 6, extraSource = ''): ProjectBundle {
  return {
    project: {
      formatVersion: 2,
      id: 'p1',
      name: 'Acme',
      slug: SLUG,
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    },
    pages: [
      { id: 'home', path: '', title: 'Home', source: `<section>{{sw-image "${HERO.url}" alt="Hero" sizes="50vw"}}</section>` },
      ...Array.from({ length: pages }, (_, i) => ({
        id: `p-${i}`,
        path: `p-${i}`,
        title: `Page ${i}`,
        source: `<article class="prose p-${i % 5}"><h2>Page ${i}</h2><p>body</p>${extraSource}</article>`,
      })),
    ],
    templates: [],
    datasets: [],
    entries: [],
  } as unknown as ProjectBundle;
}

/** A media store holding only the hero's original — every variant must be encoded by the build. */
async function coldStore(): Promise<{ root: string; storage: MediaStorage }> {
  const root = await tempDir('sw-thr-media-');
  const storage = new MediaStorage(root);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#0a7"/></svg>`;
  await storage.storeFile(SLUG, HERO.id, HERO.original, await renderTrustedSvgToPng(svg, 1200, 600));
  return { root, storage };
}

/** An admission that counts encodes and how many it holds at once — the shape of the instance's gate. */
function countingAdmission(): { runEncode: BuildJob['runEncode']; admitted: () => number; held: () => number } {
  let admitted = 0;
  let held = 0;
  return {
    runEncode: async <T,>(_bytes: number, fn: () => Promise<T>): Promise<T> => {
      admitted += 1;
      held += 1;
      try {
        return await fn();
      } finally {
        held -= 1;
      }
    },
    admitted: () => admitted,
    held: () => held,
  };
}

async function jobFor(outDir: string, opts: { bundle?: ProjectBundle; signal?: AbortSignal } = {}): Promise<{ job: BuildJob; admission: ReturnType<typeof countingAdmission>; progress: unknown[] }> {
  const { root, storage } = await coldStore();
  const admission = countingAdmission();
  const progress: unknown[] = [];
  const job: BuildJob = {
    outDir,
    bundle: opts.bundle ?? bundle(),
    publishedAt: PUBLISHED_AT,
    media: [HERO],
    readMedia: (assetId, file) => storage.readStored(SLUG, assetId, file),
    storeMedia: (assetId, file, data) => storage.storeFile(SLUG, assetId, file, data),
    mediaFilePath: (assetId, file) => storage.resolveStoredPath(SLUG, assetId, file),
    mediaSource: { root, projectSlug: SLUG },
    runEncode: admission.runEncode,
    encodeConcurrency: 3,
    onProgress: (p) => void progress.push(p),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };
  return { job, admission, progress };
}

/** Every built file as `relative path → sha256`. */
async function snapshot(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.set(relative(dir, full).split(sep).join('/'), createHash('sha256').update(await readFile(full)).digest('hex'));
    }
  };
  await walk(dir);
  return files;
}

class SpyRunner implements BuildRunner {
  calls = 0;
  private readonly inner = new InProcessBuildRunner();
  run(job: BuildJob): Promise<ReleaseManifest> {
    this.calls += 1;
    return this.inner.run(job);
  }
}

function runner(over: Partial<ConstructorParameters<typeof ThreadBuildRunner>[0]> = {}): { runner: ThreadBuildRunner; fallback: SpyRunner; fallbacks: string[] } {
  const fallback = new SpyRunner();
  const fallbacks: string[] = [];
  const r = new ThreadBuildRunner({ size: 2, heapMb: 512, fallback, workerUrl: WORKER, onFallback: (reason) => void fallbacks.push(reason), ...over });
  runners.push(r);
  return { runner: r, fallback, fallbacks };
}

describe('ThreadBuildRunner — whole-site builds on worker threads', () => {
  it('★ builds on a thread byte-for-byte what an in-process build does — encodes admitted by the main thread', async () => {
    const out = await tempDir('sw-thr-out-');
    const inProcess = await jobFor(join(out, 'main'));
    await new InProcessBuildRunner().run(inProcess.job);

    const { runner: r, fallback } = runner();
    const onThread = await jobFor(join(out, 'thread'));
    const manifest = await r.run(onThread.job);

    expect(fallback.calls).toBe(0); // it really ran on the thread
    expect(r.threads).toBe(1);
    expect(manifest.routes).toBeGreaterThan(5);
    expect(await snapshot(join(out, 'thread'))).toEqual(await snapshot(join(out, 'main')));
    // Every encode went through the main thread's admission, as many as in-process, and all came back.
    expect(onThread.admission.admitted()).toBe(inProcess.admission.admitted());
    expect(onThread.admission.admitted()).toBeGreaterThan(0);
    expect(onThread.admission.held()).toBe(0);
    expect(onThread.progress.length).toBeGreaterThan(0);
    // The variants it encoded went back into the store, as an in-process build's do.
    expect((await readdir(onThread.job.mediaSource!.root, { recursive: true })).length).toBeGreaterThan(1);
  });

  it('reuses its thread for the next build', async () => {
    const out = await tempDir('sw-thr-out-');
    const { runner: r } = runner();
    await r.run((await jobFor(join(out, 'a'))).job);
    await r.run((await jobFor(join(out, 'b'))).job);
    expect(r.threads).toBe(1);
  });

  it('★ an author error crosses back as a PublishError (the route maps it to 409)', async () => {
    const out = await tempDir('sw-thr-out-');
    const { runner: r, fallback } = runner();
    const broken = bundle(1);
    (broken.pages as unknown as Array<{ source: string }>)[1]!.source = '{{#if open}}never closed';
    const { job } = await jobFor(join(out, 'x'), { bundle: broken });
    await expect(r.run(job)).rejects.toBeInstanceOf(PublishError);
    expect(fallback.calls).toBe(0); // an author error is not a thread failure — not retried
  });

  it('an abort stops the build on the thread and rejects with the caller’s reason', async () => {
    const out = await tempDir('sw-thr-out-');
    const { runner: r } = runner();
    const controller = new AbortController();
    const { job } = await jobFor(join(out, 'x'), { bundle: bundle(300), signal: controller.signal });
    const reason = new Error('caller left');
    const onProgress = job.onProgress!;
    let aborted = false;
    job.onProgress = (p) => {
      onProgress(p);
      if (!aborted) {
        aborted = true;
        controller.abort(reason);
      }
    };
    await expect(r.run(job)).rejects.toBe(reason);
  });

  it('★ a thread that cannot start never fails the build — it runs on the main thread', async () => {
    const out = await tempDir('sw-thr-out-');
    const { runner: r, fallback, fallbacks } = runner({ workerUrl: new URL('./no-such-thread.js', import.meta.url) });
    const { job } = await jobFor(join(out, 'x'));
    const manifest = await r.run(job);
    expect(manifest.routes).toBeGreaterThan(5);
    expect(fallback.calls).toBe(1);
    expect(fallbacks.length).toBe(1);
  });

  it('★★ a build that runs its thread out of heap FAILS as a build — it is never re-run on the main thread', async () => {
    // A thread gets the main thread's whole heap ceiling, so re-running there would exhaust that too, and
    // on the main thread that kills the process (every tenant), not just the build.
    const out = await tempDir('sw-thr-out-');
    const { runner: r, fallback } = runner({ heapMb: 64 });
    // ~40 MB of page source: far past a 64 MB heap once rendered, copied and minified.
    const { job } = await jobFor(join(out, 'x'), { bundle: bundle(40, `<p>${'x'.repeat(1_000_000)}</p>`) });
    const err = await r.run(job).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(String((err as Error).message)).toMatch(/too large to build/);
    expect(fallback.calls).toBe(0);
    expect(r.threads).toBe(0); // the dead thread is gone
  }, 120_000);

  it('re-runs an out-of-heap build on the main thread when the threads\u2019 ceiling is the smaller one', async () => {
    // Several threads split the main heap's ceiling, so a build that outgrows its share may still fit there.
    const out = await tempDir('sw-thr-out-');
    const { runner: r, fallback, fallbacks } = runner({ heapMb: 64, retryOutOfHeap: true });
    const { job } = await jobFor(join(out, 'x'), { bundle: bundle(40, `<p>${'x'.repeat(1_000_000)}</p>`) });
    const manifest = await r.run(job);
    expect(manifest.routes).toBeGreaterThan(40);
    expect(fallback.calls).toBe(1);
    expect(fallbacks.join(' ')).toMatch(/heap/);
  }, 120_000);

  it('an abort while the thread is still starting is honoured — the build never runs', async () => {
    const out = await tempDir('sw-thr-out-');
    const { runner: r } = runner();
    const controller = new AbortController();
    const { job } = await jobFor(join(out, 'x'), { signal: controller.signal });
    const reason = new Error('gone before it started');
    const running = r.run(job); // spawns a cold thread; aborted before it is ready
    controller.abort(reason);
    await expect(running).rejects.toBe(reason);
    expect(await readdir(out)).toEqual([]); // nothing was built
  });

  it('gives up on a thread that never starts, and builds on the main thread instead', async () => {
    const out = await tempDir('sw-thr-out-');
    const { runner: r, fallback, fallbacks } = runner({
      workerUrl: new URL('data:text/javascript,setInterval(() => {}, 1000)'),
      readyTimeoutMs: 300,
    });
    const manifest = await r.run((await jobFor(join(out, 'x'))).job);
    expect(manifest.routes).toBeGreaterThan(5);
    expect(fallback.calls).toBe(1);
    expect(fallbacks.join(' ')).toMatch(/did not start in time/);
  });

  it('★ a thread that dies holding an admitted encode gives that slot back — the gate never leaks', async () => {
    const out = await tempDir('sw-thr-out-');
    const { runner: r } = runner();
    const { job, admission } = await jobFor(join(out, 'x'));
    const admit = job.runEncode!;
    let killed = false;
    job.runEncode = (bytes, fn) =>
      admit(bytes, () => {
        // The main thread has just admitted this encode; the thread dies before it says it is done.
        if (!killed) {
          killed = true;
          void r.close();
        }
        return fn();
      });
    await expect(r.run(job)).rejects.toThrow(/build thread lost/);
    // Every admission the main thread held for that build has been released.
    for (let i = 0; i < 50 && admission.held() > 0; i++) await new Promise((res) => setTimeout(res, 20));
    expect(admission.held()).toBe(0);
  });

  it('builds on the main thread when the job carries media functions but no mediaSource to rebuild them', async () => {
    const out = await tempDir('sw-thr-out-');
    const { runner: r, fallback } = runner();
    const { job } = await jobFor(join(out, 'x'));
    delete job.mediaSource;
    await r.run(job);
    expect(fallback.calls).toBe(1);
    expect(r.threads).toBe(0);
  });

  it('★ under memory pressure starts no NEW thread — but keeps reusing a warm one (no cold-start churn)', async () => {
    const out = await tempDir('sw-thr-out-');
    let roomy = false;
    const { runner: r, fallback, fallbacks } = runner({ size: 2, mayStartThread: () => roomy, idleMs: 60_000 });
    await r.run((await jobFor(join(out, 'a'))).job);
    expect(fallback.calls).toBe(1); // no room for a thread: built on the main thread
    expect(fallbacks).toEqual(['memory is tight']);
    expect(r.threads).toBe(0);
    roomy = true;
    await r.run((await jobFor(join(out, 'b'))).job);
    expect(r.threads).toBe(1); // room again: a thread started
    roomy = false;
    await r.run((await jobFor(join(out, 'c'))).job);
    // Tight again, but the warm thread is reused rather than retired and later started cold.
    expect(fallback.calls).toBe(1);
    expect(r.threads).toBe(1);
  });

  it('builds on the main thread when every thread is busy (the audit build that takes no slot)', async () => {
    const out = await tempDir('sw-thr-out-');
    const { runner: r, fallback, fallbacks } = runner({ size: 1 });
    const [a, b] = [await jobFor(join(out, 'a')), await jobFor(join(out, 'b'))];
    await Promise.all([r.run(a.job), r.run(b.job)]);
    expect(fallback.calls).toBe(1);
    expect(fallbacks).toEqual(['every build thread is busy']);
  });

  it('retires a thread that has been idle, so an idle instance holds no build heap', async () => {
    const out = await tempDir('sw-thr-out-');
    const { runner: r } = runner({ idleMs: 50 });
    await r.run((await jobFor(join(out, 'x'))).job);
    expect(r.threads).toBe(1);
    await new Promise((res) => setTimeout(res, 300));
    expect(r.threads).toBe(0);
  });
});

describe('errors that cross the thread keep what the API dispatches on', () => {
  it('★ rebuilds the classes the error handler tells apart, with code, status, position and the thread\u2019s stack', async () => {
    const { TemplateError } = await import('@sitewright/blocks');
    const range = deserializeError(serializeError(new RangeError('tree too deep')));
    expect(range).toBeInstanceOf(RangeError); // → 400 "input too large", not a 500
    const original = new TemplateError('bad helper', { line: 3, column: 7 });
    const template = deserializeError(serializeError(original)) as InstanceType<typeof TemplateError>;
    expect(template).toBeInstanceOf(TemplateError);
    expect(template.message).toBe(original.message); // the position is not appended twice
    expect([template.line, template.column]).toEqual([3, 7]);
    const fsErr = deserializeError(serializeError(Object.assign(new Error('no space'), { code: 'ENOSPC', statusCode: 507 }))) as Error & { code?: string; statusCode?: number };
    expect([fsErr.code, fsErr.statusCode]).toEqual(['ENOSPC', 507]);
    const thrown = new Error('where it failed');
    expect(deserializeError(serializeError(thrown)).stack).toBe(thrown.stack);
    expect(deserializeError(serializeError(new PublishError('author error')))).toBeInstanceOf(PublishError);
  });
});

describe('serveBuilds — the thread side of the protocol', () => {
  function channel(): { send: (m: ToThread) => void; next: (type: FromThread['type']) => Promise<FromThread>; close: () => void } {
    const { port1, port2 } = new MessageChannel();
    serveBuilds(port2 as unknown as Parameters<typeof serveBuilds>[0]);
    const seen: FromThread[] = [];
    const waiters: Array<() => void> = [];
    port1.on('message', (m: FromThread) => {
      seen.push(m);
      for (const w of waiters.splice(0)) w();
    });
    const next = async (type: FromThread['type']): Promise<FromThread> => {
      for (;;) {
        const at = seen.findIndex((m) => m.type === type);
        if (at >= 0) return seen.splice(at, 1)[0]!;
        await new Promise<void>((r) => waiters.push(r));
      }
    };
    return { send: (m) => port1.postMessage(m), next, close: () => (port1.close(), port2.close()) };
  }

  it('asks for every encode, runs it only once granted, hands the slot back, then reports the manifest', async () => {
    const out = await tempDir('sw-thr-proto-');
    const { root } = await coldStore();
    const c = channel();
    try {
      await c.next('ready');
      c.send({ type: 'build', id: 1, job: { outDir: out, bundle: bundle(1), publishedAt: PUBLISHED_AT, media: [HERO], mediaSource: { root, projectSlug: SLUG }, encodeConcurrency: 1 }, admitEncodes: true, reportProgress: true });
      const ask = (await c.next('encode')) as Extract<FromThread, { type: 'encode' }>;
      expect(ask.bytes).toBeGreaterThan(0);
      c.send({ type: 'granted', id: 1, encodeId: ask.encodeId });
      expect(((await c.next('encoded')) as Extract<FromThread, { type: 'encoded' }>).encodeId).toBe(ask.encodeId);
      // Grant the rest as they come.
      const grantRest = (async () => {
        for (;;) {
          const more = (await c.next('encode')) as Extract<FromThread, { type: 'encode' }>;
          c.send({ type: 'granted', id: 1, encodeId: more.encodeId });
        }
      })();
      void grantRest.catch(() => {});
      const done = (await c.next('done')) as Extract<FromThread, { type: 'done' }>;
      expect(done.manifest.routes).toBeGreaterThan(0);
      expect(await c.next('progress')).toBeTruthy();
    } finally {
      c.close();
    }
  });

  it('fails the build when an encode is denied', async () => {
    const out = await tempDir('sw-thr-proto-');
    const { root } = await coldStore();
    const c = channel();
    try {
      await c.next('ready');
      c.send({ type: 'build', id: 2, job: { outDir: out, bundle: bundle(1), publishedAt: PUBLISHED_AT, media: [HERO], mediaSource: { root, projectSlug: SLUG } }, admitEncodes: true, reportProgress: false });
      const ask = (await c.next('encode')) as Extract<FromThread, { type: 'encode' }>;
      c.send({ type: 'denied', id: 2, encodeId: ask.encodeId, error: { name: 'Error', message: 'no memory' } });
      const failed = (await c.next('failed')) as Extract<FromThread, { type: 'failed' }>;
      expect(failed.error.message).toMatch(/no memory/);
    } finally {
      c.close();
    }
  });

  it('stops a build when told to abort', async () => {
    const out = await tempDir('sw-thr-proto-');
    const c = channel();
    try {
      await c.next('ready');
      c.send({ type: 'build', id: 3, job: { outDir: out, bundle: bundle(400), publishedAt: PUBLISHED_AT }, admitEncodes: false, reportProgress: true });
      await c.next('progress');
      c.send({ type: 'abort', id: 3 });
      const failed = (await c.next('failed')) as Extract<FromThread, { type: 'failed' }>;
      expect(failed.error.name).toBe('AbortError');
    } finally {
      c.close();
    }
  });
});
