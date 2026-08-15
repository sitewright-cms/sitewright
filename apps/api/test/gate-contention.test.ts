import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers.js';
import { createApp, _setMemoryBudgetForTest, _optimizeGateAdmittedForTest } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

/**
 * The optimize gate, through the REAL routes.
 *
 * `fair-gate.test.ts` proves the scheduling logic in isolation; these prove it is actually wired to
 * the paths it is supposed to protect, and — the part a unit test cannot reach — that a contended
 * gate still returns real HTTP responses instead of hanging, shedding, or 500ing.
 *
 * The gate is process-wide module state shared by every test in this file, which is the point: a
 * slot leaked by one request would show up as a later request hanging or being refused, so the last
 * assertion in each test (that a plain upload still works) is a leak detector.
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
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-gate-'));
  db = await makeTestDb();
  app = await createApp({ db, mediaRoot });
  await app.ready();
  _setMemoryBudgetForTest(8192 * MB, 0); // roomy: this file is about the GATE, not the ledger
});
afterEach(async () => {
  _setMemoryBudgetForTest(8192 * MB, 0);
  if (app) await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

/** A project with its own login, so two of them are genuinely separate tenants. */
async function makeProject(tag: string) {
  const email = `${tag}@gate.test`;
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
  const t = login.cookies.find((c) => c.name === 'sw_session')!.value;
  const proj = await app.inject({
    method: 'POST',
    url: '/projects',
    cookies: { sw_session: t },
    payload: { name: tag, slug: `${tag}${Date.now().toString(36)}` },
  });
  const body = proj.json() as { project: { id: string; slug: string } };
  return { t, projectId: body.project.id, slug: body.project.slug };
}

function imageUpload(projectId: string, t: string, name = 'a.png') {
  const boundary = '----swgate';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`,
    ),
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

describe('the optimize gate under contention', () => {
  it('serves a burst from ONE project without shedding or hanging', async () => {
    // Twelve at once is four times the concurrency limit: everything past the third must queue and
    // then be handed a slot. A dropped handoff shows up here as a test that never finishes.
    const a = await makeProject('solo');
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => imageUpload(a.projectId, a.t, `burst${i}.png`)),
    );
    expect(results.map((r) => r.statusCode).filter((c) => c !== 201), 'every queued encode completes').toEqual([]);
  }, 30_000);

  it('serves TWO projects competing for the same slots, and neither is starved', async () => {
    const [a, b] = await Promise.all([makeProject('tenanta'), makeProject('tenantb')]);
    // A bursts; B asks for a few in the middle of it. Both must come back 201.
    const aJobs = Array.from({ length: 10 }, (_, i) => imageUpload(a.projectId, a.t, `a${i}.png`));
    const bJobs = Array.from({ length: 3 }, (_, i) => imageUpload(b.projectId, b.t, `b${i}.png`));
    const [aRes, bRes] = await Promise.all([Promise.all(aJobs), Promise.all(bJobs)]);
    expect(aRes.every((r) => r.statusCode === 201), 'the busy project still completes').toBe(true);
    expect(bRes.every((r) => r.statusCode === 201), 'the neighbour is never refused for being small').toBe(true);
  }, 30_000);

  it('leaves the gate empty afterwards — a leaked slot would strand the next caller', async () => {
    const a = await makeProject('leakcheck');
    await Promise.all(Array.from({ length: 8 }, (_, i) => imageUpload(a.projectId, a.t, `x${i}.png`)));
    // If any of those eight failed to release, the gate is permanently down a slot. Nothing in the
    // response bodies would say so; only a later request notices.
    const after = await imageUpload(a.projectId, a.t, 'after.png');
    expect(after.statusCode, 'the gate came back to full capacity').toBe(201);
  }, 30_000);

  it('an UNKNOWN project slug never reaches the gate', async () => {
    // The tenant key on the public thumbnail route arrives as a URL segment, and the storage layer
    // only validates its charset. If an invented slug could reach the gate it would become a tenant:
    // one that has been served least, and is therefore scheduled FIRST. Worse, a slug is not secret —
    // it appears in every <img src> on that project's own public site — so an attacker could spend a
    // named victim's share. Unknown slugs must be refused before any of that state exists.
    await makeProject('realproj');
    // Asserting the 404 alone would prove nothing — a missing FILE also 404s, just after taking a
    // slot and a queue place under the invented tenant. The admission counter is the real evidence.
    const before = _optimizeGateAdmittedForTest();
    for (const slug of ['no-such-project', 'aaaa', 'x1', 'Z_-9']) {
      const res = await app.inject({ method: 'GET', url: `/media/${slug}/abcdefghijklmnop/x.png?size=lg` });
      expect(res.statusCode, `invented slug "${slug}" must 404, not be served or gated`).toBe(404);
    }
    expect(_optimizeGateAdmittedForTest() - before, 'not one of them was allowed into the gate').toBe(0);
  }, 30_000);

  it('serves a REAL project through the public thumbnail route', async () => {
    // The guard above must not have closed the route it protects: a genuine asset still renders.
    const a = await makeProject('thumbok');
    const up = await imageUpload(a.projectId, a.t, 'pic.png');
    expect(up.statusCode).toBe(201);
    const item = (up.json() as { item: { url: string } }).item;
    const res = await app.inject({ method: 'GET', url: `${item.url}?size=sm` });
    expect(res.statusCode, 'a real slug + real asset still serves a thumbnail').toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/(webp|avif)/);
  }, 30_000);

  it('a REFUSED request does not cost the project its capacity', async () => {
    // The lockout regression, at the HTTP layer. Starve the ledger so the encode is shed, restore it,
    // and the same project must be served again. The old per-tenant counter leaked on exactly this
    // path — the refusal skipped the release — and the project never recovered.
    const a = await makeProject('refused');
    _setMemoryBudgetForTest(1024 * MB, 1020 * MB);
    const shed = await imageUpload(a.projectId, a.t, 'shed.png');
    expect(shed.statusCode, 'shed as backpressure, not a server fault').toBe(503);

    _setMemoryBudgetForTest(8192 * MB, 0);
    const recovered = await imageUpload(a.projectId, a.t, 'recovered.png');
    expect(recovered.statusCode, 'a refusal must not lock the project out').toBe(201);
    // And repeatedly, because a leak of ONE per refusal takes a few rounds to become visible.
    for (let i = 0; i < 3; i++) {
      _setMemoryBudgetForTest(1024 * MB, 1020 * MB);
      expect((await imageUpload(a.projectId, a.t, `s${i}.png`)).statusCode).toBe(503);
      _setMemoryBudgetForTest(8192 * MB, 0);
      expect((await imageUpload(a.projectId, a.t, `r${i}.png`)).statusCode, `round ${i} still served`).toBe(201);
    }
  }, 60_000);
});
