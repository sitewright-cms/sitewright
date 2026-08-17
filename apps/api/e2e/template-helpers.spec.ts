import { test, expect, type PlaywrightWorkerArgs } from '@playwright/test';
import { seedUser, enableLocalHosting } from './helpers.js';

type PwFixture = PlaywrightWorkerArgs['playwright'];

/**
 * LIST WINDOWING + ARITHMETIC against the DEPLOYED container.
 *
 * The unit tests pin the helpers' semantics. What only a real instance can show is that the whole
 * PAGINATED ARCHIVE holds together end to end: a run of pages sharing one template, each reading the
 * archive root's posts through `pages.<slug>._attributes.children`, windowing them by its own
 * `page.data.page_no`, computing a page count, and linking to its neighbours — through publish (which
 * rebases every internal link), through the editor's separate preview renderer, and past the 500-child
 * cap that used to make an archive of this size impossible.
 */

const POSTS = 600;
const PER_PAGE = 25;
const LAST_PAGE = Math.ceil(POSTS / PER_PAGE); // 24

// ONE source, rendered by every archive page. Only page.data.page_no differs between them.
const ARCHIVE = [
  '<ul id="posts">',
  `{{#each (sw-paginate pages.news._attributes.children page.data.page_no ${PER_PAGE})}}`,
  '<li><a href="{{sw-url path}}">{{title}}</a></li>',
  '{{/each}}',
  '</ul>',
  // One LINE on purpose: the assertion reads the rendered text, and a newline inside it would put the
  // range's dash on the next line.
  `<p id="meta">page {{page.data.page_no}} of {{sw-ceil (sw-div (sw-length pages.news._attributes.children) ${PER_PAGE})}} · showing {{sw-add (sw-mul (sw-sub page.data.page_no 1) ${PER_PAGE}) 1}}-{{sw-min (sw-mul page.data.page_no ${PER_PAGE}) (sw-length pages.news._attributes.children)}}</p>`,
  `{{#if (sw-gt page.data.page_no 1)}}<a id="prev" href="/news-{{sw-sub page.data.page_no 1}}">Previous</a>{{/if}}`,
  `{{#if (sw-lt page.data.page_no ${LAST_PAGE})}}<a id="next" href="/news-{{sw-add page.data.page_no 1}}">Next</a>{{/if}}`,
].join('\n');

async function newProject(playwright: PwFixture, baseURL: string, tag: string) {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const ctx = await seedUser(playwright, baseURL, `${tag}-${stamp}@e2e.test`);
  const res = await ctx.post('/projects', { data: { name: 'Helpers', slug: `${tag}${stamp}` } });
  expect(res.status(), 'creating the project').toBe(201);
  const project = (await res.json()).project as { id: string; slug: string };
  return { ctx, projectId: project.id, slug: project.slug, base: `/projects/${project.id}` };
}

function archiveBundle() {
  return {
    pages: [
      { id: 'home', path: '', title: 'Home', source: '<p>home</p>' },
      { id: 'news', path: 'news', title: 'News', source: ARCHIVE, data: { page_no: 1 } },
      // Archive pages 2..N are SIBLINGS of the root, so their own page.children is empty — they reach
      // the posts by naming the root. That hop is what makes a shared archive template possible at all.
      ...Array.from({ length: LAST_PAGE - 1 }, (_, i) => ({
        id: `news-${i + 2}`,
        path: `news-${i + 2}`,
        title: `News page ${i + 2}`,
        source: ARCHIVE,
        data: { page_no: i + 2 },
      })),
      ...Array.from({ length: POSTS }, (_, i) => ({
        id: `post-${String(i).padStart(3, '0')}`,
        path: `post-${String(i).padStart(3, '0')}`,
        parent: 'news',
        order: (i + 1) * 65_536,
        title: `Post ${String(i).padStart(3, '0')}`,
        source: '<p>body</p>',
      })),
    ],
  };
}

