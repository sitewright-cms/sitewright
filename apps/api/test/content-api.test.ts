import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { content, projectMembers } from '../src/db/schema.js';
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

async function setup(email: string, slug = 'site') {
  // Project creation is agency-staff-only now; seed the creator as `developer` (agency staff). The
  // register route is invite-only, so seed via the repo, then log in for a session cookie.
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({
    method: 'POST',
    url: `/projects`,
    cookies: { sw_session: t },
    payload: { name: 'Site', slug },
  });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, projectId };
}

const page = { id: 'home', path: '', title: 'Home' };

describe('content API', () => {
  it('a project member may write any content kind (constrained client-write removed)', async () => {
    const { t, projectId } = await setup('owner@acme.test');
    const base = `/projects/${projectId}`;
    const editablePage = {
      id: 'home',
      path: '',
      title: 'Home',
      source: '<h1 data-sw-text="headline">Welcome</h1>',
      data: { headline: 'Original' },
    };
    expect((await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies: { sw_session: t }, payload: editablePage })).statusCode).toBe(200);

    // A second user granted access to this project as a member.
    const { userId: memberUserId } = await registerAccount(db, 'client@acme.test', 'Pw-secret-1');
    const memberT = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'client@acme.test', password: 'Pw-secret-1' } }));
    await db.insert(projectMembers).values({ id: randomUUID(), userId: memberUserId, projectId, role: 'member', createdAt: new Date() });

    const edit = (mut: (p: typeof editablePage) => void) => {
      const next = JSON.parse(JSON.stringify(editablePage));
      mut(next);
      return app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies: { sw_session: memberT }, payload: next });
    };

    // A member may now write all of these — the old constrained-write gate is gone.
    expect((await edit((p) => { p.data.headline = 'Client wrote this'; })).statusCode).toBe(200);
    expect((await edit((p) => { p.data.headline = 'Member edit'; })).statusCode).toBe(200);
    expect((await edit((p) => { delete (p as Record<string, unknown>).data; })).statusCode).toBe(200);
  });

  it('rate-limits the content routes tighter than the global cap (writes 60, reads 120)', async () => {
    const { t, projectId } = await setup('rl@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    const put = await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies, payload: page });
    expect(put.statusCode).toBe(200);
    expect(Number(put.headers['x-ratelimit-limit'])).toBe(60);
    const del = await app.inject({ method: 'DELETE', url: `${base}/content/page/home`, cookies });
    expect(Number(del.headers['x-ratelimit-limit'])).toBe(60);
    const list = await app.inject({ method: 'GET', url: `${base}/content/page`, cookies });
    expect(Number(list.headers['x-ratelimit-limit'])).toBe(120);
    const get = await app.inject({ method: 'GET', url: `${base}/content/dataset/none`, cookies });
    expect(Number(get.headers['x-ratelimit-limit'])).toBe(120);
  });

  it('PUT → GET → list → export a page', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;

    const put = await app.inject({
      method: 'PUT',
      url: `${base}/content/page/home`,
      cookies: { sw_session: t },
      payload: page,
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({ method: 'GET', url: `${base}/content/page/home`, cookies: { sw_session: t } });
    expect((get.json() as { item: { title: string } }).item.title).toBe('Home');

    const list = await app.inject({ method: 'GET', url: `${base}/content/page`, cookies: { sw_session: t } });
    expect((list.json() as { items: unknown[] }).items).toHaveLength(1);

    const exp = await app.inject({ method: 'GET', url: `${base}/export`, cookies: { sw_session: t } });
    expect((exp.json() as { pages: unknown[] }).pages).toHaveLength(1);
  });

  it('rejects an invalid payload (400) and an unknown kind (404)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;

    // Missing required `path` field → Zod validation error → 400
    const bad = await app.inject({
      method: 'PUT',
      url: `${base}/content/page/home`,
      cookies: { sw_session: t },
      payload: { id: 'home', title: 'No path' },
    });
    expect(bad.statusCode).toBe(400);

    const unknown = await app.inject({
      method: 'GET',
      url: `${base}/content/widgets`,
      cookies: { sw_session: t },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('imports a bundle (200) and rejects an invalid one (409)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;

    const ok = await app.inject({
      method: 'POST',
      url: `${base}/import`,
      cookies: { sw_session: t },
      payload: { pages: [page] },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { imported: number }).imported).toBeGreaterThanOrEqual(1);

    const bad = await app.inject({
      method: 'POST',
      url: `${base}/import`,
      cookies: { sw_session: t },
      payload: {
        pages: [
          // Page references a collection dataset that doesn't exist → validateProject → 409
          { id: 'b', path: '[slug]', title: 'B', collection: { dataset: 'ghost', param: 'slug' } },
        ],
      },
    });
    expect(bad.statusCode).toBe(409);
  });

  it('deletes a page (204) and 404s afterwards', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    await app.inject({ method: 'PUT', url: `${base}/content/page/home`, cookies: { sw_session: t }, payload: page });
    const del = await app.inject({ method: 'DELETE', url: `${base}/content/page/home`, cookies: { sw_session: t } });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: `${base}/content/page/home`, cookies: { sw_session: t } });
    expect(get.statusCode).toBe(404);
  });

  it("isolates content across tenants (a non-member cannot touch another owner's project)", async () => {
    const a = await setup('a@acme.test', 'site-a');
    const b = await setup('b@globex.test', 'site-b');
    await app.inject({
      method: 'PUT',
      url: `/projects/${a.projectId}/content/page/home`,
      cookies: { sw_session: a.t },
      payload: page,
    });

    const bReadsA = await app.inject({
      method: 'GET',
      url: `/projects/${a.projectId}/content/page`,
      cookies: { sw_session: b.t },
    });
    expect(bReadsA.statusCode).toBe(403);
  });
});

