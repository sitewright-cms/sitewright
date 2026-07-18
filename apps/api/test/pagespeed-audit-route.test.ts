import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createApp } from '../src/http/app.js';
import { seedInstance } from '../src/seed.js';
import { makeTestDb } from './helpers.js';

/**
 * Exercises the full `GET /projects/:id/pagespeed-audit/:pageId` route against the seeded flagship. When a
 * headless browser is available it runs a real Lighthouse audit and asserts real category scores; in a
 * browserless environment the route degrades to a clean 503 (never an opaque 500). Either way the route
 * body — build → serve → audit → teardown — is covered. Mirrors the preview screenshot test's pattern.
 */

const ADMIN_EMAIL = 'admin@example.test';
const ADMIN_PASSWORD = 'Pw-secret-1';

let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'lh-route-'));
  const db = await makeTestDb();
  await seedInstance({ db, adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD, mediaRoot: join(base, 'media') });
  app = await createApp({
    db,
    encryptionKey: Buffer.alloc(32, 7),
    maintenanceSweepMs: 0,
    mediaRoot: join(base, 'media'),
    publishRoot: join(base, 'sites'),
    // The audit routes register only when the preview subsystem is enabled (previewSiteStore); set it.
    previewRoot: join(base, 'preview'),
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
});

async function adminClient() {
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  expect(login.statusCode, login.body).toBe(200);
  const cookie = login.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!cookie) throw new Error('no session cookie');
  const auth = (opts: InjectOptions) => app.inject({ ...opts, cookies: { ...(opts.cookies ?? {}), sw_session: cookie } });
  const list = await auth({ method: 'GET', url: '/projects' });
  const parsed = list.json() as { projects?: Array<{ id: string; slug: string }> } | Array<{ id: string; slug: string }>;
  const projects = Array.isArray(parsed) ? parsed : (parsed.projects ?? []);
  const example = projects.find((p) => p.slug === 'example');
  if (!example) throw new Error('no example project');
  return { auth, projectId: example.id };
}

test('audits a real page — real scores when a browser is present, else a clean 503', async () => {
  const { auth, projectId } = await adminClient();
  const pages = (await auth({ method: 'GET', url: `/projects/${projectId}/content/page` })).json() as {
    items: Array<{ id: string; kind?: string; collection?: unknown }>;
  };
  const home = pages.items.find((p) => p.kind !== 'link' && !p.collection);
  expect(home, 'a rendered page to audit').toBeTruthy();

  const res = await auth({ method: 'GET', url: `/projects/${projectId}/pagespeed-audit/${home!.id}?formFactor=mobile` });
  expect([200, 503], `unexpected ${res.statusCode}: ${res.body}`).toContain(res.statusCode);

  if (res.statusCode === 200) {
    const r = res.json() as {
      formFactor: string;
      scores: Record<string, number | null>;
      findings: unknown[];
      lighthouseVersion: string;
    };
    expect(r.formFactor).toBe('mobile');
    for (const key of ['performance', 'accessibility', 'bestPractices', 'seo']) {
      expect(typeof r.scores[key], `${key} score`).toBe('number');
    }
    expect(Array.isArray(r.findings)).toBe(true);
    expect(typeof r.lighthouseVersion).toBe('string');
    console.info(`pagespeed(example/home, mobile): perf=${r.scores.performance} a11y=${r.scores.accessibility} bp=${r.scores.bestPractices} seo=${r.scores.seo}`);
  } else {
    expect((res.json() as { error: string }).error).toMatch(/browser/i);
  }
}, 240_000);

test('404s an unknown page id', async () => {
  const { auth, projectId } = await adminClient();
  const res = await auth({ method: 'GET', url: `/projects/${projectId}/pagespeed-audit/does-not-exist` });
  expect(res.statusCode).toBe(404);
});
