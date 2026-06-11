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

/** Register a user + create a project (seeds settings + a home page). */
async function setup(email = 'owner@i18n.test', slug = 'site') {
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'Pw-secret-1' } });
  const t = token(reg);
  const proj = await app.inject({
    method: 'POST',
    url: '/projects',
    cookies: { sw_session: t },
    payload: { name: 'Site', slug },
  });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, projectId };
}

async function putPage(t: string, projectId: string, page: Record<string, unknown>) {
  return app.inject({
    method: 'PUT',
    url: `/projects/${projectId}/content/page/${page.id as string}`,
    cookies: { sw_session: t },
    payload: page,
  });
}

async function listPages(t: string, projectId: string): Promise<Record<string, unknown>[]> {
  const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/content/page`, cookies: { sw_session: t } });
  return (res.json() as { items: Record<string, unknown>[] }).items;
}

async function getLocales(t: string, projectId: string): Promise<string[]> {
  const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/content/settings/settings`, cookies: { sw_session: t } });
  return (res.json() as { item: { settings: { locales: string[] } } }).item.settings.locales;
}

describe('locale management API', () => {
  it('POST /locales scaffolds an inherit-mode variant of every default page under /<locale>', async () => {
    const { t, projectId } = await setup();
    await putPage(t, projectId, {
      id: 'about', path: 'about', parent: 'home', title: 'About',
      root: { id: 'r', type: 'Section' }, source: '<h1 data-sw-text="h">x</h1>', data: { h: 'About' },
    });

    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/locales`, cookies: { sw_session: t }, payload: { locale: 'de' } });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { created: number }).created).toBe(2); // home + about

    const pages = await listPages(t, projectId);
    const homeDe = pages.find((p) => p.id === 'home-de')!;
    const aboutDe = pages.find((p) => p.id === 'about-de')!;
    expect(homeDe).toMatchObject({ path: 'de', parent: 'home', locale: 'de', translationGroup: 'home' });
    expect(aboutDe).toMatchObject({ path: 'about', parent: 'home-de', locale: 'de', translationGroup: 'about' });
    // Inherit mode: no own code; data copied from the owner.
    expect(homeDe.source).toBeUndefined();
    expect(homeDe.template).toBeUndefined();
    expect(aboutDe.data).toEqual({ h: 'About' });
    // The owners are now linked into their groups.
    expect(pages.find((p) => p.id === 'about')!.translationGroup).toBe('about');
    expect(await getLocales(t, projectId)).toEqual(['en', 'de']);
  });

  it('rejects adding the default locale or a locale that already exists', async () => {
    const { t, projectId } = await setup();
    const en = await app.inject({ method: 'POST', url: `/projects/${projectId}/locales`, cookies: { sw_session: t }, payload: { locale: 'en' } });
    expect(en.statusCode).toBe(409);
    await app.inject({ method: 'POST', url: `/projects/${projectId}/locales`, cookies: { sw_session: t }, payload: { locale: 'de' } });
    const dup = await app.inject({ method: 'POST', url: `/projects/${projectId}/locales`, cookies: { sw_session: t }, payload: { locale: 'de' } });
    expect(dup.statusCode).toBe(409);
  });

  it('DELETE /locales/:locale cascade-deletes that language and updates settings', async () => {
    const { t, projectId } = await setup();
    await putPage(t, projectId, { id: 'about', path: 'about', parent: 'home', title: 'About', root: { id: 'r', type: 'Section' }, source: '<p>x</p>' });
    await app.inject({ method: 'POST', url: `/projects/${projectId}/locales`, cookies: { sw_session: t }, payload: { locale: 'de' } });

    const del = await app.inject({ method: 'DELETE', url: `/projects/${projectId}/locales/de`, cookies: { sw_session: t } });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { removed: number }).removed).toBe(2);

    const ids = (await listPages(t, projectId)).map((p) => p.id).sort();
    expect(ids).toEqual(['about', 'home']);
    expect(await getLocales(t, projectId)).toEqual(['en']);
  });

  it('refuses to remove the default locale and 404s an unconfigured one', async () => {
    const { t, projectId } = await setup();
    const def = await app.inject({ method: 'DELETE', url: `/projects/${projectId}/locales/en`, cookies: { sw_session: t } });
    expect(def.statusCode).toBe(400);
    const missing = await app.inject({ method: 'DELETE', url: `/projects/${projectId}/locales/zz`, cookies: { sw_session: t } });
    expect(missing.statusCode).toBe(404);
  });

  it('POST /pages/:id/translate propagates a default page into all languages', async () => {
    const { t, projectId } = await setup();
    // Two translation targets (home variants exist after each add).
    await app.inject({ method: 'POST', url: `/projects/${projectId}/locales`, cookies: { sw_session: t }, payload: { locale: 'de' } });
    await app.inject({ method: 'POST', url: `/projects/${projectId}/locales`, cookies: { sw_session: t }, payload: { locale: 'fr' } });
    await putPage(t, projectId, { id: 'pricing', path: 'pricing', parent: 'home', title: 'Pricing', root: { id: 'r', type: 'Section' }, source: '<p>$</p>' });

    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/pages/pricing/translate`, cookies: { sw_session: t }, payload: {} });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { created: number }).created).toBe(2);

    const pages = await listPages(t, projectId);
    expect(pages.find((p) => p.id === 'pricing-de')).toMatchObject({ parent: 'home-de', locale: 'de', translationGroup: 'pricing' });
    expect(pages.find((p) => p.id === 'pricing-fr')).toMatchObject({ parent: 'home-fr', locale: 'fr', translationGroup: 'pricing' });
    expect(pages.find((p) => p.id === 'pricing-de')!.source).toBeUndefined();

    // A non-default page cannot be propagated.
    const bad = await app.inject({ method: 'POST', url: `/projects/${projectId}/pages/pricing-de/translate`, cookies: { sw_session: t }, payload: {} });
    expect(bad.statusCode).toBe(400);
  });

  it('POST /pages/:id/delete-group cascades inherit variants but keeps forked/template ones', async () => {
    const { t, projectId } = await setup();
    await putPage(t, projectId, { id: 'about', path: 'about', parent: 'home', title: 'About', root: { id: 'r', type: 'Section' }, source: '<p>x</p>' });
    await app.inject({ method: 'POST', url: `/projects/${projectId}/locales`, cookies: { sw_session: t }, payload: { locale: 'de' } }); // about-de (inherit)
    await app.inject({ method: 'POST', url: `/projects/${projectId}/locales`, cookies: { sw_session: t }, payload: { locale: 'fr' } }); // about-fr (inherit)
    // Fork the French variant → it carries its OWN source now.
    await putPage(t, projectId, { id: 'about-fr', path: 'about', parent: 'home-fr', title: 'À propos', locale: 'fr', translationGroup: 'about', root: { id: 'r', type: 'Section' }, source: '<p>fr</p>' });

    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/pages/about/delete-group`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { removed: string[]; kept: string[] };
    expect(body.removed.sort()).toEqual(['about', 'about-de']);
    expect(body.kept).toEqual(['about-fr']);

    const pages = await listPages(t, projectId);
    const ids = pages.map((p) => p.id);
    expect(ids).toContain('about-fr'); // forked variant survived
    expect(ids).not.toContain('about'); // owner gone
    expect(ids).not.toContain('about-de'); // inherit variant gone
    // The survivor is DETACHED — its translationGroup (pointing at the deleted owner) is dropped.
    expect((pages.find((p) => p.id === 'about-fr') as { translationGroup?: string }).translationGroup).toBeUndefined();

    // The home page cannot be group-deleted.
    const home = await app.inject({ method: 'POST', url: `/projects/${projectId}/pages/home/delete-group`, cookies: { sw_session: t } });
    expect(home.statusCode).toBe(400);
  });

  it('delete-group refuses a non-default-language page as the target', async () => {
    const { t, projectId } = await setup();
    await putPage(t, projectId, { id: 'about', path: 'about', parent: 'home', title: 'About', root: { id: 'r', type: 'Section' }, source: '<p>x</p>' });
    await app.inject({ method: 'POST', url: `/projects/${projectId}/locales`, cookies: { sw_session: t }, payload: { locale: 'de' } });

    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/pages/about-de/delete-group`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(400); // about-de is a variant, not the main-language owner
    // Nothing was deleted.
    expect((await listPages(t, projectId)).map((p) => p.id)).toContain('about-de');
  });
});