describe('content API — validate-on-save (unsafe Handlebars source rejected at write)', () => {
  const put = (t: string, projectId: string, kind: string, id: string, payload: object) =>
    app.inject({ method: 'PUT', url: `/projects/${projectId}/content/${kind}/${id}`, cookies: { sw_session: t }, payload });

  it('rejects an unsafe page source at SAVE with a LOCATED 400 (not only at publish)', async () => {
    const { t, projectId } = await setup('owner@acme.test');
    const res = await put(t, projectId, 'page', 'home', {
      ...page,
      source: '<section>\n  <a href="{{ page.link }}">x</a>\n</section>', // bad href on line 2
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; line?: number; column?: number };
    expect(body.error).toMatch(/sw-url/);
    expect(body.line).toBe(2);
    expect(body.column).toBeGreaterThan(0);
    expect(body.error).toContain('(line 2, column'); // position rides in the message too
  });

  it('accepts a safe page source and a template-based page (no own source to validate)', async () => {
    const { t, projectId } = await setup('owner@acme.test');
    expect(
      (await put(t, projectId, 'page', 'home', { ...page, source: '<section><a href="{{sw-url page.link}}">x</a></section>' })).statusCode,
    ).toBe(200);
    expect(
      (await put(t, projectId, 'page', 'p2', { id: 'p2', path: 'p2', title: 'P2', template: 'global:landing' })).statusCode,
    ).toBe(200);
  });

  it('rejects unsafe template and snippet source too (same save-time gate)', async () => {
    const { t, projectId } = await setup('owner@acme.test');
    expect((await put(t, projectId, 'template', 'land', { id: 'land', name: 'Landing', source: '<nav>x</nav>' })).statusCode).toBe(400);
    expect((await put(t, projectId, 'snippet', 'card', { id: 'card', name: 'card', source: '<div onclick="{{x}}">x</div>' })).statusCode).toBe(400);
  });

  // Render is deliberately LENIENT about an unknown helper (an inert comment, so one retired helper
  // can't 400 a whole page). But that marker is invisible inside an attribute, which is exactly where
  // the missing-arithmetic case lands — so the WRITE is where it has to be caught.
  it('rejects a call to a helper that does not exist, naming it and pointing at the attribute case', async () => {
    const { t, projectId } = await setup('owner@acme.test');
    const bad = await put(t, projectId, 'page', 'home', {
      ...page,
      source: '<section>{{#each dataset.x}}<div data-sw-delay="{{multiply @index 90}}"></div>{{/each}}</section>',
    });
    expect(bad.statusCode).toBe(400);
    const msg = (bad.json() as { error: string }).error;
    expect(msg).toMatch(/multiply/);          // names the offender
    expect(msg).toMatch(/inside an attribute/); // and why it would have been invisible
    expect(msg).toMatch(/sw-stagger/);        // and what to use instead
    // The supported form saves.
    expect(
      (await put(t, projectId, 'page', 'home', {
        ...page,
        source: '<section>{{#each dataset.x}}<div data-sw-delay="{{sw-stagger @index 90}}"></div>{{/each}}</section>',
      })).statusCode,
    ).toBe(200);
  });

  it('rejects an unknown helper in a CHROME slot too — it would show on every page', async () => {
    const { t, projectId } = await setup('owner@acme.test');
    const base = { identity: { name: 'Acme', colors: {} }, settings: {} };
    const bad = await put(t, projectId, 'settings', 'settings', {
      ...base,
      website: { footer: '<div class="footer">{{bogusHelper company.name}}</div>' },
    });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: string }).error).toMatch(/Footer.*bogusHelper/i);
  });

  it('LOUDLY rejects a skeleton landmark in a chrome slot (slot-named) but allows neutral slot content', async () => {
    const { t, projectId } = await setup('owner@acme.test');
    const base = { identity: { name: 'Acme', colors: {} }, settings: {} };
    const bad = await put(t, projectId, 'settings', 'settings', { ...base, website: { footer: '<footer><div>x</div></footer>' } });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: string }).error).toMatch(/Footer.*<footer>/); // names the slot + element
    expect((await put(t, projectId, 'settings', 'settings', { ...base, website: { mainNav: '<nav>x</nav>' } })).statusCode).toBe(400);
    // neutral content is fine (the platform wraps it in the landmark)
    expect((await put(t, projectId, 'settings', 'settings', { ...base, website: { footer: '<div class="footer">ok</div>' } })).statusCode).toBe(200);
  });

  it('LOUDLY rejects an UNSAFE chrome-slot template at save (not only at publish), naming the slot', async () => {
    const { t, projectId } = await setup('owner@acme.test');
    const base = { identity: { name: 'Acme', colors: {} }, settings: {} };
    // A bare interpolation in a URL attribute (must be {{sw-url company.logo}}) used to SAVE fine and only
    // 409 at publish — now it fails at save, so compare_to_source can't silently serve a stale build.
    const bad = await put(t, projectId, 'settings', 'settings', {
      ...base,
      website: { mainNav: '<div class="navbar"><a href="/"><img src="{{company.logo}}"></a></div>' },
    });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: string }).error).toMatch(/Main Navigation.*invalid template/i);
    // A valid, data-driven slot still saves.
    expect((await put(t, projectId, 'settings', 'settings', {
      ...base,
      website: { mainNav: '<div class="navbar"><a href="{{sw-url \'/\'}}"><img src="{{sw-url company.logo}}"></a></div>' },
    })).statusCode).toBe(200);
  });
});

