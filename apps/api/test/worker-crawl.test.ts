import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { workerEnv, decodeBinary, makeWorkerCrawl } from '../src/import/worker-crawl.js';
import { encodeBinary } from '../src/import/fetch-worker.js';

describe('crawl worker isolation (#831)', () => {
  // The whole point of running the crawler out of process is that it holds nothing worth stealing.
  // If this ever goes red, the segmentation is decorative: the importer has open egress by design,
  // so anything reachable in its environment is one `fetch()` away from leaving the building.
  it('passes NO secret from the API process into the worker', () => {
    const source: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/root',
      PLAYWRIGHT_BROWSERS_PATH: '/browsers',
      // Everything below must NOT survive.
      SW_ENCRYPTION_KEY: 'secret-encryption-key',
      DATABASE_URL: 'file:/app/data/sitewright.db',
      COOKIE_SECRET: 'secret-cookie',
      SW_ADMIN_PASSWORD: 'secret-admin',
      SW_ADMIN_EMAIL: 'admin@example.com',
      SW_AI_API_KEY: 'sk-secret',
      SW_AI_BASE_URL: 'http://10.0.0.5:8080',
      SW_DEPLOY_ALLOWED_HOSTS: 'deploy.example.com',
      SW_SMTP_ALLOWED_HOSTS: 'smtp.example.com',
      GITHUB_TOKEN: 'ghp_secret',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
    };
    const env = workerEnv(source);

    expect(env.PATH).toBe('/usr/bin');
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe('/browsers');

    const leaked = Object.entries(env).filter(([, v]) => typeof v === 'string' && v.includes('secret'));
    expect(leaked, `these carried a secret into the crawl worker: ${JSON.stringify(leaked)}`).toEqual([]);
    for (const key of ['SW_ENCRYPTION_KEY', 'DATABASE_URL', 'COOKIE_SECRET', 'SW_ADMIN_PASSWORD', 'SW_AI_API_KEY', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY']) {
      expect(env, `${key} reached the crawl worker`).not.toHaveProperty(key);
    }
  });

  // An allowlist fails closed; a denylist fails open. This asserts the SHAPE, so a future edit that
  // "simplifies" it into `{...process.env, SECRET: undefined}` is caught rather than merely reviewed.
  it('is an allowlist — an unknown variable is dropped, not carried', () => {
    const env = workerEnv({ PATH: '/usr/bin', SW_SOME_FUTURE_SECRET: 'not-yet-invented' });
    expect(env).not.toHaveProperty('SW_SOME_FUTURE_SECRET');
    expect(Object.keys(env)).toEqual(['PATH']);
  });

  it('omits an allowlisted variable that is unset rather than defining it as undefined', () => {
    // `spawn` treats an explicit `undefined` differently from an absent key on some platforms; keep
    // the env clean so the child sees exactly what the parent had.
    const env = workerEnv({ PATH: '/usr/bin' });
    expect('HOME' in env).toBe(false);
  });
});

describe('crawl worker serialization (#831)', () => {
  // The crawl result carries `assets: Map<string, {bytes: Uint8Array}>`, and the boundary is a pipe.
  // A bug here does not throw — it silently yields empty or corrupted assets, so every imported
  // image would go missing with a green build. Round-trip the exact shape.
  it('round-trips a Map of binary asset bodies through JSON', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 10, 13, 34, 92]); // NULs, high bytes, quote, backslash
    const site = {
      baseUrl: 'https://example.com/',
      pages: [{ sourceUrl: 'https://example.com/', html: '<p>hi</p>' }],
      assets: new Map([['https://example.com/a.png', { contentType: 'image/png', bytes }]]),
    };

    const wire = JSON.parse(JSON.stringify(encodeBinary({ site })));
    const back = decodeBinary(wire) as typeof site extends never ? never : { site: typeof site };

    const asset = back.site.assets.get('https://example.com/a.png');
    expect(back.site.assets).toBeInstanceOf(Map);
    expect(asset?.bytes).toBeInstanceOf(Uint8Array);
    expect([...(asset?.bytes ?? [])]).toEqual([...bytes]);
    expect(back.site.pages[0]?.html).toBe('<p>hi</p>');
  });

  it('leaves plain values untouched', () => {
    const v = { a: 1, b: 'x', c: null, d: [1, 'two', { e: true }] };
    expect(decodeBinary(JSON.parse(JSON.stringify(encodeBinary(v))))).toEqual(v);
  });

  it('round-trips an EMPTY asset map and a zero-length body', () => {
    const site = { assets: new Map([['u', { bytes: new Uint8Array(0) }]]), empty: new Map() };
    const back = decodeBinary(JSON.parse(JSON.stringify(encodeBinary(site)))) as typeof site;
    expect(back.empty).toBeInstanceOf(Map);
    expect(back.empty.size).toBe(0);
    expect(back.assets.get('u')?.bytes).toBeInstanceOf(Uint8Array);
    expect(back.assets.get('u')?.bytes.length).toBe(0);
  });
});

