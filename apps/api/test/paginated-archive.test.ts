import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient, type ProjectClient } from './harness.js';

/**
 * A PAGINATED ARCHIVE, end to end through a real publish.
 *
 * This is the shape the window + arithmetic helpers were built for, and the one the engine could not
 * express at all: a news section whose posts are real pages (each with its own URL, SEO and revisions),
 * listed ten at a time across a run of archive pages that all share ONE template.
 *
 * The piece that makes it work across pages is `pages.<slug>._attributes.children` — an archive page
 * cannot reach the posts through `page.children` (they are not ITS children), but it can name the
 * archive root and read its listing. Every archive page then differs only by a `page.data.page_no`.
 */

let harness: Harness;
let publishRoot: string;
let client: TestClient;
let project: ProjectClient;
const slug = 'archive-site';

const POSTS = 25;
const PER_PAGE = 10;
const LAST_PAGE = Math.ceil(POSTS / PER_PAGE);

// One template, rendered by every archive page. `page_no` is the only thing that differs between them.
const ARCHIVE = [
  '<ul id="posts">',
  `{{#each (sw-paginate pages.news._attributes.children page.data.page_no ${PER_PAGE})}}`,
  '<li><a href="{{sw-url path}}">{{title}}</a></li>',
  '{{/each}}',
  '</ul>',
  // The page count is arithmetic over the true length — the "N of M" an archive needs.
  `<p id="meta">page {{page.data.page_no}} of {{sw-ceil (sw-div (sw-length pages.news._attributes.children) ${PER_PAGE})}}</p>`,
  // A conditional next link, with the page number computed INTO the href. The URL-attribute rule allows
  // this because the literal prefix "/news-" already fixes the scheme.
  `{{#if (sw-lt page.data.page_no ${LAST_PAGE})}}<a id="next" href="/news-{{sw-add page.data.page_no 1}}">Next</a>{{/if}}`,
].join('\n');

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-archive-'));
  harness = await makeHarness({ publishRoot });
  client = await harness.signup();
  const projectId = await client.createProject('Site', slug);
  project = client.project(projectId);
});

afterEach(async () => {
  await harness.close();
  await rm(publishRoot, { recursive: true, force: true });
});

function bundle() {
  return {
    pages: [
      { id: 'home', path: '', title: 'Home', source: '<p>home</p>' },
      { id: 'news', path: 'news', title: 'News', source: ARCHIVE, data: { page_no: 1 } },
      // The further archive pages are SIBLINGS, so their own `page.children` is empty — they reach the
      // posts through the archive root by name.
      ...Array.from({ length: LAST_PAGE - 1 }, (_, i) => ({
        id: `news-${i + 2}`,
        path: `news-${i + 2}`,
        title: `News page ${i + 2}`,
        source: ARCHIVE,
        data: { page_no: i + 2 },
      })),
      ...Array.from({ length: POSTS }, (_, i) => ({
        id: `post-${String(i).padStart(2, '0')}`,
        path: `post-${String(i).padStart(2, '0')}`,
        parent: 'news',
        order: (i + 1) * 65_536,
        title: `Post ${String(i).padStart(2, '0')}`,
        source: '<p>body</p>',
      })),
    ],
  };
}

/** The post titles listed on one archive page, in order. */
function listed(html: string): string[] {
  const ul = /<ul id="posts">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
  return [...ul.matchAll(/>(Post \d+)</g)].map((m) => m[1]!);
}

describe('a paginated archive over child PAGES', () => {
  it('gives each archive page its own window of posts, in order, with no gaps or repeats', { timeout: 60_000 }, async () => {
    const imported = await project.importBundle(bundle());
    expect(imported.statusCode, imported.body).toBe(200);
    const res = await client.post(`${project.base}/publish`, {});
    expect((res.json() as { release?: unknown }).release, res.body.slice(0, 400)).toBeTruthy();

    const seen: string[] = [];
    for (let n = 1; n <= LAST_PAGE; n += 1) {
      const path = n === 1 ? 'news' : `news-${n}`;
      const served = await client.get(`/sites/${slug}/${path}/`);
      expect(served.statusCode, path).toBe(200);
      const titles = listed(served.body);

      // The window is exactly the slice this page number asks for…
      const expected = Array.from({ length: Math.min(PER_PAGE, POSTS - (n - 1) * PER_PAGE) }, (_, i) =>
        `Post ${String((n - 1) * PER_PAGE + i).padStart(2, '0')}`,
      );
      expect(titles, `archive page ${n}`).toEqual(expected);

      // …and the computed page count is the same on every page.
      expect(served.body).toContain(`page ${n} of ${LAST_PAGE}`);
      seen.push(...titles);
    }

    // Every post appears exactly once across the whole archive — the property a hand-checked page cannot
    // establish, and the one an off-by-one in the window would break.
    expect(seen).toHaveLength(POSTS);
    expect(new Set(seen).size).toBe(POSTS);
  });

  it('links to the NEXT page with a computed number, and stops at the last one', { timeout: 60_000 }, async () => {
    await project.importBundle(bundle());
    await client.post(`${project.base}/publish`, {});

    const first = await client.get(`/sites/${slug}/news/`);
    // The number was computed INTO the href, and publish then rebased that route like any other
    // internal link (root-relative "/news-2" → the portable "../news-2") — so the arithmetic landed
    // before rebasing, not as leftover template text.
    expect(first.body).toMatch(/href="(\.\.\/|\/)news-2"/);

    const last = await client.get(`/sites/${slug}/news-${LAST_PAGE}/`);
    expect(last.statusCode).toBe(200);
    // The conditional held: no next link, and — critically — no `NaN`/`Infinity` leaked into an href.
    expect(last.body).not.toContain('id="next"');
    expect(last.body).not.toMatch(/NaN|Infinity/);
  });
});
