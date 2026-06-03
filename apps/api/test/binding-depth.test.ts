import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Entry } from '@sitewright/schema';
import { makeHarness, type Harness, type TestClient, type ProjectClient } from './harness.js';

// Integration coverage for DATASET BINDINGS resolved through the publish pipeline
// at the HTTP layer. Distinct from (and complementary to) the suites it extends:
//
//   - collection-routing.test.ts covers collection PAGES (`/products/[slug]`):
//     one expanded route per published entry, with `route.entry` placed in scope.
//   - datasets.spec.ts (e2e) covers a list binding surfacing in the live PREVIEW.
//
// This suite instead exercises bindings carried DIRECTLY on STATIC-page block
// nodes (`node.binding = { dataset, mode: 'single' | 'list', ... }`) and verifies
// the EXACT renderer mechanics (packages/blocks/src/render.ts + props.ts +
// packages/core/src/bindings.ts) survive a real publish and show up in the
// exported HTML served from `/sites/<projectId>/...`:
//
//   * `mode: 'list'`  -> renderChildren repeats the node's children once per
//     resolved (published-only, ordered) entry, threading each as ctx.entry.
//   * `mode: 'single'` -> ownEntry resolves resolved[0] into scope for the node's
//     own props + children.
//   * `props["<key>Field"]` (textField / hrefField / srcField) -> reads
//     entry.values[<field>] when an entry is in scope (props.ts:fieldValue).
//   * URLs from a bound field are sanitized (safeUrl) and internal root-relative
//     links are rebased page-relative (resolveInternalUrl).
//
// Uses the default IN-PROCESS build runner (no SW_BUILD_WORKER), the shared
// harness, and the public serve route — mirroring publish-api.test.ts.

let harness: Harness;
let publishRoot: string;
let mediaRoot: string;
let client: TestClient;
let project: ProjectClient;
let base: string;
const slug = 'binding-site';

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-binding-pub-'));
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-binding-media-'));
  harness = await makeHarness({ publishRoot, mediaRoot });
  client = await harness.signup();
  const projectId = await client.createProject('Site', slug);
  project = client.project(projectId);
  base = project.base;
});

afterEach(async () => {
  await harness.close();
  await rm(publishRoot, { recursive: true, force: true });
  await rm(mediaRoot, { recursive: true, force: true });
});

// A dataset keyed by slug (id === slug, matching the editor + collection suite).
const postsDataset = {
  id: 'posts',
  name: 'Posts',
  slug: 'posts',
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'order', type: 'number', required: false },
    { name: 'link', type: 'text', required: false },
  ],
};

/** Builds an `entry` row for the `posts` dataset. */
function post(
  id: string,
  values: Record<string, unknown>,
  status: 'draft' | 'published' = 'published',
): Entry {
  return { id, dataset: 'posts', status, values } as Entry;
}

/** Publishes; fails the test on non-200, else returns the parsed body. */
async function publish(): Promise<{ release: { routes: number; bytes: number }; url: string }> {
  const res = await client.post(`${base}/publish`);
  expect(res.statusCode, `publish failed: ${res.body}`).toBe(200);
  return res.json() as { release: { routes: number; bytes: number }; url: string };
}

/** Fetches an exported HTML file from the public serve route (keyed by slug). */
function served(path: string) {
  return harness.app.inject({ method: 'GET', url: `/sites/${slug}/${path}` });
}

/** Counts non-overlapping occurrences of `needle` in `haystack`. */
function count(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let n = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return n;
    n += 1;
    from = at + needle.length;
  }
}

