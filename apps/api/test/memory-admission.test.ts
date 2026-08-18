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

describe('the unpaginated content list is admitted like every other expensive path', () => {
  /** Seed enough content that the list is worth pricing (the admit floor is 2MB). */
  async function seedBulk(t: string, projectId: string) {
    const source = `<section>${'<p>lorem ipsum dolor sit amet consectetur</p>'.repeat(1200)}</section>`;
    for (let i = 0; i < 30; i++) {
      const res = await app.inject({
        method: 'PUT',
        url: `/projects/${projectId}/content/page/p${i}`,
        cookies: { sw_session: t },
        payload: { id: `p${i}`, path: `p${i}`, title: `P${i}`, source },
      });
      expect(res.statusCode).toBe(200);
    }
  }

  it('serves the list when there is headroom', async () => {
    const { t, projectId } = await setup('list-ok@e2e.test');
    await seedBulk(t, projectId);
    _setMemoryBudgetForTest(4096 * MB, 100 * MB);
    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/content/page`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { items: unknown[] }).items.length).toBe(31); // 30 + the scaffolded home
  });

  it('sheds a big list with a retryable 503 instead of taking the instance down', async () => {
    // Measured before this: one list on a 61-page project peaked 37MB and THREE concurrent peaked
    // 206MB — on the everyday editing path, with no gate of any kind.
    const { t, projectId } = await setup('list-shed@e2e.test');
    await seedBulk(t, projectId);
    _setMemoryBudgetForTest(1024 * MB, 1020 * MB);
    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/content/page`, cookies: { sw_session: t } });
    expect(res.statusCode, 'shed, not served, not OOM').toBe(503);
    expect(String(res.json().error)).toMatch(/transient|retry/i);
  }, 20_000);

  it('does NOT gate a small list — the estimate would cost more than the memory', async () => {
    const { t, projectId } = await setup('list-small@e2e.test');
    _setMemoryBudgetForTest(1024 * MB, 1020 * MB); // starved, but the payload is tiny
    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/content/page`, cookies: { sw_session: t } });
    expect(res.statusCode, 'a one-page list is never worth refusing').toBe(200);
  });

  it('a PAGINATED caller is already bounded and skips admission entirely', async () => {
    const { t, projectId } = await setup('list-paged@e2e.test');
    await seedBulk(t, projectId);
    _setMemoryBudgetForTest(1024 * MB, 1020 * MB);
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/content/page?limit=5`,
      cookies: { sw_session: t },
    });
    expect(res.statusCode, 'paging is the way through a starved instance, not a wall').toBe(200);
    expect((res.json() as { items: unknown[] }).items.length).toBe(5);
  });

  // Waits out ADMISSION_WAIT_MS by design before shedding, so it needs more than the default 5s
  // budget once the whole suite is running under coverage.
  it('★ a paginated SEARCH is still admitted — what it costs is not what it returns', { timeout: 20_000 }, async () => {
    // `?q=` has no index behind it: every row of the kind is read and json_extract-ed whatever `limit`
    // says, so `?q=a&limit=1` is a full scan wearing a cheap-looking request. If pagination exempted it
    // the way it exempts an ordinary page, a starved instance would keep serving unbounded scans.
    const { t, projectId } = await setup('list-paged-q@e2e.test');
    await seedBulk(t, projectId);
    _setMemoryBudgetForTest(1024 * MB, 1020 * MB);
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/content/page?limit=1&q=p1`,
      cookies: { sw_session: t },
    });
    expect(res.statusCode, 'shed, and retryable — the scan is what is being priced').toBe(503);
  });

  it('serves that same paginated search once there is headroom', { timeout: 20_000 }, async () => {
    const { t, projectId } = await setup('list-paged-q-ok@e2e.test');
    await seedBulk(t, projectId);
    _setMemoryBudgetForTest(8192 * MB, 0);
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/content/page?limit=1&q=p1`,
      cookies: { sw_session: t },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { items: unknown[] }).items.length).toBe(1);
  });
});