describe('content API — settings patch/merge (?merge=1)', () => {
  const put = (t: string, projectId: string, id: string, payload: object, merge = false) =>
    app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/settings/${id}${merge ? '?merge=1' : ''}`,
      cookies: { sw_session: t },
      payload,
    });
  const getSettings = async (t: string, projectId: string) =>
    (await app.inject({ method: 'GET', url: `/projects/${projectId}/content/settings/settings`, cookies: { sw_session: t } }).then((r) => r.json())) as {
      item: { identity: { name: string }; website?: Record<string, unknown> };
    };

  it('a partial write WITHOUT merge is rejected (identity required) — showing why merge is needed', async () => {
    const { t, projectId } = await setup('owner@acme.test');
    const res = await put(t, projectId, 'settings', { website: { footer: '<div>Only the footer</div>' } });
    expect(res.statusCode).toBe(400); // no identity → full-replace validation fails
  });

  it('merges a footer-only patch, preserving identity and the other slots', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'mergesite');
    // Seed a full settings with two slots.
    expect(
      (await put(t, projectId, 'settings', {
        identity: { name: 'Acme', colors: {} },
        settings: {},
        website: { mainNav: '<div>NAV</div>', footer: '<div>OLD FOOTER</div>' },
      })).statusCode,
    ).toBe(200);
    // PATCH only the footer.
    const patched = await put(t, projectId, 'settings', { website: { footer: '<div>NEW FOOTER</div>' } }, true);
    expect(patched.statusCode).toBe(200);
    const { item } = await getSettings(t, projectId);
    expect(item.identity.name).toBe('Acme'); // untouched sibling top-level key
    expect(item.website?.mainNav).toBe('<div>NAV</div>'); // untouched sibling slot
    expect(item.website?.footer).toBe('<div>NEW FOOTER</div>'); // the one slot that changed
  });

  it('validates the MERGED body — an unsafe slot in the patch is rejected at save', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'mergeunsafe');
    expect(
      (await put(t, projectId, 'settings', { identity: { name: 'Acme', colors: {} }, settings: {} })).statusCode,
    ).toBe(200);
    const bad = await put(t, projectId, 'settings', { website: { mainNav: '<nav>landmark not allowed</nav>' } }, true);
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: string }).error).toMatch(/Main Navigation/i);
  });

  it('accepts the ?merge=true spelling as well as ?merge=1', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'mergetrue');
    expect(
      (await put(t, projectId, 'settings', { identity: { name: 'Acme', colors: {} }, settings: {}, website: { footer: '<div>OLD</div>' } })).statusCode,
    ).toBe(200);
    const patched = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/settings/settings?merge=true`,
      cookies: { sw_session: t },
      payload: { website: { footer: '<div>NEW</div>' } },
    });
    expect(patched.statusCode).toBe(200);
    const { item } = await getSettings(t, projectId);
    expect(item.identity.name).toBe('Acme');
    expect(item.website?.footer).toBe('<div>NEW</div>');
  });

  it('rejects ?merge=1 for a kind that is neither settings nor page', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'mergekind');
    const res = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/dataset/team?merge=1`,
      cookies: { sw_session: t },
      payload: { name: 'Team' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/only supported for the "settings" and "page" kinds/i);
  });

  it('returns an actionable 404 when there is no settings row to merge into', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'mergemissing');
    // Settings are seeded + undeletable via the API, so force the empty state directly in the DB.
    await db.delete(content).where(and(eq(content.projectId, projectId), eq(content.kind, 'settings')));
    const res = await put(t, projectId, 'settings', { website: { footer: '<div>x</div>' } }, true);
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toMatch(/no settings to merge into/i);
  });
});

// A page write used to be a TOTAL replace with no partial option, so the routine act of setting a nav
// label (`{id, path, title, nav}`) silently deleted `source`, `status`, `description`, `order`, `parent`
// AND `data.swImport` — the marker every fidelity tool requires, making the page permanently un-auditable.
describe('content API — page patch/merge (?merge=1) + import-marker preservation', () => {
  const putPage = (t: string, projectId: string, id: string, payload: object, merge = false) =>
    app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/page/${id}${merge ? '?merge=1' : ''}`,
      cookies: { sw_session: t },
      payload,
    });
  const getPage = async (t: string, projectId: string, id: string) =>
    (await app.inject({ method: 'GET', url: `/projects/${projectId}/content/page/${id}`, cookies: { sw_session: t } })).json() as {
      item: Record<string, unknown>;
    };

  const full = {
    id: 'about',
    path: 'about',
    title: 'About',
    status: 'published',
    description: 'All about us',
    order: 3,
    source: '<h1 data-sw-text="t">About</h1>',
    data: { swImport: { sourceUrl: 'https://example.test/about', rewritten: true }, heading: 'About' },
  };

  it('PATCHES only the fields sent, keeping source/status/description/order/data', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'pagemerge');
    expect((await putPage(t, projectId, 'about', full)).statusCode).toBe(200);

    const patched = await putPage(t, projectId, 'about', { id: 'about', nav: { title: 'About Us', slots: ['header'] } }, true);
    expect(patched.statusCode).toBe(200);

    const { item } = await getPage(t, projectId, 'about');
    expect((item.nav as { title: string }).title).toBe('About Us');
    expect(item.source).toBe(full.source); // ← the whole point: a total replace would have dropped these
    expect(item.status).toBe('published');
    expect(item.description).toBe('All about us');
    expect(item.order).toBe(3);
    expect((item.data as { swImport?: unknown }).swImport).toEqual(full.data.swImport);
    expect((item.data as { heading?: string }).heading).toBe('About'); // sibling data key survives
  });

  it('merges data key-by-key but replaces arrays wholesale', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'pagemerge2');
    await putPage(t, projectId, 'about', { ...full, nav: { title: 'About', slots: ['header', 'footer'] } });
    await putPage(t, projectId, 'about', { id: 'about', data: { heading: 'Changed' }, nav: { slots: ['mobile'] } }, true);
    const { item } = await getPage(t, projectId, 'about');
    expect((item.data as { heading?: string }).heading).toBe('Changed');
    expect((item.data as { swImport?: unknown }).swImport).toEqual(full.data.swImport); // untouched sibling
    expect((item.nav as { slots: string[] }).slots).toEqual(['mobile']); // array REPLACED, not appended
    expect((item.nav as { title: string }).title).toBe('About'); // sibling object key kept
  });

  it('404s with an actionable message when the page does not exist yet', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'pagemerge404');
    const res = await putPage(t, projectId, 'ghost', { id: 'ghost', title: 'Ghost' }, true);
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toMatch(/no page "ghost" to merge into/i);
  });

  it('validates the MERGED page — an unsafe source in the patch is rejected', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'pagemergeunsafe');
    await putPage(t, projectId, 'about', full);
    // a bare {{x}} in a URL attribute (must be {{sw-url x}}) — the same rule a full write is held to
    const bad = await putPage(t, projectId, 'about', { id: 'about', source: '<a href="{{path}}">x</a>' }, true);
    expect(bad.statusCode).toBe(400);
  });

  it('carries data.swImport across a FULL replace that omits it', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'pagemarker');
    await putPage(t, projectId, 'about', full);
    // exactly the call that used to destroy the marker
    expect(
      (await putPage(t, projectId, 'about', { id: 'about', path: 'about', title: 'About', nav: { title: 'About Us', slots: ['header'] } })).statusCode,
    ).toBe(200);
    const { item } = await getPage(t, projectId, 'about');
    expect((item.data as { swImport?: unknown }).swImport).toEqual(full.data.swImport);
    // the rest of the replace still applied normally (this is NOT a merge)
    expect(item.source).toBeUndefined();
    expect((item.data as { heading?: string }).heading).toBeUndefined();
  });

  it('lets an explicit data.swImport:null clear the marker (a page that is no longer import-derived)', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'pagemarkerclear');
    await putPage(t, projectId, 'about', full);
    expect(
      (await putPage(t, projectId, 'about', { id: 'about', path: 'about', title: 'About', data: { swImport: null } })).statusCode,
    ).toBe(200);
    const { item } = await getPage(t, projectId, 'about');
    expect((item.data as { swImport?: unknown }).swImport ?? null).toBeNull();
  });

  // Moving a page off a template — "this translation now INHERITS its parent's code" — had no
  // expressible form: `template: ""` fails `.min(1)`, a merge could only add or overwrite, and a full
  // write means resending the whole page from a possibly stale snapshot.
  it('a null in a merge patch CLEARS the field — a page can be moved back onto inheritance', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'pageclear');
    await app.inject({
      method: 'PUT', url: `/projects/${projectId}/content/template/tpl_home`, cookies: { sw_session: t },
      payload: { id: 'tpl_home', name: 'Home layout', source: '<h1>home</h1>' },
    });
    await putPage(t, projectId, 'de', { id: 'de', path: 'de', title: 'Start', template: 'tpl_home' });
    expect((await getPage(t, projectId, 'de')).item.template).toBe('tpl_home');

    const cleared = await putPage(t, projectId, 'de', { template: null }, true);
    expect(cleared.statusCode).toBe(200);
    const { item } = await getPage(t, projectId, 'de');
    expect(item.template).toBeUndefined();
    expect(item.title).toBe('Start'); // the rest of the page is untouched
  });

  it('an empty template string is still refused — null is the way to clear, not ""', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'pageemptytpl');
    await putPage(t, projectId, 'de', { id: 'de', path: 'de', title: 'Start' });
    expect((await putPage(t, projectId, 'de', { template: '' }, true)).statusCode).toBe(400);
  });

  // The path already says which entity this is; requiring `id` in the body too produced a bare
  // `{"fieldErrors":{"id":["Required"]}}` that names neither the id nor where it belongs.
  it('defaults a full write’s id from the path, and still catches one that disagrees', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'pageidpath');
    const created = await putPage(t, projectId, 'about', { path: 'about', title: 'About' });
    expect(created.statusCode).toBe(200);
    expect((await getPage(t, projectId, 'about')).item.id).toBe('about');

    const mismatched = await putPage(t, projectId, 'about', { id: 'elsewhere', path: 'about', title: 'About' });
    expect(mismatched.statusCode).toBe(409);
  });
});