describe('dataset bindings through publish (HTTP layer)', () => {
  it('list binding: a child textField repeats once per PUBLISHED entry, in order, drafts excluded', async () => {
    await project.putContent('dataset', 'posts', postsDataset);
    // Sorted by `order` asc so the rendered sequence is deterministic + assertable.
    await project.putContent('entry', 'p1', post('p1', { title: 'First Post', order: 1 }));
    await project.putContent('entry', 'p2', post('p2', { title: 'Second Post', order: 2 }));
    await project.putContent('entry', 'p3', post('p3', { title: 'Third Post', order: 3 }));
    // A DRAFT entry must NOT appear (resolveBinding excludes drafts when !includeDrafts).
    await project.putContent('entry', 'pd', post('pd', { title: 'Hidden Draft', order: 4 }, 'draft'));

    // Static (non-collection) home page: a Grid bound `list` to `posts`, whose
    // single child Heading binds its text to the entry's `title` field. The Grid
    // node's children render once per resolved entry (renderChildren list branch).
    const listPage = {
      id: 'home',
      path: '/',
      title: 'Posts',
      root: {
        id: 'sec',
        type: 'Section',
        children: [
          {
            id: 'grid',
            type: 'Grid',
            binding: { dataset: 'posts', mode: 'list', query: { sort: { field: 'order', dir: 'asc' } } },
            children: [{ id: 'h', type: 'Heading', props: { level: 2, textField: 'title' } }],
          },
        ],
      },
    };
    await project.putContent('page', listPage.id, listPage);

    const { release } = await publish();
    // A static page expands to exactly one route (the binding repeats CONTENT
    // within that single page, it does NOT fan out routes the way a collection does).
    expect(release.routes).toBe(1);

    const html = (await served('')).body;

    // All three published entries render, each showing its own bound value.
    expect(html).toContain('First Post');
    expect(html).toContain('Second Post');
    expect(html).toContain('Third Post');
    // The draft is excluded entirely.
    expect(html).not.toContain('Hidden Draft');

    // The Heading is repeated exactly once per published entry (3 <h2 ...> tags).
    expect(count(html, '<h2 data-sw-block="Heading">')).toBe(3);

    // Order is preserved (sort: order asc) — First before Second before Third.
    expect(html.indexOf('First Post')).toBeLessThan(html.indexOf('Second Post'));
    expect(html.indexOf('Second Post')).toBeLessThan(html.indexOf('Third Post'));
  });

  it('single binding: places one entry in context for a child textField', async () => {
    await project.putContent('dataset', 'posts', postsDataset);
    // Two published entries; sort makes `single` deterministically pick the first.
    await project.putContent('entry', 'p1', post('p1', { title: 'Alpha Single', order: 1 }));
    await project.putContent('entry', 'p2', post('p2', { title: 'Beta Single', order: 2 }));

    // A Section bound `single` to posts: ownEntry resolves resolved[0] into scope,
    // and that entry threads down to the child Heading's textField.
    const singlePage = {
      id: 'home',
      path: '/',
      title: 'Featured',
      root: {
        id: 'sec',
        type: 'Section',
        binding: { dataset: 'posts', mode: 'single', query: { sort: { field: 'order', dir: 'asc' } } },
        children: [{ id: 'h', type: 'Heading', props: { level: 1, textField: 'title' } }],
      },
    };
    await project.putContent('page', singlePage.id, singlePage);

    await publish();
    const html = (await served('')).body;

    // Exactly the FIRST entry (order asc) is in scope — one entry, not a repeat.
    expect(html).toContain('Alpha Single');
    expect(html).not.toContain('Beta Single');
    expect(count(html, '<h1 data-sw-block="Heading">')).toBe(1);
  });

  it('nested binding: a list binding whose child also resolves a field (and a deeper static child) renders correctly', async () => {
    await project.putContent('dataset', 'posts', postsDataset);
    await project.putContent('entry', 'p1', post('p1', { title: 'Nested One', order: 1 }));
    await project.putContent('entry', 'p2', post('p2', { title: 'Nested Two', order: 2 }));

    // Grid(list) -> Card -> Heading(textField). The bound entry threads through the
    // non-binding Card wrapper into the deeper Heading, proving context propagates
    // down the subtree (ctx.entry is forwarded by renderChildren's non-list branch).
    const nestedPage = {
      id: 'home',
      path: '/',
      title: 'Nested',
      root: {
        id: 'sec',
        type: 'Section',
        children: [
          {
            id: 'grid',
            type: 'Grid',
            binding: { dataset: 'posts', mode: 'list', query: { sort: { field: 'order', dir: 'asc' } } },
            children: [
              {
                id: 'card',
                type: 'Card',
                children: [
                  { id: 'h', type: 'Heading', props: { level: 3, textField: 'title' } },
                  // A purely-static child inside the repeated subtree must render
                  // once per entry too (no binding, uses literal prop).
                  { id: 'tag', type: 'RichText', props: { text: 'Read more' } },
                ],
              },
            ],
          },
        ],
      },
    };
    await project.putContent('page', nestedPage.id, nestedPage);

    await publish();
    const html = (await served('')).body;

    expect(html).toContain('Nested One');
    expect(html).toContain('Nested Two');
    // The Card subtree repeats once per published entry.
    expect(count(html, '<div data-sw-block="Card">')).toBe(2);
    expect(count(html, '<h3 data-sw-block="Heading">')).toBe(2);
    // The static descendant repeats per entry as well.
    expect(count(html, 'Read more')).toBe(2);
    expect(html.indexOf('Nested One')).toBeLessThan(html.indexOf('Nested Two'));
  });

  it('urlField: a Link href resolves from the entry, is sanitized, and internal links are rebased page-relative', async () => {
    await project.putContent('dataset', 'posts', postsDataset);
    // One entry with a SAFE internal root-relative link; one with an UNSAFE scheme.
    await project.putContent(
      'entry',
      'p1',
      post('p1', { title: 'Internal Link Post', order: 1, link: '/about' }),
    );
    await project.putContent(
      'entry',
      'p2',
      post('p2', { title: 'Evil Link Post', order: 2, link: 'javascript:alert(1)' }),
    );

    // A one-level-deep STATIC page (slug "blog") so relativeRoot is "../" and we can
    // assert the internal link rebase. The Link binds BOTH its text and its href to
    // entry fields (textField=title, hrefField=link -> urlProp reads key 'href').
    const linkPage = {
      id: 'blog',
      path: '/blog',
      title: 'Blog',
      root: {
        id: 'sec',
        type: 'Section',
        children: [
          {
            id: 'grid',
            type: 'Grid',
            binding: { dataset: 'posts', mode: 'list', query: { sort: { field: 'order', dir: 'asc' } } },
            children: [{ id: 'lnk', type: 'Link', props: { textField: 'title', hrefField: 'link' } }],
          },
        ],
      },
    };
    await project.putContent('page', linkPage.id, linkPage);

    await publish();
    // The static page lives at /blog -> blog/index.html, served at /sites/<id>/blog/.
    const res = await served('blog/');
    expect(res.statusCode).toBe(200);
    const html = res.body;

    expect(html).toContain('Internal Link Post');
    expect(html).toContain('Evil Link Post');

    // The internal "/about" is rebased page-relative for the one-segment slug "blog":
    // relativeRoot("blog") === "../", so "/about" -> "../about". The raw root-relative
    // form must NOT survive.
    expect(html).toContain('href="../about"');
    expect(html).not.toContain('href="/about"');

    // The unsafe javascript: URL is rejected by safeUrl and falls back to "#".
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
  });

  it('empty/missing: a binding to a dataset with no published entries renders nothing (no crash); a missing field renders empty', async () => {
    await project.putContent('dataset', 'posts', postsDataset);
    // `empties` is a SEPARATE dataset whose only entry is a draft, so its PUBLISHED
    // pool is genuinely empty — the list binding below has nothing to repeat.
    await project.putContent('dataset', 'empties', { ...postsDataset, id: 'empties', name: 'Empties', slug: 'empties' });
    await project.putContent('entry', 'ed', { id: 'ed', dataset: 'empties', status: 'draft', values: { title: 'Only Draft', order: 1 } });
    // A single PUBLISHED `posts` entry that LACKS the `missing` field referenced in (b).
    await project.putContent('entry', 'p1', post('p1', { title: 'Has Title', order: 2 }));

    const emptyPage = {
      id: 'home',
      path: '/',
      title: 'Empty',
      root: {
        id: 'sec',
        type: 'Section',
        children: [
          // (a) List bound to `empties`, which has ZERO published entries -> renders
          //     zero Headings. (Markers bracket the region to prove the page itself rendered.)
          { id: 'mark1', type: 'RichText', props: { text: 'BEFORE-LIST' } },
          {
            id: 'emptyGrid',
            type: 'Grid',
            binding: { dataset: 'empties', mode: 'list', query: { sort: { field: 'order', dir: 'asc' } } },
            children: [{ id: 'h1', type: 'Heading', props: { level: 2, textField: 'title' } }],
          },
          { id: 'mark2', type: 'RichText', props: { text: 'AFTER-LIST' } },
          // (b) Single binding picks the one published `posts` entry, but the Heading
          //     binds a textField the entry does NOT have -> empty text (no crash).
          {
            id: 'singleSec',
            type: 'Section',
            binding: { dataset: 'posts', mode: 'single' },
            children: [{ id: 'h2', type: 'Heading', props: { level: 3, textField: 'missing' } }],
          },
        ],
      },
    };
    await project.putContent('page', emptyPage.id, emptyPage);

    // Must publish cleanly (no crash) and produce exactly one route.
    const { release } = await publish();
    expect(release.routes).toBe(1);

    const res = await served('');
    expect(res.statusCode).toBe(200);
    const html = res.body;

    // The page itself rendered (markers present, draft excluded).
    expect(html).toContain('BEFORE-LIST');
    expect(html).toContain('AFTER-LIST');
    expect(html).not.toContain('Only Draft');

    // (a) Empty published pool -> the list child (the <h2> Heading) renders ZERO times.
    expect(count(html, '<h2 data-sw-block="Heading">')).toBe(0);

    // (b) The single-bound Heading exists exactly once but is EMPTY (missing field
    //     -> textProp falls back to '' -> empty <h3>). It also must NOT leak the
    //     entry's actual `title` value, since the binding referenced `missing`.
    expect(html).toContain('<h3 data-sw-block="Heading"></h3>');
    expect(html).not.toContain('Has Title');
  });
});
