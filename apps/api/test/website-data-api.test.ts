import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

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

async function setup(email = 'owner@wd.test', slug = 'site') {
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'Pw-secret-1' } });
  const t = token(reg);
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug } });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, projectId };
}

async function setWebsiteData(t: string, projectId: string, key: string, value: string) {
  return app.inject({ method: 'PUT', url: `/projects/${projectId}/website-data`, cookies: { sw_session: t }, payload: { key, value } });
}

async function getWebsiteData(t: string, projectId: string): Promise<Record<string, unknown> | undefined> {
  const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/content/settings/settings`, cookies: { sw_session: t } });
  return (res.json() as { item: { website?: { data?: Record<string, unknown> } } }).item.website?.data;
}

describe('website.data cell API', () => {
  it('PUT /website-data sets a leaf on website.data (server-side read-modify-write)', async () => {
    const { t, projectId } = await setup();
    const res = await setWebsiteData(t, projectId, 'footerImage', '/media/footer.png');
    expect(res.statusCode).toBe(200);
    await setWebsiteData(t, projectId, 'footerImage', '/media/footer-v2.png'); // overwrite
    await setWebsiteData(t, projectId, 'hero.bg', '/media/bg.jpg'); // nested path → creates the object
    expect(await getWebsiteData(t, projectId)).toEqual({ footerImage: '/media/footer-v2.png', hero: { bg: '/media/bg.jpg' } });
  });

  it('preserves other website.data keys across writes', async () => {
    const { t, projectId } = await setup();
    await setWebsiteData(t, projectId, 'a', '1');
    await setWebsiteData(t, projectId, 'b', '2');
    expect(await getWebsiteData(t, projectId)).toEqual({ a: '1', b: '2' });
  });

  it('rejects an invalid / prototype-polluting key path', async () => {
    const { t, projectId } = await setup();
    expect((await setWebsiteData(t, projectId, 'bad key!', 'x')).statusCode).toBe(400);
    expect((await setWebsiteData(t, projectId, '__proto__.x', 'x')).statusCode).toBe(400);
    expect((await setWebsiteData(t, projectId, '', 'x')).statusCode).toBe(400);
    expect(await getWebsiteData(t, projectId)).toBeUndefined(); // nothing written
  });
});