describe('crawl worker process handling (#831)', () => {
  // A fake child so the failure modes are testable without spawning anything: the parent must never
  // hang, and must never resolve with a partial result.
  interface FakeChild extends EventEmitter {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: () => void };
    killed: boolean;
    kill: () => boolean;
  }
  function fakeChild(): FakeChild {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: () => {} };
    child.killed = false;
    child.kill = (): boolean => {
      child.killed = true;
      return true;
    };
    return child;
  }
  const crawlWith = (child: FakeChild, over: Record<string, unknown> = {}) =>
    makeWorkerCrawl({ fetchTimeoutMs: 1000, maxResourceBytes: 1024, spawn: () => child as unknown as ChildProcess, workerPath: '/dev/null', ...over });

  const deps = (extra: Record<string, unknown> = {}) => ({
    fetchResource: async () => null,
    isAllowed: async () => true,
    ...extra,
  }) as never;

  const OPTS = { maxPages: 1, maxDepth: 0, sameOriginOnly: true, maxBytesTotal: 1024, maxStylesheets: 1 };

  it('resolves the final result and streams progress to the caller', async () => {
    const child = fakeChild();
    const seen: unknown[] = [];
    const p = crawlWith(child)('https://e.com/', OPTS, deps({ onProgress: (e: unknown) => seen.push(e) }));
    child.stdout.emit('data', Buffer.from(`${JSON.stringify({ progress: { fetched: 1, queued: 0, url: 'u' } })}\n`));
    child.stdout.emit('data', Buffer.from(`${JSON.stringify({ ok: true, result: { site: { pages: [] }, truncated: false, warnings: [] } })}\n`));
    child.emit('close', 0);
    await expect(p).resolves.toMatchObject({ truncated: false });
    expect(seen).toEqual([{ fetched: 1, queued: 0, url: 'u' }]);
  });

  it('rejects with the worker’s own error message when it reports a failure', async () => {
    const child = fakeChild();
    const p = crawlWith(child)('https://e.com/', OPTS, deps());
    child.stdout.emit('data', Buffer.from(`${JSON.stringify({ ok: false, error: 'seed unreachable' })}\n`));
    child.emit('close', 1);
    await expect(p).rejects.toThrow(/seed unreachable/);
  });

  it('rejects — never hangs — when the worker dies without saying anything', async () => {
    const child = fakeChild();
    const p = crawlWith(child)('https://e.com/', OPTS, deps());
    child.emit('close', 9);
    await expect(p).rejects.toThrow(/exited with code 9/);
  });

  it('kills the worker and rejects when output exceeds the cap', async () => {
    const child = fakeChild();
    const p = crawlWith(child, { maxOutputBytes: 32 })('https://e.com/', OPTS, deps());
    child.stdout.emit('data', Buffer.from('x'.repeat(64)));
    await expect(p).rejects.toThrow(/too much output/);
    expect(child.killed).toBe(true);
  });

  it('kills the worker and rejects on abort', async () => {
    const child = fakeChild();
    const ac = new AbortController();
    const p = crawlWith(child)('https://e.com/', OPTS, deps({ signal: ac.signal }));
    ac.abort();
    await expect(p).rejects.toThrow(/aborted/);
    expect(child.killed).toBe(true);
  });

  it('kills the worker and rejects on timeout', async () => {
    const child = fakeChild();
    const p = crawlWith(child, { timeoutMs: 5 })('https://e.com/', OPTS, deps());
    await expect(p).rejects.toThrow(/timed out/);
    expect(child.killed).toBe(true);
  });

  it('propagates a spawn error', async () => {
    const child = fakeChild();
    const p = crawlWith(child)('https://e.com/', OPTS, deps());
    child.emit('error', new Error('ENOENT'));
    await expect(p).rejects.toThrow(/ENOENT/);
  });
});
