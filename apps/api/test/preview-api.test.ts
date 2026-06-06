import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { RenderPool } from '../src/render/render-pool.js';

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));

let app: FastifyInstance;

beforeEach(async () => {
  app = await createApp({ db: await makeTestDb() });
  await app.ready();
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

async function setup(email: string, instance: FastifyInstance = app, slug = 'site') {
  const reg = await instance.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'pw-secret-1' },
  });
  const t = token(reg);
  const proj = await instance.inject({
    method: 'POST',
    url: `/projects`,
    cookies: { sw_session: t },
    payload: { name: 'Site', slug },
  });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, projectId };
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
  it('renders a draft page to a full HTML document + a preview token', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: page,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { html: string; token: string };
    expect(body.html.startsWith('<!doctype html>')).toBe(true);
    expect(body.html).toContain('Hello world');
    expect(body.html).toContain('data-sw-block="Section"');
    expect(body.token).toMatch(/^[0-9a-f-]{36}$/); // an opaque uuid token
  });

  it('serves the preview document for a token under a sandbox CSP (isolated, framable)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const token = (
      await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/preview`,
        cookies: { sw_session: t },
        payload: page,
      })
    ).json().token as string;

    const doc = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/preview/${token}`,
      cookies: { sw_session: t },
    });
    expect(doc.statusCode).toBe(200);
    expect(doc.headers['content-type']).toContain('text/html');
    // `sandbox allow-scripts` forces an opaque origin (isolated) yet runs scripts;
    // the editor must be able to frame it (SAMEORIGIN, not the default DENY).
    expect(doc.headers['content-security-policy']).toBe('sandbox allow-scripts');
    expect(doc.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(doc.body).toContain('Hello world');
  });

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

    // B cannot even reach A's project (not a member) → 403, before any token lookup.
    const intoA = await app.inject({
      method: 'GET',
      url: `/projects/${a.projectId}/preview/${token}`,
      cookies: { sw_session: b.t },
    });
    expect(intoA.statusCode).toBe(403);

    // And A's token presented under B's own (authorized) scope fails the token's
    // org/project/user binding → 404 (the store rejects it).
    const cross = await app.inject({
      method: 'GET',
      url: `/projects/${b.projectId}/preview/${token}`,
      cookies: { sw_session: b.t },
    });
    expect(cross.statusCode).toBe(404);

    // An unknown token under A's own scope is a 404.
    const unknown = await app.inject({
      method: 'GET',
      url: `/projects/${a.projectId}/preview/does-not-exist`,
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

  it('escapes hostile content in the rendered HTML', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: {
        id: 'x',
        path: 'x',
        title: 'X',
        root: {
          id: 'r',
          type: 'Heading',
          props: { text: '<img src=x onerror=alert(1)>' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });

  it('applies the project brand and resolves dataset bindings (incl. drafts)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    // Save brand settings.
    await app.inject({
      method: 'PUT',
      url: `${base}/content/settings/settings`,
      cookies: { sw_session: t },
      payload: { brand: { name: 'Acme', colors: { primary: '#abcdef' } }, settings: {} },
    });
    // Save a draft entry in dataset "posts".
    await app.inject({
      method: 'PUT',
      url: `${base}/content/entry/post-1`,
      cookies: { sw_session: t },
      payload: { id: 'post-1', dataset: 'posts', status: 'draft', values: { title: 'Draft Post' } },
    });

    const res = await app.inject({
      method: 'POST',
      url: `${base}/preview`,
      cookies: { sw_session: t },
      payload: {
        id: 'blog',
        path: 'blog',
        title: 'Blog',
        root: {
          id: 'r',
          type: 'Grid',
          binding: { dataset: 'posts', mode: 'list' },
          children: [{ id: 'c', type: 'Heading', props: { textField: 'title' } }],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html).toContain('--sw-color-primary: #abcdef;');
    expect(html).toContain('Draft Post'); // drafts shown in preview
  });

  it('inlines compiled Tailwind utilities (incl. brand) when the page uses classes', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    await app.inject({
      method: 'PUT',
      url: `${base}/content/settings/settings`,
      cookies: { sw_session: t },
      payload: { brand: { name: 'Acme', colors: { primary: '#abcdef' } }, settings: {} },
    });
    const res = await app.inject({
      method: 'POST',
      url: `${base}/preview`,
      cookies: { sw_session: t },
      payload: {
        id: 'home',
        path: '',
        title: 'Home',
        root: { id: 'r', type: 'Section', className: 'flex bg-primary', children: [] },
      },
    });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html).toContain('class="flex bg-primary"');
    // The Tailwind compile ran and was inlined (banner + the compiled utility),
    // with the brand color mapped into the Tailwind theme.
    expect(html).toContain('/*! tailwindcss');
    expect(html).toContain('.bg-primary');
    expect(html).toContain('--color-primary:#abcdef');
    // No external stylesheet link in preview — it is fully self-contained.
    expect(html).not.toContain('rel="stylesheet"');
  });

  it('does not inline a utility stylesheet when the page uses no classes', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: page,
    });
    const html = (res.json() as { html: string }).html;
    expect(html).not.toContain('tailwindcss'); // the compiler never ran
  });
});

