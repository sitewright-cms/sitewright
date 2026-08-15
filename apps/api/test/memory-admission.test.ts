import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers.js';
import { createApp, _setMemoryBudgetForTest } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { RenderPool } from '../src/render/render-pool.js';
import { fileURLToPath } from 'node:url';

// The preview route 503s with "rendering is not available" unless a pool is injected, so without one
// the screenshot assertions below would be testing an unreachable path.
const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));

/**
 * The memory ledger's DENIAL branch, over real HTTP.
 *
 * These exist because the branch was unreachable in tests: nothing called `initMemoryBudget`, so
 * `admitMemory` always took the unconditional-admit fallback. A shed request therefore surfaced as an
 * opaque `500 internal error` on the upload paths — the global error handler passed through only
 * 4xx plus an allowlisted 429/413, so a thrown 503 fell into the "server fault" branch. An agent
 * reading a 500 as fatal abandons the work instead of retrying, which is the whole point of shedding.
 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);
const MB = 1024 * 1024;

let app: FastifyInstance;
let db: Database;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-admission-'));
  db = await makeTestDb();
  app = await createApp({ db, mediaRoot, renderPool: new RenderPool({ size: 1, workerPath }) });
  await app.ready();
});
afterEach(async () => {
  // Restore a roomy budget so a starved ledger cannot leak into another test file's run — the
  // budget is a process-wide singleton.
  _setMemoryBudgetForTest(8192 * MB, 0);
  if (app) await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

async function setup(email = 'mem@e2e.test') {
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
  const t = login.cookies.find((c) => c.name === 'sw_session')!.value;
  const proj = await app.inject({
    method: 'POST',
    url: '/projects',
    cookies: { sw_session: t },
    payload: { name: 'Mem', slug: `mem${Date.now().toString(36)}` },
  });
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id };
}

/** A multipart image upload — the highest-volume path through the optimize gate. */
function imageUpload(projectId: string, t: string) {
  const boundary = '----swtest';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
    PNG_1X1,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return app.inject({
    method: 'POST',
    url: `/projects/${projectId}/media`,
    cookies: { sw_session: t },
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
}

describe('memory admission over HTTP', () => {
  it('admits an image upload when there is headroom', async () => {
    const { t, projectId } = await setup();
    _setMemoryBudgetForTest(1024 * MB, 100 * MB);
    const res = await imageUpload(projectId, t);
    expect(res.statusCode, 'plenty of room → the upload proceeds').toBe(201);
  });

  it('sheds an image upload with a RETRYABLE 503 — never an opaque 500', async () => {
    const { t, projectId } = await setup();
    // Ledger says the instance is effectively full.
    _setMemoryBudgetForTest(1024 * MB, 1020 * MB);
    const res = await imageUpload(projectId, t);
    expect(res.statusCode, 'a shed request must not look like a server fault').toBe(503);
    expect(res.statusCode).not.toBe(500);
    // The wording carries the retry signal an agent needs to not give up.
    expect(String(res.json().error)).toMatch(/transient|retry/i);
  });

  it('does not leak the reservation: capacity returns once the budget does', async () => {
    const { t, projectId } = await setup();
    _setMemoryBudgetForTest(1024 * MB, 1020 * MB);
    expect((await imageUpload(projectId, t)).statusCode).toBe(503);
    // Same instance, headroom restored — a leaked reservation would keep refusing forever.
    _setMemoryBudgetForTest(1024 * MB, 100 * MB);
    expect((await imageUpload(projectId, t)).statusCode, 'refusals must not poison the ledger').toBe(201);
  });
});

describe('a shed screenshot explains itself', () => {
  // A refusal now WAITS for headroom first (bounded), so a shed request is deliberately slower than
  // the 5s default allows. That latency is the price of turning most 503s into slow successes.
  it('says the image was skipped for memory and that it is retryable — not silence', { timeout: 20_000 }, async () => {
    // Before this, a refusal was indistinguishable from "this build has no Chromium": the caller got
    // HTML with no picture and no reason, so an agent could not tell that retrying would work.
    const { t, projectId } = await setup('shot@e2e.test');
    _setMemoryBudgetForTest(1024 * MB, 1020 * MB);
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview?screenshot=1`,
      cookies: { sw_session: t },
      payload: { id: 'home' },
    });
    expect(res.statusCode, 'the HTML itself is still served').toBe(200);
    const body = res.json() as { html?: string; screenshots?: unknown; screenshotsUnavailable?: { reason: string; retryable: boolean; message: string } };
    expect(body.html, 'best-effort: the document is complete').toBeTruthy();
    expect(body.screenshots).toBeUndefined();
    expect(body.screenshotsUnavailable?.reason).toBe('memory');
    expect(body.screenshotsUnavailable?.retryable, 'the caller must know a retry can succeed').toBe(true);
    expect(body.screenshotsUnavailable?.message).toMatch(/retry/i);
  });

  it('omits the field entirely when no screenshot was asked for', { timeout: 20_000 }, async () => {
    const { t, projectId } = await setup('noshot@e2e.test');
    _setMemoryBudgetForTest(1024 * MB, 1020 * MB);
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: { id: 'home' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Record<string, unknown>).screenshotsUnavailable, 'no ask, no notice').toBeUndefined();
  });
});
