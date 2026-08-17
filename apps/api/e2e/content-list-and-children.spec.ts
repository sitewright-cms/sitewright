import { test, expect, type PlaywrightWorkerArgs } from '@playwright/test';
import { seedUser } from './helpers.js';

type PwFixture = PlaywrightWorkerArgs['playwright'];

/**
 * The three list/build changes, pinned against the DEPLOYED container rather than an in-process app:
 *
 *  1. `page.children` truncation is REPORTED (`release.childrenTruncated`) and the true count is
 *     bindable as `{{page.childrenTotal}}` — on the published page AND in the editor's live preview,
 *     which is a different renderer and cannot be reached from the unit harness at all (it needs a
 *     render pool).
 *  2. The content list supports `?q=`, and `?dataset=` now composes with `?limit=` — the combination
 *     that used to be refused with a 400.
 *  3. A repeated publish of unchanged content produces byte-identical output, which is the property
 *     the minify/validate memoization must not break.
 */

// Mirrors packages/core (the E2E build has no import of the constants). The bound that decides in
// practice is the SERIALIZED SIZE of a listing, not the 2000-child backstop — each child carries its own
// `page.data`, so weight per child varies by orders of magnitude.
const MAX_PAGE_CHILDREN_BYTES = 2 * 1024 * 1024;
/** Each child's own data. 64 KiB x 40 children exceeds the budget while staying under the 4 MiB import. */
const FAT_DATA_BYTES = 64 * 1024;
const FAT_CHILDREN = Math.ceil(MAX_PAGE_CHILDREN_BYTES / FAT_DATA_BYTES) + 8;

async function newProject(playwright: PwFixture, baseURL: string, tag: string) {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const ctx = await seedUser(playwright, baseURL, `${tag}-${stamp}@e2e.test`);
  const res = await ctx.post('/projects', { data: { name: 'List', slug: `${tag}${stamp}` } });
  expect(res.status(), 'creating the project').toBe(201);
  const project = (await res.json()).project as { id: string; slug: string };
  return { ctx, projectId: project.id, slug: project.slug, base: `/projects/${project.id}` };
}

test.describe('page.children truncation is visible', () => {
  test('reports the cut in the release manifest and binds the true total on both renderers', async ({ playwright, baseURL }) => {
    test.setTimeout(180_000);
    const { ctx, base } = await newProject(playwright, baseURL!, 'kids');
    const source = '<p id="count">{{#each page.children}}{{/each}}showing {{page.children.length}} of {{page.childrenTotal}}</p>';

    const imported = await ctx.post(`${base}/import`, {
      data: {
        pages: [
          { id: 'blog', path: 'blog', title: 'Blog', source },
          ...Array.from({ length: FAT_CHILDREN }, (_, i) => ({
            id: `post-${i}`,
            path: `post-${i}`,
            parent: 'blog',
            order: i,
            title: `Post ${i}`,
            source: '<p>post</p>',
            data: { blob: 'x'.repeat(FAT_DATA_BYTES) },
          })),
        ],
      },
    });
    expect(imported.status(), await imported.text()).toBe(200);

    const published = await ctx.post(`${base}/publish`, { data: {} });
    expect(published.status()).toBe(200);
    const release = (await published.json()).release as { childrenTruncated?: Array<{ page: string; shown: number; total: number }> };

    const cut = release.childrenTruncated;
    expect(cut, 'the build must name the page whose listing was cut').toHaveLength(1);
    expect(cut![0]!.page).toBe('blog');
    expect(cut![0]!.total).toBe(FAT_CHILDREN);
    // How many fit depends on each child's weight; what must hold is that some were dropped and some
    // listed — a report of 0 shown would mean the budget emptied the page instead of trimming it.
    expect(cut![0]!.shown).toBeGreaterThan(0);
    expect(cut![0]!.shown).toBeLessThan(FAT_CHILDREN);

    // The EDITOR's live preview is a separate render path; a binding wired into only one of the two
    // renders empty in the editor and populated on the live site.
    const preview = await ctx.post(`${base}/preview`, { data: { id: 'blog', path: 'blog', title: 'Blog', source } });
    expect(preview.status(), await preview.text()).toBe(200);
    const previewHtml = await preview.text();
    expect(previewHtml).toMatch(new RegExp(`showing \\d+ of ${FAT_CHILDREN}`));
    expect(previewHtml, 'the preview must agree with the published build').toContain(`showing ${cut![0]!.shown} of ${FAT_CHILDREN}`);

    await ctx.dispose();
  });

  test('★ a 600-post archive lists in FULL — the 500-cap that used to halve it silently', async ({ playwright, baseURL }) => {
    // The old count cap was a ceiling on a whole feature: a real news section (DHPS: 831 posts) listed
    // 500 and every archive page past the 50th rendered empty, because a window can only slice what the
    // listing contains. Lean children now list in full, bounded by SIZE rather than an arbitrary count.
    test.setTimeout(180_000);
    const { ctx, base } = await newProject(playwright, baseURL!, 'kidsfull');
    const POSTS = 600;

    const imported = await ctx.post(`${base}/import`, {
      data: {
        pages: [
          { id: 'blog', path: 'blog', title: 'Blog', source: '<p id="count">listed {{sw-length page.children}} of {{page.childrenTotal}}</p>' },
          ...Array.from({ length: POSTS }, (_, i) => ({
            id: `post-${i}`,
            path: `post-${i}`,
            parent: 'blog',
            order: i,
            title: `Post ${i}`,
            source: '<p>post</p>',
          })),
        ],
      },
    });
    expect(imported.status(), await imported.text()).toBe(200);

    const published = await ctx.post(`${base}/publish`, { data: {} });
    expect(published.status()).toBe(200);
    const release = (await published.json()).release as { childrenTruncated?: unknown };
    expect(release.childrenTruncated, 'nothing was dropped, so nothing should be reported').toBeUndefined();

    const preview = await ctx.post(`${base}/preview`, {
      data: { id: 'blog', path: 'blog', title: 'Blog', source: '<p id="count">listed {{sw-length page.children}} of {{page.childrenTotal}}</p>' },
    });
    expect(preview.status(), await preview.text()).toBe(200);
    expect(await preview.text()).toContain(`listed ${POSTS} of ${POSTS}`);

    await ctx.dispose();
  });
});

