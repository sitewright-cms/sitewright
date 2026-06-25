import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;

beforeEach(async () => {
  db = await makeTestDb();
  app = await createApp({ db });
  await app.ready();
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function setup(email: string) {
  // Project creation is agency-staff-only now; seed the creator as `developer` (agency staff). The
  // register route is invite-only, so seed via the repo, then log in for a session cookie.
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug: 'site' } });
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id };
}

const putPage = (app: FastifyInstance, t: string, pid: string, source: string) =>
  app.inject({ method: 'PUT', url: `/projects/${pid}/content/page/home`, cookies: { sw_session: t }, payload: { id: 'home', path: '', title: 'Home', source } });
const getJson = (app: FastifyInstance, t: string, pid: string, kind: string, id: string) =>
  app.inject({ method: 'GET', url: `/projects/${pid}/content/${kind}/${id}`, cookies: { sw_session: t } });

describe('Widget provisioning on page save', () => {
  it('saving a page that composes {{> hero-slider}} provisions the hero dataset + seed entry', async () => {
    const { t, projectId } = await setup('w1@acme.test');
    expect((await putPage(app, t, projectId, '<section>{{> hero-slider}}</section>')).statusCode).toBe(200);

    const ds = await getJson(app, t, projectId, 'dataset', 'hero');
    expect(ds.statusCode).toBe(200);
    const fields = (ds.json() as { item: { fields: Array<{ name: string; type: string }> } }).item.fields;
    expect(fields.find((f) => f.name === 'slides')?.type).toBe('list');

    const entry = await getJson(app, t, projectId, 'entry', 'config');
    expect(entry.statusCode).toBe(200);
    expect(Array.isArray((entry.json() as { item: { values: { slides: unknown } } }).item.values.slides)).toBe(true);
  });

  it('does NOT provision when the page composes no Widget', async () => {
    const { t, projectId } = await setup('w2@acme.test');
    await putPage(app, t, projectId, '<section><h1>Plain page</h1></section>');
    expect((await getJson(app, t, projectId, 'dataset', 'hero')).statusCode).toBe(404);
  });

  it('is idempotent and never overwrites a user-edited entry on re-save', async () => {
    const { t, projectId } = await setup('w3@acme.test');
    await putPage(app, t, projectId, '<section>{{> hero-slider}}</section>');
    // User edits the provisioned config (turn autoplay off).
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/entry/config`,
      cookies: { sw_session: t },
      payload: { id: 'config', dataset: 'hero', status: 'published', values: { autoplay: false, slides: [{ image: '/x.jpg', caption: 'Edited' }] } },
    });
    // Re-save the page → provisioning must NOT clobber the edit.
    expect((await putPage(app, t, projectId, '<section>{{> hero-slider}}</section>')).statusCode).toBe(200);
    const entry = (await getJson(app, t, projectId, 'entry', 'config')).json() as { item: { values: { autoplay: boolean; slides: Array<{ caption: string }> } } };
    expect(entry.item.values.autoplay).toBe(false);
    expect(entry.item.values.slides[0]?.caption).toBe('Edited');
  });
});
