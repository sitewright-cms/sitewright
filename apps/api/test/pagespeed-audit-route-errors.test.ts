import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ScreenshotModule from '../src/render/screenshot.js';
import type * as PagespeedModule from '../src/render/pagespeed-audit.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { RenderPool } from '../src/render/render-pool.js';
import { RenderQueueBusyError } from '../src/render/render-slots.js';
import { GENERIC_RUN_FAILURE, toPagespeedRunError, type PagespeedAuditResult } from '../src/render/pagespeed-audit.js';
import { makeTestDb } from './helpers.js';

/**
 * The page-speed route's FAILURE answers, with the two browser seams (the render-slot pool and the
 * Lighthouse run) replaced — the build + ephemeral server underneath are real. The real-browser happy
 * path lives in pagespeed-audit-route.test.ts; these are the answers that used to be an opaque 500.
 */

const seams = vi.hoisted(() => ({
  slot: null as null | ((fn: () => Promise<unknown>, opts?: { signal?: AbortSignal }) => Promise<unknown>),
  audit: null as null | ((url: string, opts: { formFactor?: string; signal?: AbortSignal }) => Promise<unknown>),
  capture: null as null | (() => Promise<unknown>),
}));

vi.mock('../src/render/screenshot.js', async (importOriginal) => {
  const orig = await importOriginal<typeof ScreenshotModule>();
  return {
    ...orig,
    withRenderSlot: (fn: () => Promise<unknown>, opts?: { signal?: AbortSignal }) =>
      seams.slot ? seams.slot(fn, opts) : orig.withRenderSlot(fn, opts),
    captureScreenshots: (...args: Parameters<typeof orig.captureScreenshots>) =>
      seams.capture ? seams.capture() : orig.captureScreenshots(...args),
  };
});
vi.mock('../src/render/pagespeed-audit.js', async (importOriginal) => {
  const orig = await importOriginal<typeof PagespeedModule>();
  return {
    ...orig,
    runPagespeedAudit: (url: string, opts: { formFactor?: 'mobile' | 'desktop'; signal?: AbortSignal }) =>
      seams.audit ? seams.audit(url, opts) : orig.runPagespeedAudit(url, opts),
  };
});

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));

let app: FastifyInstance;
let base: string;
let cookie: string;
let projectId: string;
let homeId: string;
/** The app on a REAL socket: a client hanging up is a closed socket, which inject cannot fake. */
let address: string;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'sw-ps-errors-'));
  const db = await makeTestDb();
  app = await createApp({
    db,
    encryptionKey: Buffer.alloc(32, 7),
    maintenanceSweepMs: 0,
    mediaRoot: join(base, 'media'),
    publishRoot: join(base, 'sites'),
    previewRoot: join(base, 'preview'), // the audit routes register only with the preview subsystem
    renderPool: new RenderPool({ size: 1, workerPath }),
  });
  await app.ready();
  await registerAccount(db, 'ps@e2e.test', 'Pw-secret-1', { platformRole: 'developer' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ps@e2e.test', password: 'Pw-secret-1' } });
  cookie = login.cookies.find((c) => c.name === 'sw_session')!.value;
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: cookie }, payload: { name: 'PS', slug: 'ps-errors' } });
  projectId = (proj.json() as { project: { id: string } }).project.id;
  const pages = (await app.inject({ method: 'GET', url: `/projects/${projectId}/content/page`, cookies: { sw_session: cookie } })).json() as {
    items: Array<{ id: string; kind?: string }>;
  };
  homeId = pages.items.find((p) => p.kind !== 'link')!.id;
  address = await app.listen({ port: 0, host: '127.0.0.1' });
}, 60_000);

afterAll(async () => {
  // fetch() keeps a finished request's socket alive in its pool; drop it so close() need not wait on it.
  app?.server.closeAllConnections();
  await app?.close();
  await rm(base, { recursive: true, force: true });
});

beforeEach(() => {
  seams.slot = null;
  seams.audit = null;
  seams.capture = null;
});

const audit = (session = cookie) =>
  app.inject({ method: 'GET', url: `/projects/${projectId}/pagespeed-audit/${homeId}?formFactor=mobile`, cookies: { sw_session: session } });

/** The route allows 3 audits a minute PER SESSION — a test that needs more starts its own session. */
async function freshSession(): Promise<string> {
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ps@e2e.test', password: 'Pw-secret-1' } });
  return login.cookies.find((c) => c.name === 'sw_session')!.value;
}