test.describe('content list query parameters', () => {
  test('searches, scopes to a dataset, and composes the two with pagination', async ({ playwright, baseURL }) => {
    test.setTimeout(120_000);
    const { ctx, base } = await newProject(playwright, baseURL!, 'lq');

    const imported = await ctx.post(`${base}/import`, {
      data: {
        pages: [
          { id: 'home', path: '', title: 'Home', source: '<p>h</p>' },
          { id: 'about', path: 'about-us', title: 'About the studio', source: '<p>a</p>' },
          { id: 'odd', path: 'odd', title: '100% cotton_shirt', source: '<p>o</p>' },
        ],
        datasets: [
          { id: 'news', name: 'News', slug: 'news', fields: [{ name: 'title', type: 'text' }] },
          { id: 'shop', name: 'Shop', slug: 'shop', fields: [{ name: 'title', type: 'text' }] },
        ],
        entries: [
          { id: 'n_1', dataset: 'news', status: 'published', values: { title: 'Sports day' } },
          { id: 'n_2', dataset: 'news', status: 'published', values: { title: 'Choir concert' } },
          { id: 'n_3', dataset: 'news', status: 'published', values: { title: 'Sports awards' } },
          { id: 's_1', dataset: 'shop', status: 'published', values: { title: 'Sports shirt' } },
        ],
      },
    });
    expect(imported.status(), await imported.text()).toBe(200);

    const idsOf = async (query: string): Promise<string[]> => {
      const res = await ctx.get(`${base}/content/${query}`);
      expect(res.status(), `${query} → ${await res.text()}`).toBe(200);
      return ((await res.json()).items as Array<{ id: string }>).map((i) => i.id).sort();
    };

    expect(await idsOf('page?q=studio')).toEqual(['about']);
    // A LIKE wildcard in the query must be a literal, not a match-everything.
    expect(await idsOf('page?q=100%25')).toEqual(['odd']);
    expect(await idsOf('entry?q=sports')).toEqual(['n_1', 'n_3', 's_1']);
    expect(await idsOf('entry?dataset=news&q=sports')).toEqual(['n_1', 'n_3']);

    // The combination that used to be a 400.
    const paged = await ctx.get(`${base}/content/entry?dataset=news&limit=2`);
    expect(paged.status()).toBe(200);
    const body = (await paged.json()) as { items: Array<{ dataset: string }>; total: number };
    expect(body.items).toHaveLength(2);
    expect(body.items.every((e) => e.dataset === 'news')).toBe(true);
    expect(body.total, 'the total must count the DATASET, not the kind').toBe(3);

    // Summaries drop the heavy body but keep the descriptor an editor needs to tell "has own code".
    const summary = await ctx.get(`${base}/content/page?summary=1`);
    expect(summary.status()).toBe(200);
    const rows = (await summary.json()).items as Array<{ id: string; source?: string; _summary?: { omitted?: { source?: { bytes: number } } } }>;
    const about = rows.find((r) => r.id === 'about')!;
    expect(about.source, 'the body must be omitted').toBeUndefined();
    expect(about._summary?.omitted?.source?.bytes, '…and described instead').toBeGreaterThan(0);

    await ctx.dispose();
  });
});

test.describe('build output stability', () => {
  test('publishes byte-identical output twice (the memoized minify/validate must not drift)', async ({ playwright, baseURL }) => {
    test.setTimeout(120_000);
    const { ctx, base, slug } = await newProject(playwright, baseURL!, 'stable');
    // A build is only SERVED at /sites/<slug>/ when a local deploy target exists.
    const target = await ctx.post(`${base}/deploy-targets`, { data: { name: 'Local Hosting', protocol: 'local' } });
    expect(target.status(), await target.text()).toBe(201);

    await ctx.post(`${base}/import`, {
      data: {
        pages: [
          { id: 'home', path: '', title: 'Home', source: '<h1 class="text-3xl">Home</h1>' },
          { id: 'two', path: 'two', title: 'Two', source: '<article class="prose"><p>two</p></article>' },
        ],
      },
    });

    const publish = async (): Promise<string> => {
      const res = await ctx.post(`${base}/publish`, { data: {} });
      expect(res.status(), await res.text()).toBe(200);
      const served = await ctx.get(`/sites/${slug}/two/`);
      expect(served.status()).toBe(200);
      return served.text();
    };

    const first = await publish();
    const second = await publish();
    expect(second, 'a rebuild of unchanged content must not change a byte').toBe(first);

    await ctx.dispose();
  });
});