/**
 * The post titles listed on one archive page, in document order.
 *
 * ★ Matches the <ul> by its id with ANY other attributes present. The published page emits the tag
 * verbatim, but the editor's PREVIEW adds its own affordance attributes to the same element — so a
 * literal `<ul id="posts">` finds the list on one surface and silently finds nothing on the other,
 * which reads as "the helper works on the site and not in the editor".
 */
function listed(html: string): string[] {
  const ul = /<ul\b[^>]*\bid="posts"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
  return [...ul.matchAll(/>(Post \d+)</g)].map((m) => m[1]!);
}

test.describe('a paginated archive over 600 child pages', () => {
  test('every page shows its own window, every post appears exactly once', async ({ playwright, baseURL }) => {
    test.setTimeout(300_000);
    const { ctx, base, slug, projectId } = await newProject(playwright, baseURL!, 'arch');

    const imported = await ctx.post(`${base}/import`, { data: archiveBundle() });
    expect(imported.status(), await imported.text()).toBe(200);

    // Without a deploy target the build lands but nothing SERVES it — /sites/<slug>/ 404s.
    await enableLocalHosting(ctx, projectId);
    const published = await ctx.post(`${base}/publish`, { data: {} });
    expect(published.status(), await published.text()).toBe(200);
    // 600 lean children fit the listing budget, so nothing was dropped — the archive is COMPLETE, which
    // is exactly what the old 500 cap made impossible.
    expect((await published.json()).release.childrenTruncated).toBeUndefined();

    const seen: string[] = [];
    for (const n of [1, 2, LAST_PAGE - 1, LAST_PAGE]) {
      const page = await ctx.get(`/sites/${slug}/${n === 1 ? 'news' : `news-${n}`}/`);
      expect(page.status(), `archive page ${n}`).toBe(200);
      const html = await page.text();

      const expected = Array.from({ length: Math.min(PER_PAGE, POSTS - (n - 1) * PER_PAGE) }, (_, i) =>
        `Post ${String((n - 1) * PER_PAGE + i).padStart(3, '0')}`,
      );
      expect(listed(html), `the window on archive page ${n}`).toEqual(expected);
      expect(html).toContain(`page ${n} of ${LAST_PAGE}`);
      // The running "showing X-Y" range is four nested arithmetic calls; a NaN here would be silent.
      expect(html).toContain(`showing ${(n - 1) * PER_PAGE + 1}-${Math.min(n * PER_PAGE, POSTS)}`);
      expect(html, 'no arithmetic may leak NaN/Infinity into the page').not.toMatch(/NaN|Infinity/);
      seen.push(...listed(html));
    }
    expect(new Set(seen).size, 'the sampled windows must not overlap').toBe(seen.length);

    // Prev/next are conditional AND carry a computed page number. Publish rebases internal links, so the
    // href is the portable form of the route the arithmetic produced.
    const first = await (await ctx.get(`/sites/${slug}/news/`)).text();
    expect(first).not.toContain('id="prev"');
    expect(first).toMatch(/id="next" href="(\.\.\/|\/)news-2"/);

    const last = await (await ctx.get(`/sites/${slug}/news-${LAST_PAGE}/`)).text();
    expect(last).toMatch(new RegExp(`id="prev" href="(\\.\\./|/)news-${LAST_PAGE - 1}"`));
    expect(last).not.toContain('id="next"');

    await ctx.dispose();
  });

  test('the EDITOR preview renders the same window as the published page', async ({ playwright, baseURL }) => {
    // The preview is a separate renderer. A helper wired into only one of the two would look right in
    // the editor and be wrong on the site, or the reverse — the failure this project keeps re-learning.
    test.setTimeout(300_000);
    const { ctx, base, slug, projectId } = await newProject(playwright, baseURL!, 'archpv');
    expect((await ctx.post(`${base}/import`, { data: archiveBundle() })).status()).toBe(200);
    await enableLocalHosting(ctx, projectId);
    expect((await ctx.post(`${base}/publish`, { data: {} })).status()).toBe(200);

    const preview = await ctx.post(`${base}/preview`, {
      data: { id: 'news-3', path: 'news-3', title: 'News page 3', source: ARCHIVE, data: { page_no: 3 } },
    });
    expect(preview.status(), await preview.text()).toBe(200);
    // ★ /preview answers with a JSON ENVELOPE, not raw HTML — reading .text() and matching markup
    // against it silently finds nothing, because every attribute quote is backslash-escaped.
    const previewed = listed(((await preview.json()) as { html: string }).html);

    const servedRes = await ctx.get(`/sites/${slug}/news-3/`);
    expect(servedRes.status(), 'the published archive page must be served').toBe(200);
    const served = listed(await servedRes.text());
    expect(previewed).toEqual(served);
    expect(previewed).toHaveLength(PER_PAGE);
    expect(previewed[0]).toBe(`Post ${String(2 * PER_PAGE).padStart(3, '0')}`);

    await ctx.dispose();
  });
});