/** A minimal audit result for a served URL, with the loopback origin in the places Lighthouse puts it. */
function fakeResult(url: string, formFactor = 'mobile'): PagespeedAuditResult {
  const origin = new URL(url).origin;
  return {
    url,
    formFactor: formFactor as 'mobile',
    scores: { performance: 31, accessibility: 100, bestPractices: 100, seo: 100 },
    metrics: { totalBlockingTimeMs: 790 },
    findings: [],
    mainThread: {
      longTasks: [{ url: `${origin}/_assets/_sw/shader-bg.js`, durationMs: 412, startMs: 2310 }],
      nonCompositedAnimations: [{ label: 'Hero', properties: ['background-position'], reasons: ['Unsupported CSS Property: background-position'] }],
    },
    lighthouseVersion: '13.5.0',
    fetchedAt: '2026-10-16T00:00:00.000Z',
  };
}

describe('pagespeed-audit route — failure answers', () => {
  it('every render slot busy → 503 + retry-after, flagged transient — not an opaque 500', async () => {
    seams.slot = async () => {
      throw new RenderQueueBusyError(12_000);
    };
    const res = await audit();
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('15');
    const body = res.json() as { code: string; transient: boolean; error: string };
    expect(body.code).toBe('capacity');
    expect(body.transient).toBe(true);
    expect(body.error).toMatch(/render queue is busy/);
  });

  it('a Lighthouse failure → 502 with its code and a message scrubbed of the loopback origin', async () => {
    // Exactly what runPagespeedAudit throws for a LighthouseError (code + friendlyMessage).
    seams.audit = async (url) => {
      const lhError = Object.assign(new Error('NO_FCP'), { code: 'NO_FCP', friendlyMessage: `The page ${url} did not paint any content.` });
      throw toPagespeedRunError(lhError, new URL(url).origin);
    };
    const res = await audit();
    expect(res.statusCode).toBe(502);
    const body = res.json() as { code: string; error: string };
    expect(body.code).toBe('NO_FCP');
    expect(body.error).toMatch(/The page \/ did not paint any content/);
    expect(body.error).not.toMatch(/127\.0\.0\.1/);
  });

  it('a browser crash → 502 with a FIXED sentence: its own text (debug port, temp path) stays in the log', async () => {
    seams.audit = async () => {
      throw toPagespeedRunError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:41873 (/tmp/lighthouse.Xa9)'), { code: 'ECONNREFUSED' }));
    };
    const res = await audit(await freshSession());
    expect(res.statusCode).toBe(502);
    const body = res.json() as { code: string; error: string };
    expect(body.code).toBe('LIGHTHOUSE_FAILED');
    expect(body.error).toContain(GENERIC_RUN_FAILURE);
    for (const leak of ['127.0.0.1', '41873', 'ECONNREFUSED', '/tmp']) expect(res.body, leak).not.toContain(leak);
  });

  it('an audit that succeeds carries its main-thread section, rebased off the loopback origin', async () => {
    seams.audit = async (url, opts) => fakeResult(url, opts.formFactor);
    const res = await audit();
    expect(res.statusCode).toBe(200);
    const body = res.json() as PagespeedAuditResult;
    expect(body.mainThread?.longTasks[0]?.url).toBe('/_assets/_sw/shader-bg.js');
    expect(body.mainThread?.nonCompositedAnimations[0]?.properties).toEqual(['background-position']);
    expect(res.body).not.toMatch(/127\.0\.0\.1/);
  });

  it('a client that disconnects mid-audit aborts the run and frees its slot', { timeout: 30_000 }, async () => {
    const session = await freshSession();
    const seen = hangingAudit();
    // Two abandoned audits: if either kept its slot, the pool (2) would be full for the third.
    for (let i = 0; i < 2; i += 1) {
      const ac = new AbortController();
      const pending = settle(
        fetch(`${address}/projects/${projectId}/pagespeed-audit/${homeId}?formFactor=mobile`, {
          headers: { cookie: `sw_session=${session}` },
          signal: ac.signal,
        }),
      );
      await untilRunning(pending, () => seen.length === i + 1);
      ac.abort();
      expect(await pending).toMatchObject({ name: 'AbortError' });
      await vi.waitFor(() => expect(seen[i]!.aborted).toBe(true));
    }
    seams.audit = async (url, opts) => fakeResult(url, opts.formFactor);
    const t0 = Date.now();
    const res = await audit(session);
    expect(res.statusCode).toBe(200);
    // Well under the 12 s queue wait: both slots really were released.
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it('a client that STAYS is never mistaken for one that left — a slow audit over a real socket completes', { timeout: 30_000 }, async () => {
    // The disconnect signal is the request's `close`. On a POST that event fires as soon as the body is
    // read; this route is a GET, where it fires only when the client really goes — pinned here, since a
    // premature abort would kill every audit and answer nothing.
    // Read when the audit finishes: the event DOES fire once the response has ended, as it should.
    let abortedWhileRunning: boolean | undefined;
    seams.audit = async (url, opts) => {
      await new Promise((r) => setTimeout(r, 1500));
      abortedWhileRunning = opts.signal!.aborted;
      return fakeResult(url, opts.formFactor);
    };
    const res = await fetch(`${address}/projects/${projectId}/pagespeed-audit/${homeId}?formFactor=mobile`, {
      headers: { cookie: `sw_session=${await freshSession()}` },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as PagespeedAuditResult).formFactor).toBe('mobile');
    expect(abortedWhileRunning).toBe(false);
  });

  it('a REMOTE MCP host that hangs up mid pagespeed_audit stops the audit behind it', { timeout: 30_000 }, async () => {
    // The agent path: host → POST /mcp → tool → in-process request to the audit route. The host's
    // tool-call timeout closes ITS socket; nothing else tells the server — so that close must reach
    // the audit through the MCP server and the in-process request.
    const key = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/api-keys`,
      cookies: { sw_session: cookie },
      payload: { name: 'agent', role: 'owner', capabilities: ['content:read'], expiresInDays: 30 },
    });
    const token = (key.json() as { token: string }).token;
    const seen = hangingAudit();
    const closes = vi.spyOn(McpServer.prototype, 'close');
    const ac = new AbortController();
    const pending = settle(
      fetch(`${address}/mcp`, {
        method: 'POST',
        headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'pagespeed_audit', arguments: { pageId: homeId } } }),
        signal: ac.signal,
      }),
    );
    await untilRunning(pending, () => seen.length === 1);
    ac.abort();
    expect(await pending).toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(seen[0]!.aborted, 'the audit behind the tool call was aborted').toBe(true));
    // The hang-up closed the per-request server; the handler's own `finally` must not close it again.
    await new Promise((r) => setTimeout(r, 200));
    expect(closes).toHaveBeenCalledTimes(1);
    closes.mockRestore();
  });
});

/** Make the next audits hang until aborted (as Lighthouse does until its Chrome is killed); returns their signals. */
function hangingAudit(): AbortSignal[] {
  const seen: AbortSignal[] = [];
  seams.audit = (_url, opts) =>
    new Promise((_resolve, reject) => {
      seen.push(opts.signal!);
      opts.signal!.addEventListener('abort', () => reject(opts.signal!.reason), { once: true });
    });
  return seen;
}

/** A fetch that resolves to its error, or to "HTTP <status> <body>" if it got an answer. */
function settle(p: Promise<Response>): Promise<unknown> {
  return p.then(
    async (r) => `HTTP ${r.status} ${await r.text()}`,
    (e: unknown) => e,
  );
}

/** Wait until the audit is running — failing fast, with the answer, if the request ended instead. */
async function untilRunning(pending: Promise<unknown>, running: () => boolean): Promise<void> {
  await vi.waitFor(
    async () => {
      const settled = await Promise.race([pending, Promise.resolve('pending')]);
      expect(settled, 'the request must still be in flight').toBe('pending');
      expect(running()).toBe(true);
    },
    { timeout: 20_000 },
  );
}

describe('preview screenshots — a busy render queue', () => {
  it('reports a RETRYABLE "busy" skip, not a permanent failure', async () => {
    const fresh = await makeTestDb();
    const local = await createApp({ db: fresh, mediaRoot: join(base, 'media2'), renderPool: new RenderPool({ size: 1, workerPath }) });
    await local.ready();
    try {
      await registerAccount(fresh, 'shot@e2e.test', 'Pw-secret-1', { platformRole: 'developer' });
      const login = await local.inject({ method: 'POST', url: '/auth/login', payload: { email: 'shot@e2e.test', password: 'Pw-secret-1' } });
      const t = login.cookies.find((c) => c.name === 'sw_session')!.value;
      const proj = await local.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Shot', slug: 'shot-busy' } });
      const id = (proj.json() as { project: { id: string } }).project.id;
      seams.capture = async () => {
        throw new RenderQueueBusyError(12_000);
      };
      const res = await local.inject({
        method: 'POST',
        url: `/projects/${id}/preview?screenshot=1`,
        cookies: { sw_session: t },
        payload: { id: 'home' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { screenshotsUnavailable?: { reason: string; retryable: boolean; message: string } };
      expect(body.screenshotsUnavailable).toMatchObject({ reason: 'busy', retryable: true });
      expect(body.screenshotsUnavailable?.message).toMatch(/busy/);
    } finally {
      await local.close();
    }
  });
});