// A full page list carries every page's Handlebars source — 337 KB on a 22-page imported site, past the
// MCP tool-output ceiling, so listing the pages of a real site was impossible. `?summary=1` drops the
// heavy body fields and describes them instead.
describe('content API — list summary (?summary=1)', () => {
  const list = (t: string, projectId: string, kind: string, summary = false) =>
    app.inject({ method: 'GET', url: `/projects/${projectId}/content/${kind}${summary ? '?summary=1' : ''}`, cookies: { sw_session: t } });

  it('omits source + data and describes them, keeping the metadata', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'listsum');
    await app.inject({
      method: 'PUT', url: `/projects/${projectId}/content/page/about`, cookies: { sw_session: t },
      payload: { id: 'about', path: 'about', title: 'About', status: 'published', source: '<h1>hi</h1>', data: { heading: 'A' } },
    });
    const full = (list_ => list_.json() as { items: Array<Record<string, unknown>> })(await list(t, projectId, 'page'));
    const about = full.items.find((p) => p.id === 'about')!;
    expect(about.source).toBe('<h1>hi</h1>'); // default is unchanged — existing callers keep the body

    const sum = (await list(t, projectId, 'page', true)).json() as { items: Array<Record<string, unknown>> };
    const s = sum.items.find((p) => p.id === 'about')!;
    expect(s.title).toBe('About');
    expect(s.status).toBe('published');
    expect(s.source).toBeUndefined();
    expect(s.data).toBeUndefined();
    expect((s._summary as { omitted: Record<string, unknown> }).omitted).toEqual({ source: { bytes: 11 }, data: { keys: ['heading'] } });
  });

  it('still applies the dataset scope for entries while summarising', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'listsument');
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/content/dataset/team`, cookies: { sw_session: t }, payload: { id: 'team', name: 'Team', slug: 'team', fields: [{ name: 'name', type: 'text' }] } });
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/content/entry/a?dataset=team`, cookies: { sw_session: t }, payload: { id: 'a', dataset: 'team', values: { name: 'Ann' } } });
    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/content/entry?dataset=team&summary=1`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: Array<Record<string, unknown>> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.values).toBeUndefined();
    expect((items[0]!._summary as { omitted: Record<string, unknown> }).omitted).toEqual({ values: { keys: ['name'] } });
  });
});

// A write used to echo the whole stored entity — for settings that is criticalCss + four chrome slots
// + identity, ~9 KB, even for a one-field ?merge=1 patch. `?receipt=1` returns what a writer actually
// needs instead: did it land, and on what.
describe('write receipt', () => {
  const base = { identity: { name: 'Acme', colors: {} }, settings: {} };
  const bigCss = `.x{color:red}${'/* pad */'.repeat(400)}`;

  it('replaces the ~9 KB echo with a short receipt naming the changed keys', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'rcpt1');
    const url = `/projects/${projectId}/content/settings/settings`;
    // Seed a realistically FAT settings entity.
    await app.inject({ method: 'PUT', url, cookies: { sw_session: t }, payload: { ...base, website: { criticalCss: bigCss } } });

    const echo = await app.inject({ method: 'PUT', url, cookies: { sw_session: t }, payload: { ...base, website: { criticalCss: bigCss, head: '<meta>' } } });
    const receipt = await app.inject({
      method: 'PUT', url: `${url}?merge=1&receipt=1`, cookies: { sw_session: t }, payload: { website: { footer: '<div>f</div>' } },
    });
    expect(receipt.statusCode).toBe(200);
    const body = receipt.json() as { kind: string; id: string; bytes: number; created: boolean; changed: string[] };
    expect(body).toMatchObject({ kind: 'settings', id: 'settings', created: false, changed: ['website'] });
    expect(body.bytes).toBeGreaterThan(3_000); // it still REPORTS the size it no longer sends
    // The whole point: the receipt is orders of magnitude smaller than the echo it replaces.
    expect(receipt.payload.length).toBeLessThan(200);
    expect(echo.payload.length).toBeGreaterThan(3_000);
  });

  it('still MERGES correctly — a receipt write is a normal write', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'rcpt2');
    const url = `/projects/${projectId}/content/settings/settings`;
    await app.inject({ method: 'PUT', url, cookies: { sw_session: t }, payload: { ...base, website: { head: '<meta>' } } });
    await app.inject({ method: 'PUT', url: `${url}?merge=1&receipt=1`, cookies: { sw_session: t }, payload: { website: { footer: '<div>f</div>' } } });
    const stored = (await app.inject({ method: 'GET', url, cookies: { sw_session: t } })).json() as { item: { website: Record<string, string> } };
    expect(stored.item.website.footer).toBe('<div>f</div>');
    expect(stored.item.website.head).toBe('<meta>'); // the omitted slot survived
  });

  it('reports an empty `changed` for a NO-OP patch — the signal the echo never gave', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'rcpt3');
    const url = `/projects/${projectId}/content/page/home`;
    await app.inject({ method: 'PUT', url, cookies: { sw_session: t }, payload: { ...page, title: 'Home' } });
    const noop = await app.inject({ method: 'PUT', url: `${url}?merge=1&receipt=1`, cookies: { sw_session: t }, payload: { id: 'home', title: 'Home' } });
    expect((noop.json() as { changed: string[] }).changed).toEqual([]);
  });

  it('marks a CREATE, and defaults to the full echo so existing callers are untouched', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'rcpt4');
    const url = `/projects/${projectId}/content/page/about`;
    const created = await app.inject({
      method: 'PUT', url: `${url}?receipt=1`, cookies: { sw_session: t }, payload: { id: 'about', path: 'about', title: 'About' },
    });
    const body = created.json() as { created: boolean; changed: string[] };
    expect(body.created).toBe(true);
    expect(body.changed).toEqual(expect.arrayContaining(['id', 'path', 'title']));
    // No flag → the entity, exactly as before.
    const plain = await app.inject({ method: 'PUT', url, cookies: { sw_session: t }, payload: { id: 'about', path: 'about', title: 'About 2' } });
    expect((plain.json() as { item: { title: string } }).item.title).toBe('About 2');
  });

  it('reads an ENTRY under its dataset scope, so an update is not reported as a create', async () => {
    // An entry lives under its dataset slug, not the project-global scope. A scope-less prior read would
    // miss it and every entry write would claim created:true with every key "changed".
    const { t, projectId } = await setup('owner@acme.test', 'rcptentry');
    const put = (url: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PUT', url: `/projects/${projectId}${url}`, cookies: { sw_session: t }, payload });
    await put('/content/dataset/team', { id: 'team', name: 'Team', slug: 'team', fields: [{ name: 'v', type: 'text' }] });

    const created = await put('/content/entry/row_1?receipt=1', { id: 'row_1', dataset: 'team', values: { v: 'a' } });
    expect((created.json() as { created: boolean }).created).toBe(true);

    const updated = await put('/content/entry/row_1?receipt=1', { id: 'row_1', dataset: 'team', values: { v: 'b' } });
    const body = updated.json() as { created: boolean; changed: string[] };
    expect(body.created).toBe(false);       // the existing row WAS found
    expect(body.changed).toEqual(['values']); // and only the field that moved is listed
  });

  it('still carries data.swImport across a full page replace when a receipt is requested', async () => {
    // The receipt path reuses the SAME prior-value read as the swImport carry — a regression here would
    // make a cloned page permanently un-auditable.
    const { t, projectId } = await setup('owner@acme.test', 'rcpt5');
    const url = `/projects/${projectId}/content/page/home`;
    await app.inject({
      method: 'PUT', url, cookies: { sw_session: t },
      payload: { ...page, data: { swImport: { sourceUrl: 'https://x.test/' } } },
    });
    await app.inject({ method: 'PUT', url: `${url}?receipt=1`, cookies: { sw_session: t }, payload: { ...page, title: 'Renamed' } });
    const stored = (await app.inject({ method: 'GET', url, cookies: { sw_session: t } })).json() as { item: { title: string; data?: { swImport?: unknown } } };
    expect(stored.item.title).toBe('Renamed');
    expect(stored.item.data?.swImport).toEqual({ sourceUrl: 'https://x.test/' });
  });
});

// One call clears N entities. Looping delete_content was slow interactively and, for an agent, a
// rate-limit wall that made "undo this import" cost more turns than the import.
describe('bulk delete', () => {
  const bulk = (t: string, projectId: string, kind: string, payload: { ids: string[]; dataset?: string }) =>
    app.inject({ method: 'POST', url: `/projects/${projectId}/content/${kind}/bulk-delete`, cookies: { sw_session: t }, payload });

  async function seedPages(t: string, projectId: string, ids: string[]) {
    for (const id of ids) {
      await app.inject({
        method: 'PUT', url: `/projects/${projectId}/content/page/${id}`, cookies: { sw_session: t },
        payload: { id, path: id, title: id },
      });
    }
  }

  it('deletes many in one call and reports each id', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'bulk1');
    await seedPages(t, projectId, ['a', 'b', 'c']);
    const res = await bulk(t, projectId, 'page', { ids: ['a', 'b'] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: ['a', 'b'], failed: [], requested: 2 });
    // Only the named ids went; home + c remain.
    const left = ((await app.inject({ method: 'GET', url: `/projects/${projectId}/content/page`, cookies: { sw_session: t } })).json() as { items: Array<{ id: string }> }).items;
    expect(left.map((p) => p.id).sort()).toEqual(['c', 'home']);
  });

  it('is PARTIAL: one bad id does not abort the batch', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'bulk2');
    await seedPages(t, projectId, ['a', 'b']);
    const body = (await bulk(t, projectId, 'page', { ids: ['a', 'ghost', 'b'] })).json() as { deleted: string[]; failed: Array<{ id: string; error: string }> };
    expect(body.deleted).toEqual(['a', 'b']);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]!.id).toBe('ghost');
    expect(body.failed[0]!.error).toMatch(/not found/i); // the reason is reported, never swallowed
  });

  it('collapses duplicate ids so they cannot double-count or report a phantom miss', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'bulk3');
    await seedPages(t, projectId, ['a']);
    expect((await bulk(t, projectId, 'page', { ids: ['a', 'a', 'a'] })).json()).toEqual({ deleted: ['a'], failed: [], requested: 1 });
  });

  it('scopes ENTRY deletes to their dataset (ids are unique only within one) and 400s without it', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'bulk4');
    const put = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'PUT', url: `/projects/${projectId}${url}`, cookies: { sw_session: t }, payload });
    for (const slug of ['team', 'faq']) {
      await put(`/content/dataset/${slug}`, { id: slug, name: slug, slug, fields: [{ name: 'v', type: 'text' }] });
      await put(`/content/entry/row_1?dataset=${slug}`, { id: 'row_1', dataset: slug, values: { v: slug } });
    }
    // Same entry id in both datasets — an unscoped bulk delete must be refused, not guessed.
    expect((await bulk(t, projectId, 'entry', { ids: ['row_1'] })).statusCode).toBe(400);
    expect((await bulk(t, projectId, 'entry', { ids: ['row_1'], dataset: 'team' })).json()).toMatchObject({ deleted: ['row_1'] });
    const left = ((await app.inject({ method: 'GET', url: `/projects/${projectId}/content/entry`, cookies: { sw_session: t } })).json() as { items: Array<{ dataset: string }> }).items;
    expect(left.map((e) => e.dataset)).toEqual(['faq']); // the other dataset's row_1 is untouched
  });

  it('rejects an empty or oversized id list, and a member without content:delete', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'bulk5');
    expect((await bulk(t, projectId, 'page', { ids: [] })).statusCode).toBe(400);
    expect((await bulk(t, projectId, 'page', { ids: Array.from({ length: 201 }, (_, i) => `p${i}`) })).statusCode).toBe(400);
    // An outsider has no access to the project at all.
    await registerAccount(db, 'stranger@acme.test', 'Pw-secret-1');
    const other = token(await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'stranger@acme.test', password: 'Pw-secret-1' } }));
    expect((await bulk(other, projectId, 'page', { ids: ['home'] })).statusCode).toBe(403);
  });

  it('deleting a DATASET takes its entries with it', async () => {
    const { t, projectId } = await setup('owner@acme.test', 'bulk6');
    const put = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'PUT', url: `/projects/${projectId}${url}`, cookies: { sw_session: t }, payload });
    await put('/content/dataset/team', { id: 'team', name: 'Team', slug: 'team', fields: [{ name: 'v', type: 'text' }] });
    await put('/content/entry/row_1?dataset=team', { id: 'row_1', dataset: 'team', values: { v: 'x' } });
    expect((await bulk(t, projectId, 'dataset', { ids: ['team'] })).json()).toMatchObject({ deleted: ['team'] });
    const left = ((await app.inject({ method: 'GET', url: `/projects/${projectId}/content/entry`, cookies: { sw_session: t } })).json() as { items: unknown[] }).items;
    expect(left).toEqual([]);
  });
});