test.describe('the helpers are discoverable and mistakes are named', () => {
  test('an agent finds them: get_reference and get_guide("templates") carry the new vocabulary', async ({ playwright, baseURL }) => {
    // A capability an agent cannot DISCOVER does not exist — and the shipped instructions used to state
    // outright that the engine has no arithmetic. This reads the surface an agent actually reads, on the
    // deployed container, so a docs change that never made it into the image is caught here.
    test.setTimeout(120_000);
    const { ctx, base } = await newProject(playwright, baseURL!, 'ref');

    const mint = await ctx.post(`${base}/api-keys`, {
      data: { name: 'e2e-ref', role: 'owner', capabilities: ['content:read'], expiresInDays: 1 },
    });
    expect(mint.status(), 'minting a project token').toBe(201);
    const { token } = await mint.json();

    const mcp = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
    });
    try {
      const call = async (name: string, args: Record<string, unknown>): Promise<string> => {
        const res = await mcp.post('/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } });
        expect(res.status(), `MCP ${name}`).toBe(200);
        return res.text();
      };

      const helpers = await call('get_reference', { section: 'helpers' });
      for (const helper of [
        'sw-slice', 'sw-limit', 'sw-offset', 'sw-paginate', 'sw-length',
        'sw-add', 'sw-sub', 'sw-mul', 'sw-div', 'sw-mod',
        'sw-round', 'sw-ceil', 'sw-floor', 'sw-min', 'sw-max',
        'sw-lt', 'sw-gt', 'sw-lte', 'sw-gte',
      ]) {
        expect(helpers, `${helper} must be in the authoring reference an agent reads`).toContain(helper);
      }

      const guide = await call('get_guide', { topic: 'templates' });
      expect(guide, 'the templates guide must carry the paginated-archive recipe').toContain('sw-paginate');
      expect(guide).toContain('_attributes.children');
    } finally {
      await mcp.dispose();
      await ctx.dispose();
    }
  });

  test('a near-miss helper name is rejected at SAVE, and the message names the real one', async ({ playwright, baseURL }) => {
    // Arithmetic existing makes the near-miss NAME likelier, not rarer: `multiply`/`add` are the words
    // an author reaches for, and inside an attribute the render-time marker is invisible.
    test.setTimeout(120_000);
    const { ctx, base } = await newProject(playwright, baseURL!, 'unk');

    const bad = await ctx.put(`${base}/content/page/home`, {
      data: { id: 'home', path: '', title: 'Home', source: '<div data-sw-delay="{{multiply @index 90}}"></div>' },
    });
    expect(bad.status()).toBe(400);
    const message = (await bad.json()).error as string;
    expect(message).toContain('multiply');
    expect(message).toMatch(/sw-mul/);

    // …and the real helper saves.
    const good = await ctx.put(`${base}/content/page/home`, {
      data: { id: 'home', path: '', title: 'Home', source: '<p>{{sw-mul 6 7}}</p>' },
    });
    expect(good.status(), await good.text()).toBe(200);

    await ctx.dispose();
  });
});