describe('preview API — code-first source page', () => {
  let poolApp: FastifyInstance;
  beforeEach(async () => {
    poolApp = await createApp({ db: await makeTestDb(), renderPool: new RenderPool({ size: 1, workerPath }) });
    await poolApp.ready();
  });
  afterEach(async () => {
    await poolApp.close(); // drains + terminates the render worker
  });

  it('renders a source page through the worker, applying client-edited content, styled + tokenized', async () => {
    const { t, projectId } = await setup('a@acme.test', poolApp);
    const res = await poolApp.inject({
      method: 'POST',
      url: `/projects/${projectId}/preview`,
      cookies: { sw_session: t },
      payload: {
        id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
        source: '<main class="grid"><h1>{{edit "headline" "Default headline"}}</h1></main>',
        content: { headline: 'Edited headline' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { html: string; token: string };
    expect(body.html.startsWith('<!doctype html>')).toBe(true);
    // The {{edit}} override replaced the template default; the block tree was not rendered.
    expect(body.html).toContain('<main class="grid"><h1>Edited headline</h1></main>');
    expect(body.html).not.toContain('Default headline');
    expect(body.html).not.toContain('<section data-sw-block="Section"'); // the block tree was not rendered
    // The source's literal Tailwind class compiled + inlined.
    expect(body.html).toContain('display:grid');
    expect(body.token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('renders the project skeleton slots (topNav/footer) around a source-page preview (WYSIWYG)', async () => {
    const { t, projectId } = await setup('slots@acme.test', poolApp);
    const base = `/projects/${projectId}`;
    await poolApp.inject({
      method: 'PUT',
      url: `${base}/content/settings/settings`,
      cookies: { sw_session: t },
      payload: {
        identity: { name: 'Acme', colors: { primary: '#0a7' } },
        website: {
          topNav: '<nav class="navbar">{{ company.name }}</nav>',
          footer: '<footer class="footer">© {{ company.name }}</footer>',
        },
        settings: {},
      },
    });
    const res = await poolApp.inject({
      method: 'POST',
      url: `${base}/preview`,
      cookies: { sw_session: t },
      payload: { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<main><h1>Body</h1></main>' },
    });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html).toContain('<nav class="navbar">Acme</nav>'); // shared topNav, {{ company.name }} bound
    expect(html).toContain('<footer class="footer">© Acme</footer>'); // shared footer
    // Source order: topNav before the page body, footer after it.
    expect(html.indexOf('class="navbar"')).toBeLessThan(html.indexOf('<h1>Body</h1>'));
    expect(html.indexOf('<h1>Body</h1>')).toBeLessThan(html.indexOf('class="footer"'));
    expect(html).toMatch(/\.navbar/); // the slot's DaisyUI classes compiled into the inlined sheet
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
        topNav:
          '<nav class="navbar"><ul>{{#each nav.header}}<li><a href="{{url path}}">{{label}}</a></li>{{/each}}</ul>' +
          '<span class="loc">{{page.locale}}</span>{{#each page.translations}}<a class="sw" href="{{url path}}">{{locale}}</a>{{/each}}</nav>',
      },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
    });
    const root = { id: 'r', type: 'Section' };
    // English (default) + German variant, linked by group; each carries a header nav item.
    await put('page', 'home', { id: 'home', path: '', title: 'Home', root, translationGroup: 'home', nav: { title: 'Home', slots: ['header'], order: 1 }, source: '<main><h1>EN</h1></main>' });
    const gde = { id: 'home-de', path: 'de', title: 'Start', locale: 'de', translationGroup: 'home', root, nav: { title: 'Start', slots: ['header'], order: 1 }, source: '<main><h1>DE</h1></main>' };
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
        source: '<main><h1 data-aos="fade-up">Reveal</h1></main>',
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
        source: '<main><h1>Static</h1></main>',
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
        // topNav is unsafe (a <script> — rejected by the no-JS validator); footer is fine.
        website: { topNav: '<nav><script>x()</script></nav>', footer: '<footer class="footer">ok</footer>' },
        settings: {},
      },
    });
    const res = await poolApp.inject({
      method: 'POST',
      url: `${base}/preview`,
      cookies: { sw_session: t },
      payload: { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<main><h1>Body</h1></main>' },
    });
    expect(res.statusCode).toBe(200); // the page preview still renders
    const html = (res.json() as { html: string }).html;
    expect(html).toContain('<h1>Body</h1>'); // body intact
    expect(html).not.toContain('<script>x()'); // the broken slot was skipped, not injected
    expect(html).toContain('<footer class="footer">ok</footer>'); // the good slot still renders
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
