import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../src/db/client.js';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { RenderPool } from '../src/render/render-pool.js';
import { closeScreenshotBrowser } from '../src/render/screenshot.js';

// The screenshot test may launch a shared headless browser; close it so the process exits cleanly.
afterAll(async () => closeScreenshotBrowser());

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));

let app: FastifyInstance;
let db: Database;
// The nested "code-first source page" describe boots a SECOND app (`poolApp`, with a render pool) over
// its OWN db; `setup` seeds against whichever app's db matches the `instance` it's given (the module
// `app` → `db`, anything else → the pool's `poolDb`).
let poolDb: Database | undefined;

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

async function setup(email: string, instance: FastifyInstance = app, slug = 'site') {
  // Project creation is agency-staff-only now; seed the creator as `developer` (agency staff). The
  // register route is invite-only, so seed via the repo (against the instance's db), then log in for a
  // session cookie.
  const seedDb = instance === app ? db : poolDb!;
  await registerAccount(seedDb, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = token(await instance.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await instance.inject({
    method: 'POST',
    url: `/projects`,
    cookies: { sw_session: t },
    payload: { name: 'Site', slug },
  });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, projectId, slug };
}

const page = {
  id: 'home',
  path: '',
  title: 'Home',
  root: {
    id: 'r',
    type: 'Section',
    children: [{ id: 'h', type: 'Heading', props: { text: 'Hello world', level: 1 } }],
  },
};

describe('preview API', () => {
  it('does not serve a preview token to another tenant, or an unknown/expired token', async () => {
    const a = await setup('a@acme.test', app, 'site-a');
    const b = await setup('b@globex.test', app, 'site-b');
    const token = (
      await app.inject({
        method: 'POST',
        url: `/projects/${a.projectId}/preview`,
        cookies: { sw_session: a.t },
        payload: page,
      })
    ).json().token as string;

    // B cannot reach A's preview (not a member). The route returns a UNIFORM opaque 404 for every
    // miss (no membership, unknown slug, bad/expired token) so it never leaks whether a project or
    // preview exists.
    const intoA = await app.inject({
      method: 'GET',
      url: `/preview/${a.slug}/${token}`,
      cookies: { sw_session: b.t },
    });
    expect(intoA.statusCode).toBe(404);

    // And A's token presented under B's own (authorized) scope fails the token's
    // project/user binding → 404 (the store rejects it).
    const cross = await app.inject({
      method: 'GET',
      url: `/preview/${b.slug}/${token}`,
      cookies: { sw_session: b.t },
    });
    expect(cross.statusCode).toBe(404);

    // An unknown token under A's own scope is a 404.
    const unknown = await app.inject({
      method: 'GET',
      url: `/preview/${a.slug}/does-not-exist`,
      cookies: { sw_session: a.t },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const { projectId } = await setup('a@acme.test');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview`,
      payload: page,
    });
    expect(res.statusCode).toBe(401);
  });

  it('forbids previewing another tenant’s project', async () => {
    const a = await setup('a@acme.test', app, 'site-a');
    const b = await setup('b@globex.test', app, 'site-b');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${a.projectId}/preview`,
      cookies: { sw_session: b.t },
      payload: page,
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an invalid page (400)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: { id: 'x', title: 'no root' },
    });
    expect(res.statusCode).toBe(400);
  });

});

describe('preview API — code-first source page', () => {
  let poolApp: FastifyInstance;
  beforeEach(async () => {
    poolDb = await makeTestDb();
    poolApp = await createApp({ db: poolDb, renderPool: new RenderPool({ size: 1, workerPath }) });
    await poolApp.ready();
  });
  afterEach(async () => {
    await poolApp.close(); // drains + terminates the render worker
    poolDb = undefined;
  });

  it('renders a source page through the worker, applying client-edited content, styled + tokenized', async () => {
    const { t, projectId } = await setup('a@acme.test', poolApp);
    const res = await poolApp.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: {
        id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
        source: '<div class="grid"><h1 data-sw-text="headline">Default headline</h1></div>',
        data: { headline: 'Edited headline' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { html: string; token: string };
    expect(body.html.startsWith('<!doctype html>')).toBe(true);
    // The page.data override replaced the authored default; the block tree was not rendered. PREVIEW
    // keeps the data-sw-text marker on the element for inline editing (stripped on publish).
    // The platform wraps the source body in <main id="page-content">.
    expect(body.html).toContain('<main id="page-content"><div class="grid"><h1 data-sw-text="headline">Edited headline</h1></div></main>');
    expect(body.html).not.toContain('Default headline');
    expect(body.html).not.toContain('<section data-sw-block="Section"'); // the block tree was not rendered
    // The source's literal Tailwind class compiled + inlined.
    expect(body.html).toContain('display:grid');
    expect(body.token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('?screenshot=1 returns the HTML and, when a browser is available, well-formed screenshots', async () => {
    // Screenshots are BEST-EFFORT: with no Chromium (some CI) the capture is swallowed and only HTML
    // returns; where Chromium is present the route renders the page to JPEGs. Assert the contract holds
    // in either environment (and validate the image shape when present).
    const { t, projectId } = await setup('shot@acme.test', poolApp);
    const res = await poolApp.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview?screenshot=1&viewports=fullhd`,
      cookies: { sw_session: t },
      payload: {
        id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
        source: '<div class="p-8"><h1 class="text-3xl">Hello</h1></div>',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      html?: string;
      screenshots?: { fullhd?: { base64: string; mimeType: string; width: number; height: number } };
    };
    expect(typeof body.html).toBe('string');
    if (body.screenshots?.fullhd) {
      const d = body.screenshots.fullhd;
      expect(d.mimeType).toBe('image/jpeg');
      expect(d.width).toBe(1920);
      expect(d.height).toBeGreaterThan(0);
      expect(d.base64.length).toBeGreaterThan(100);
    }
  });

  it('renders the project skeleton slots (mainNav/footer) around a source-page preview (WYSIWYG)', async () => {
    const { t, projectId } = await setup('slots@acme.test', poolApp);
    const base = `/projects/${projectId}`;
    await poolApp.inject({
      method: 'PUT',
      url: `${base}/content/settings/settings`,
      cookies: { sw_session: t },
      payload: {
        identity: { name: 'Acme', colors: { primary: '#0a7' } },
        website: {
          // Slot content is neutral (no landmark tags — the validator forbids those); the platform
          // wraps mainNav in <nav id="main-nav"> and footer in <footer id="footer">.
          mainNav: '<div class="navbar">{{ company.name }}</div>',
          footer: '<div class="footer">© {{ company.name }}</div>',
        },
        settings: {},
      },
    });
    const res = await poolApp.inject({
      method: 'POST',
      url: `${base}/preview`,
      cookies: { sw_session: t },
      payload: { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<section><h1>Body</h1></section>' },
    });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html).toContain('<nav id="main-nav"><div class="navbar">Acme</div></nav>'); // shared mainNav, {{ company.name }} bound, wrapped in the platform landmark
    expect(html).toContain('<footer id="footer"><div class="footer">© Acme</div></footer>'); // shared footer, wrapped in the platform landmark
    // Source order: mainNav before the page body, footer after it.
    expect(html.indexOf('class="navbar"')).toBeLessThan(html.indexOf('<h1>Body</h1>'));
    expect(html.indexOf('<h1>Body</h1>')).toBeLessThan(html.indexOf('class="footer"'));
    expect(html).toMatch(/\.navbar/); // the slot's DaisyUI classes compiled into the inlined sheet
  });

  it('keeps a slot\'s data-sw-* directive markers in PREVIEW so chrome is click-to-edit (any directive, not just translate)', async () => {
    const { t, projectId } = await setup('slot-edit@acme.test', poolApp);
    const base = `/projects/${projectId}`;
    await poolApp.inject({
      method: 'PUT',
      url: `${base}/content/settings/settings`,
      cookies: { sw_session: t },
      payload: {
        identity: { name: 'Acme', colors: { primary: '#0a7' } },
        website: {
          // The platform does not restrict which directive a slot uses: a GLOBAL-catalog translation
          // AND a PER-PAGE page.data text directive both stay editable in the slot's preview.
          footer: '<div><span data-sw-translate="footer_cta">Contact us</span> <span data-sw-text="footer_note">Default note</span></div>',
          translations: { footer_cta: { en: 'Get in touch' } },
        },
        settings: {},
      },
    });
    const res = await poolApp.inject({
      method: 'POST',
      url: `${base}/preview`,
      cookies: { sw_session: t },
      // page.data supplies the per-page value for the slot's data-sw-text directive.
      payload: { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<section><h1>Body</h1></section>', data: { footer_note: 'Per-page note' } },
    });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    // BOTH markers survive in preview (so the bridge can make them click-to-edit) …
    expect(html).toContain('data-sw-translate="footer_cta"');
    expect(html).toContain('data-sw-text="footer_note"');
    // … the translate directive resolved the catalog value, the text directive the page's page.data value.
    expect(html).toContain('>Get in touch<'); // footer_cta from website.translations
    expect(html).toContain('>Per-page note<'); // footer_note from this page's page.data
  });

  it('exposes the editable website.data object to a source-page preview ({{website.data.*}} + {{#each}})', async () => {
    const { t, projectId } = await setup('wdata@acme.test', poolApp);
    const base = `/projects/${projectId}`;
    await poolApp.inject({
      method: 'PUT',
      url: `${base}/content/settings/settings`,
      cookies: { sw_session: t },
      payload: {
        identity: { name: 'Acme', colors: { primary: '#0a7' } },
        website: { data: { hero: { headline: 'Built here' }, highlights: ['fast', 'safe'] } },
        settings: {},
      },
    });
    const res = await poolApp.inject({
      method: 'POST',
      url: `${base}/preview`,
      cookies: { sw_session: t },
      payload: {
        id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
        source: '<div><h1>{{website.data.hero.headline}}</h1><ul>{{#each website.data.highlights}}<li>{{this}}</li>{{/each}}</ul></div>',
      },
    });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html).toContain('<h1>Built here</h1>'); // keyed lookup resolved (escaped, in preview)
    expect(html).toContain('<li>fast</li><li>safe</li>'); // {{#each}} over a website.data array
  });

  it('exposes the previewed page’s own page.data to its source ({{page.data.*}} + {{#each}})', async () => {
    const { t, projectId } = await setup('pdata@acme.test', poolApp);
    const res = await poolApp.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: {
        id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
        data: { hero: { headline: 'On this page' }, tags: ['x', 'y'] },
        source: '<div><h1>{{page.data.hero.headline}}</h1><ul>{{#each page.data.tags}}<li>{{this}}</li>{{/each}}</ul></div>',
      },
    });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html).toContain('<h1>On this page</h1>'); // keyed lookup from the page's own data
    expect(html).toContain('<li>x</li><li>y</li>'); // {{#each}} over a page.data array
  });

  it('exposes page.children (the saved child pages) to a source-page preview', async () => {
    const { t, projectId } = await setup('pchild@acme.test', poolApp);
    const base = `/projects/${projectId}`;
    const put = (key: string, payload: Record<string, unknown>) =>
      poolApp.inject({ method: 'PUT', url: `${base}/content/page/${key}`, cookies: { sw_session: t }, payload });
    await put('home', { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } });
    await put('a2', { id: 'a2', path: 'second', parent: 'home', title: 'Second', order: 2, description: 'Two', data: { tag: 'y' }, root: { id: 'r', type: 'Section' } });
    await put('a1', { id: 'a1', path: 'first', parent: 'home', title: 'First', order: 1, description: 'One', data: { tag: 'x' }, root: { id: 'r', type: 'Section' } });
    const res = await poolApp.inject({
      method: 'POST',
      url: `${base}/preview`,
      cookies: { sw_session: t },
      payload: {
        id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
        source: '<div>{{#each page.children}}<a href="{{sw-url path}}"><h3>{{title}}</h3><p>{{description}}</p><span>{{data.tag}}</span></a>{{/each}}</div>',
      },
    });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html).toContain('<h3>First</h3>'); // child title
    expect(html).toContain('<p>One</p>'); // the child's page.description
    expect(html).toContain('<span>x</span>'); // the child's own page.data, read inside the loop
    expect(html.indexOf('<h3>First</h3>')).toBeLessThan(html.indexOf('<h3>Second</h3>')); // ordered by order
  });

  it('builds the preview nav per-locale — only the previewed page language (WYSIWYG with publish)', async () => {
    const { t, projectId } = await setup('i18n@acme.test', poolApp);
    const base = `/projects/${projectId}`;
    const put = (kind: string, key: string, payload: Record<string, unknown>) =>
      poolApp.inject({ method: 'PUT', url: `${base}/content/${kind}/${key}`, cookies: { sw_session: t }, payload });
    await put('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      // The shared nav lists nav.header labels; expose the locale + switcher too.
      website: {
        // Neutral slot content (no <nav> — that's the skeleton's landmark); the platform wraps it
        // in <nav id="main-nav">.
        mainNav:
          '<div class="navbar"><ul>{{#each nav.header}}<li><a href="{{sw-url path}}">{{label}}</a></li>{{/each}}</ul>' +
          '<span class="loc">{{page.locale}}</span>{{#each page.translations}}<a class="sw" href="{{sw-url path}}">{{locale}}</a>{{/each}}</div>',
      },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
    });
    const root = { id: 'r', type: 'Section' };
    // English (default) + German variant, linked by group; each carries a header nav item.
    await put('page', 'home', { id: 'home', path: '', title: 'Home', root, translationGroup: 'home', nav: { title: 'Home', slots: ['header'], order: 1 }, source: '<section><h1>EN</h1></section>' });
    const gde = { id: 'home-de', path: 'de', title: 'Start', locale: 'de', translationGroup: 'home', root, nav: { title: 'Start', slots: ['header'], order: 1 }, source: '<section><h1>DE</h1></section>' };
    await put('page', 'home-de', gde);

    // Preview the GERMAN page → its nav must list only German pages.
    const res = await poolApp.inject({ method: 'POST', url: `${base}/preview`, cookies: { sw_session: t }, payload: gde });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html).toContain('<html lang="de">'); // the previewed page's locale drives <html lang>
    expect(html).toContain('>Start</a>'); // the German page's own nav item
    expect(html).not.toContain('>Home</a>'); // NOT the English page's item
    expect(html).toContain('<span class="loc">de</span>'); // page.locale in preview
    expect(html).toContain('class="sw" href="/de">de</a>'); // switcher (root-relative link)
  });

  it('inlines the scroll-reveal runtime when the source uses data-aos (and omits it otherwise)', async () => {
    const { t, projectId } = await setup('anim@acme.test', poolApp);
    const animated = await poolApp.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: {
        id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
        source: '<section><h1 data-aos="fade-up">Reveal</h1></section>',
      },
    });
    expect(animated.statusCode).toBe(200);
    const html = (animated.json() as { html: string }).html;
    // Self-contained sandboxed preview: animation CSS + runtime are INLINED, so
    // the reveal actually plays inside the iframe (its CSP allows scripts).
    expect(html).toContain('[data-aos].aos-init');
    expect(html).toContain('IntersectionObserver');
    expect(html).not.toContain('src="animations.js"');

    const plain = await poolApp.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: {
        id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
        source: '<section><h1>Static</h1></section>',
      },
    });
    expect((plain.json() as { html: string }).html).not.toContain('aos-init');
  });

  it('skips a broken/unsafe slot in preview without failing the page (publish still hard-validates)', async () => {
    const { t, projectId } = await setup('broken@acme.test', poolApp);
    const base = `/projects/${projectId}`;
    await poolApp.inject({
      method: 'PUT',
      url: `${base}/content/settings/settings`,
      cookies: { sw_session: t },
      payload: {
        identity: { name: 'Acme', colors: {} },
        // mainNav is unsafe (a <script> — rejected by the no-JS validator); footer is fine (neutral
        // content; the platform wraps it in <footer id="footer">).
        website: { mainNav: '<div><script>x()</script></div>', footer: '<div class="footer">ok</div>' },
        settings: {},
      },
    });
    const res = await poolApp.inject({
      method: 'POST',
      url: `${base}/preview`,
      cookies: { sw_session: t },
      payload: { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<section><h1>Body</h1></section>' },
    });
    expect(res.statusCode).toBe(200); // the page preview still renders
    const html = (res.json() as { html: string }).html;
    expect(html).toContain('<h1>Body</h1>'); // body intact
    expect(html).not.toContain('<script>x()'); // the broken slot was skipped, not injected
    expect(html).toContain('<footer id="footer"><div class="footer">ok</div></footer>'); // the good slot still renders, wrapped in the platform landmark
  });

  it('returns 503 for a source-page preview when no render pool is configured', async () => {
    const { t, projectId } = await setup('b@acme.test'); // module `app` has no pool
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<p>hi</p>' },
    });
    expect(res.statusCode).toBe(503);
  });
});
