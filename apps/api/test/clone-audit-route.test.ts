import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

// Mock ONLY the browser-driving captures so the route's own composition runs without a real Chromium
// (scoreFidelity + the pure structural/behavioural scorers stay real, and are covered directly too).
vi.mock('../src/render/compare.js', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    captureUrlElements: vi.fn(async () => ({ items: [], meta: { modalTriggers: 0 } })),
    captureBehaviour: vi.fn(async () => ({ carousels: 1, carouselsEnhanced: 1, dialogs: 0, headingFont: 'primary-font', bodyFont: 'text-font', headingFontLoaded: true, bodyFontLoaded: true, navExpected: 0, navReachableMobile: 0, hasModalTrigger: false })),
  };
});

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let previewRoot: string;
beforeEach(async () => {
  previewRoot = await mkdtemp(join(tmpdir(), 'sw-ca-'));
  db = await makeTestDb();
  app = await createApp({ db, previewRoot, cookieSecret: 'ca-test-secret' });
  await app.ready();
});
afterEach(async () => {
  await rm(previewRoot, { recursive: true, force: true });
});

function tok(r: { cookies: Array<{ name: string; value: string }> }): string {
  const t = r.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
async function setup() {
  await registerAccount(db, 'd@a.test', 'Pw-secret-1', { platformRole: 'developer' });
  const t = tok(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'd@a.test', password: 'Pw-secret-1' } }));
  const pid = ((await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'C', slug: 'ca' } })).json() as { project: { id: string } }).project.id;
  return { t, pid };
}
const putPage = (pid: string, t: string, page: object) =>
  app.inject({ method: 'PUT', url: `/projects/${pid}/content/page/${(page as { id: string }).id}`, cookies: { sw_session: t }, payload: page });

describe('GET /projects/:id/clone-audit/:pageId', () => {
  it('404s for a missing page', async () => {
    const { t, pid } = await setup();
    expect((await app.inject({ method: 'GET', url: `/projects/${pid}/clone-audit/nope`, cookies: { sw_session: t } })).statusCode).toBe(404);
  });

  it('400s when the page has no import source', async () => {
    const { t, pid } = await setup();
    await putPage(pid, t, { id: 'home', path: '', title: 'Home', source: '<h1>Hi</h1>' });
    expect((await app.inject({ method: 'GET', url: `/projects/${pid}/clone-audit/home`, cookies: { sw_session: t } })).statusCode).toBe(400);
  });

  it('returns the three-leg audit for an imported page', async () => {
    const { t, pid } = await setup();
    await putPage(pid, t, { id: 'home', path: '', title: 'Home', source: '<div>plain</div>', data: { swImport: { sourceUrl: 'https://orig.test/', rewritten: false } } });
    const r = await app.inject({ method: 'GET', url: `/projects/${pid}/clone-audit/home`, cookies: { sw_session: t } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { pass: boolean; checks: Array<{ leg: string; id: string; pass: boolean }>; fidelity: unknown };
    expect(body.checks.length).toBeGreaterThan(0);
    expect(body.checks.some((c) => c.leg === 'structure')).toBe(true);
    expect(body.checks.some((c) => c.leg === 'behaviour')).toBe(true);
    expect(body.checks.some((c) => c.leg === 'visual')).toBe(true);
    // the plain <div> source has no data-sw-* → the editable structural check fails → audit is RED
    expect(body.checks.find((c) => c.id === 'editable')!.pass).toBe(false);
    expect(body.pass).toBe(false);
    expect(body.fidelity).toBeTruthy();
  });
});
