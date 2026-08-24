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

async function setup(): Promise<{ t: string; base: string }> {
  await registerAccount(db, 'owner@acme.test', 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@acme.test', password: 'Pw-secret-1' } }));
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug: 'site' } });
  return { t, base: `/projects/${(proj.json() as { project: { id: string } }).project.id}` };
}

/**
 * The MCP tools reach the API through `app.inject` against these very routes (see mcp-routes.ts), so a
 * route that cannot mint a parentless page is a fleet of agents that cannot mint one either.
 */
describe('the write ROUTE cannot produce a parentless page', () => {
  it('fills the parent on a page created without one', async () => {
    const { t, base } = await setup();
    const res = await app.inject({
      method: 'PUT',
      url: `${base}/content/page/about`,
      cookies: { sw_session: t },
      payload: { id: 'about', path: 'about', title: 'About' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { item: { parent?: string } }).item.parent).toBe('home');
  });

  it('keeps a nested page nested through a full replace that omits the parent', async () => {
    const { t, base } = await setup();
    const put = (id: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PUT', url: `${base}/content/page/${id}`, cookies: { sw_session: t }, payload });

    await put('services', { id: 'services', path: 'services', title: 'Services' });
    await put('web', { id: 'web', path: 'web-design', title: 'Web Design', parent: 'services' });
    // The hazard: a total replace (the documented put_page semantic) omitting `parent` would have
    // dropped this page to the root and moved /services/web-design to /web-design.
    const res = await put('web', { id: 'web', path: 'web-design', title: 'Web Design Renamed' });
    expect((res.json() as { item: { parent?: string } }).item.parent).toBe('services');
  });

  it('leaves the home page at the root', async () => {
    const { t, base } = await setup();
    const res = await app.inject({ method: 'GET', url: `${base}/content/page/home`, cookies: { sw_session: t } });
    expect((res.json() as { item: { parent?: string } }).item.parent).toBeUndefined();
  });
});

/**
 * `patch_page({id, parent: null})` is the documented way to un-nest a page. `?merge=1` DELETES a
 * null-valued key, so the merged body looks exactly like a full write that omitted the field — and the
 * carry-the-stored-parent rule would turn the un-nest into a silent no-op.
 */
describe('clearing the parent through a merge patch', () => {
  it('returns a nested page to its home rather than silently keeping the old parent', async () => {
    const { t, base } = await setup();
    const put = (id: string, payload: Record<string, unknown>, q = '') =>
      app.inject({ method: 'PUT', url: `${base}/content/page/${id}${q}`, cookies: { sw_session: t }, payload });

    await put('services', { id: 'services', path: 'services', title: 'Services' });
    await put('web', { id: 'web', path: 'web-design', title: 'Web Design', parent: 'services' });

    const res = await put('web', { id: 'web', parent: null }, '?merge=1');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { item: { parent?: string } }).item.parent).toBe('home');
  });

  it('leaves an untouched parent alone when the patch is about something else', async () => {
    const { t, base } = await setup();
    const put = (id: string, payload: Record<string, unknown>, q = '') =>
      app.inject({ method: 'PUT', url: `${base}/content/page/${id}${q}`, cookies: { sw_session: t }, payload });

    await put('services', { id: 'services', path: 'services', title: 'Services' });
    await put('web', { id: 'web', path: 'web-design', title: 'Web Design', parent: 'services' });

    const res = await put('web', { id: 'web', title: 'Renamed' }, '?merge=1');
    expect((res.json() as { item: { parent?: string; title: string } }).item).toMatchObject({ parent: 'services', title: 'Renamed' });
  });
});