describe('a small instance can still import media', () => {
  /**
   * Reserving the 200MB CAP made large import impossible below roughly a 700MB container.
   *
   * Measured on a real 512MB slot: ~180MB spendable, so a 200MB reservation never fit and EVERY
   * video URL import was refused — a 2MB one included — with `too many large imports in progress`,
   * which was false (nothing was in progress) and told the caller to wait for contention that would
   * never clear. The reservation is now the smaller of the cap and the instance's real headroom.
   */
  it('does not refuse a video import just because the CAP would not fit', async () => {
    const { t, projectId } = await setup('smallimport@e2e.test');
    // The numbers matter: spendable is 80% of the limit, so 512MB with 280MB used leaves ~130MB
    // free — enough for a real video, but LESS than the 200MB cap the old code insisted on
    // reserving. Pick used < 210MB here and the old reservation still fits, and the test proves
    // nothing.
    _setMemoryBudgetForTest(512 * MB, 280 * MB);
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/import-url`,
      cookies: { sw_session: t },
      payload: { url: 'https://this-host-does-not-exist-e2e.invalid/clip.mp4' },
    });
    // It must get PAST admission and fail on the fetch (a 4xx), not be shed before trying.
    expect(res.statusCode, 'admission must not block an import the instance could afford').toBeLessThan(500);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('still sheds when the instance cannot afford even the minimum', async () => {
    const { t, projectId } = await setup('nomemimport@e2e.test');
    _setMemoryBudgetForTest(512 * MB, 510 * MB);
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/media/import-url`,
      cookies: { sw_session: t },
      payload: { url: 'https://this-host-does-not-exist-e2e.invalid/clip.mp4' },
    });
    expect(res.statusCode, 'genuinely out of memory is still a shed').toBe(503);
    // And it names MEMORY, not phantom contention — the caller must not be sent to wait on a queue
    // that is empty.
    expect(String(res.json().error), 'the shed must not blame contention').not.toMatch(/too many large imports/i);
    expect(String(res.json().error)).toMatch(/memory/i);
  });
});

/**
 * What a shed caller is TOLD.
 *
 * Measured on a live 768MB instance: a bulk import drove it to 98% of its cgroup, every encode then
 * 503'd for the life of the process, and each response promised "retry shortly" while carrying no
 * `Retry-After` at all — the only headers were `x-ratelimit-*`, describing a limiter that was not the
 * one refusing and still had 19 requests available. A correct client retries that forever.
 */
describe('a shed request carries a usable retry signal', () => {
  it('sets Retry-After on the ledger 503', async () => {
    const { t, projectId } = await setup();
    _setMemoryBudgetForTest(1024 * MB, 1020 * MB);
    const res = await imageUpload(projectId, t);
    expect(res.statusCode).toBe(503);
    const after = Number(res.headers['retry-after']);
    expect(Number.isFinite(after), 'a 503 with no Retry-After is an invitation to hot-loop').toBe(true);
    expect(after).toBeGreaterThan(0);
  }, 20_000);

  it('stops calling the condition transient once it has been unbroken for a minute', async () => {
    const { t, projectId } = await setup();
    _setMemoryBudgetForTest(1024 * MB, 1020 * MB);

    const first = await imageUpload(projectId, t);
    expect(first.statusCode).toBe(503);
    expect(String(first.json().error), 'the first refusal really may be a spike').toMatch(/transient/i);

    // Pretend the run of refusals started over a minute ago. Time is the only input that decides
    // this, so moving it is the whole test — no sleeping.
    const { _setAdmissionFailingSinceForTest } = await import('../src/http/app.js');
    _setAdmissionFailingSinceForTest(Date.now() - 61_000);

    const later = await imageUpload(projectId, t);
    expect(later.statusCode).toBe(503);
    expect(String(later.json().error), 'sustained refusal must not keep promising transience').not.toMatch(/transient/i);
    expect(Number(later.headers['retry-after'])).toBeGreaterThan(Number(first.headers['retry-after']));
  }, 30_000);

  it('reports headroom on /health so a stuck instance is visible from outside', async () => {
    _setMemoryBudgetForTest(1024 * MB, 100 * MB);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; memory?: { limitMB: number; availableMB: number; admissionFailingForMs: number } };
    expect(body.ok, 'existing probes must keep working').toBe(true);
    expect(body.memory?.limitMB).toBe(1024);
    expect(body.memory?.availableMB).toBeGreaterThan(0);
    expect(typeof body.memory?.admissionFailingForMs).toBe('number');
  });
});
