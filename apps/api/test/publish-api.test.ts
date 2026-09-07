import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let publishRoot: string;

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-sites-'));
  db = await makeTestDb();
  app = await createApp({ db, publishRoot });
  await app.ready();
});
afterEach(async () => {
  await rm(publishRoot, { recursive: true, force: true });
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function setup(email: string, slug = 'site') {
  // Project creation is agency-staff-only now; seed the creator as `developer` (agency staff). The
  // register route is invite-only, so seed via the repo, then log in for a session cookie.
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({ method: 'POST', url: `/projects`, cookies: { sw_session: t }, payload: { name: 'Site', slug } });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, projectId, slug };
}

const homePage = {
  id: 'home',
  path: '',
  title: 'Home',
  root: { id: 'r', type: 'Section', children: [{ id: 'h', type: 'Heading', props: { text: 'Live Site' } }] },
};

describe('publish API', () => {
  it('reports the publish dirty signal (content changed since the last release)', async () => {
    const { t, projectId } = await setup('dirty@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    const statusDirty = async () =>
      (await app.inject({ method: 'GET', url: `${base}/publish`, cookies })).json() as { dirty: boolean };

    // Content exists but was never published → dirty.
    await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies, payload: homePage });
    expect((await statusDirty()).dirty).toBe(true);

    // Publishing clears it (the POST response + the status both report clean).
    const pub = await app.inject({ method: 'POST', url: `${base}/publish`, cookies });
    expect((pub.json() as { dirty: boolean }).dirty).toBe(false);
    expect((await statusDirty()).dirty).toBe(false);

    // A later content edit makes it dirty again…
    await app.inject({
      method: 'PUT',
      url: `${base}/content/page/home`,
      cookies,
      payload: { ...homePage, title: 'Home (edited)' },
    });
    expect((await statusDirty()).dirty).toBe(true);

    // …and re-publishing clears it once more.
    await app.inject({ method: 'POST', url: `${base}/publish`, cookies });
    expect((await statusDirty()).dirty).toBe(false);
  });

  it('★ DELETING a page makes the site dirty — a maximum over surviving rows cannot see a delete', async () => {
    // The signal was `max(content.updated_at) > release.published_at`. A delete REMOVES the row, so
    // the maximum stays wherever it was and the site read CLEAN with the deleted page still being
    // served — measured on a live instance before this fix. `previewContentVersion` already counted
    // rows for exactly this reason; the publish signal records the deletion time instead.
    const { t, projectId } = await setup('deldirty@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    const statusDirty = async () =>
      (await app.inject({ method: 'GET', url: `${base}/publish`, cookies })).json() as { dirty: boolean };

    await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies, payload: homePage });
    await app.inject({
      method: 'PUT',
      url: `${base}/content/page/about`,
      cookies,
      payload: { ...homePage, id: 'about', path: 'about', title: 'About' },
    });
    await app.inject({ method: 'POST', url: `${base}/publish`, cookies });
    expect((await statusDirty()).dirty).toBe(false);

    // Remove a page. Nothing was UPDATED, so the old signal saw nothing at all.
    const del = await app.inject({ method: 'DELETE', url: `${base}/content/page/about`, cookies });
    expect(del.statusCode).toBe(204);
    expect((await statusDirty()).dirty).toBe(true);

    // Publishing clears it again, so the marker cannot latch the site dirty forever.
    await app.inject({ method: 'POST', url: `${base}/publish`, cookies });
    expect((await statusDirty()).dirty).toBe(false);
  });

  it('deleting a NON-publishable kind leaves the site clean', async () => {
    // A deploy target is a credential, not something a visitor can see. Marking the site dirty for it
    // would be a claim the author cannot clear except by publishing something that did not change.
    //
    // Its routes only exist when the instance has an encryption key (credentials are encrypted at
    // rest), so this test needs its own app — the shared one is built without one.
    await app.close();
    app = await createApp({ db, publishRoot, encryptionKey: randomBytes(32) });
    await app.ready();
    const { t, projectId } = await setup('deltarget@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    const statusDirty = async () =>
      (await app.inject({ method: 'GET', url: `${base}/publish`, cookies })).json() as { dirty: boolean };

    await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies, payload: homePage });
    const made = await app.inject({
      method: 'POST',
      url: `${base}/deploy-targets`,
      cookies,
      payload: { name: 'Local Hosting', protocol: 'local' },
    });
    expect(made.statusCode).toBeLessThan(300);
    const targetId = (made.json() as { target: { id: string } }).target.id;
    await app.inject({ method: 'POST', url: `${base}/publish`, cookies });
    expect((await statusDirty()).dirty).toBe(false);

    await app.inject({ method: 'DELETE', url: `${base}/deploy-targets/${targetId}`, cookies });
    expect((await statusDirty()).dirty).toBe(false);
  });

  it('★ publishing STAMPS the local deploy target — otherwise its dot never clears', async () => {
    // For a Local Hosting target, POST /publish IS the deploy: there is no separate upload step. But
    // only the remote deploy path recorded `lastDeployedAt`, so a local target kept a null timestamp
    // forever — and the editor reads "never deployed" as "there is certainly something to send". Every
    // locally-hosted project therefore showed "changes to deploy" permanently, seconds after publishing.
    // Reproduced on the live :2003 instance, where all four client sites are locally hosted.
    await app.close();
    app = await createApp({ db, publishRoot, encryptionKey: randomBytes(32) });
    await app.ready();
    const { t, projectId } = await setup('localstamp@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };

    await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies, payload: homePage });
    const made = await app.inject({
      method: 'POST',
      url: `${base}/deploy-targets`,
      cookies,
      payload: { name: 'Local Hosting', protocol: 'local' },
    });
    expect(made.statusCode).toBeLessThan(300);
    const targetId = (made.json() as { target: { id: string } }).target.id;

    const targetNow = async () => {
      const res = await app.inject({ method: 'GET', url: `${base}/deploy-targets`, cookies });
      const items = (res.json() as { items: Array<{ id: string; lastDeployedAt?: string | null }> }).items;
      return items.find((x) => x.id === targetId)!;
    };
    expect((await targetNow()).lastDeployedAt ?? null).toBeNull(); // never deployed yet

    await app.inject({ method: 'POST', url: `${base}/publish`, cookies });
    const after = (await targetNow()).lastDeployedAt ?? null;
    expect(after, 'a local publish must record itself on the target').not.toBeNull();
    expect(Date.parse(after!)).toBeGreaterThan(0);
  });

  it('exports the published site as a zip (409 before publishing)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };

    const early = await app.inject({ method: 'GET', url: `${base}/publish/archive`, cookies });
    expect(early.statusCode).toBe(409);

    await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies, payload: homePage });
    await app.inject({ method: 'POST', url: `${base}/publish`, cookies });

    const zip = await app.inject({ method: 'GET', url: `${base}/publish/archive`, cookies });
    expect(zip.statusCode).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(zip.headers['content-disposition']).toContain('.zip');
    // PK zip magic bytes.
    expect(zip.rawPayload[0]).toBe(0x50);
    expect(zip.rawPayload[1]).toBe(0x4b);
  });

  it('validates deploy config and builds fresh at deploy time (no prior publish required)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies, payload: homePage });

    // An unknown protocol is rejected by config validation, before any build/connection → 400.
    const bad = await app.inject({
      method: 'POST',
      url: `${base}/publish/deploy`,
      cookies,
      payload: { protocol: 'telnet', host: 'h', user: 'u', password: 'p' },
    });
    expect(bad.statusCode).toBe(400);

    // A valid config WITHOUT a prior publish: the route now BUILDS fresh then attempts the connection
    // (build-at-deploy-time). A bogus host can't connect → 502 (the old "publish first" 409 is gone).
    const fresh = await app.inject({
      method: 'POST',
      url: `${base}/publish/deploy`,
      cookies,
      payload: { protocol: 'ftp', host: 'nonexistent.invalid', user: 'u', password: 'p' },
    });
    expect(fresh.statusCode).toBe(502);
  });

  it('forbids exporting another tenant’s archive', async () => {
    const a = await setup('a@acme.test', 'site-a');
    const b = await setup('b@globex.test', 'site-b');
    const res = await app.inject({
      method: 'GET',
      url: `/projects/${a.projectId}/publish/archive`,
      cookies: { sw_session: b.t },
    });
    expect(res.statusCode).toBe(403);
  });

  it('forbids deploying another tenant’s project', async () => {
    const a = await setup('a@acme.test', 'site-a');
    const b = await setup('b@globex.test', 'site-b');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${a.projectId}/publish/deploy`,
      cookies: { sw_session: b.t },
      payload: { protocol: 'ftp', host: 'h', user: 'u', password: 'p' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('requires authentication and tenant membership', async () => {
    const a = await setup('a@acme.test', 'site-a');
    const b = await setup('b@globex.test', 'site-b');

    const unauth = await app.inject({ method: 'POST', url: `/projects/${a.projectId}/publish` });
    expect(unauth.statusCode).toBe(401);

    const crossTenant = await app.inject({
      method: 'POST',
      url: `/projects/${a.projectId}/publish`,
      cookies: { sw_session: b.t },
    });
    expect(crossTenant.statusCode).toBe(403);
  });

  it('404s for an unpublished site and rejects path traversal in the serve route', async () => {
    const { slug } = await setup('a@acme.test');
    const notPublished = await app.inject({ method: 'GET', url: `/sites/${slug}/` });
    expect(notPublished.statusCode).toBe(404);

    // A traversal attempt resolves outside the site dir → 404 (never escapes).
    const traversal = await app.inject({ method: 'GET', url: `/sites/${slug}/..%2f..%2frelease` });
    expect([404]).toContain(traversal.statusCode);
  });
});
