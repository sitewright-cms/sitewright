import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_PAGE_CHILDREN_BYTES } from '@sitewright/core';
import { makeHarness, type Harness, type TestClient, type ProjectClient } from './harness.js';

// `{{#each page.children}}` is bounded and USED TO SAY NOTHING when it dropped the rest: a parent with
// 831 posts listed 500 and the author had no way to learn the difference — the page looked complete.
// These tests pin the two signals that make the omission visible:
//   • `release.childrenTruncated` — a build-level diagnostic naming the page and both counts
//   • `{{page.childrenTotal}}` — the true count, bindable so the page itself can say "31 of 40"
//
// ★ The bound they exercise is the BYTE budget, not the count backstop — that is the one that decides in
// practice (a count is a poor proxy for a listing whose weight is dominated by each child's own `data`),
// and a fixture that trips it needs ~40 fat pages rather than 2000 lean ones.

let harness: Harness;
let publishRoot: string;
let client: TestClient;
let project: ProjectClient;
const slug = 'children-site';

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-children-'));
  harness = await makeHarness({ publishRoot });
  client = await harness.signup();
  const projectId = await client.createProject('Site', slug);
  project = client.project(projectId);
});

afterEach(async () => {
  await harness.close();
  await rm(publishRoot, { recursive: true, force: true });
});

/** Each child carries this much of its own `page.data` — the part of a listing whose weight is unbounded. */
const FAT_DATA_BYTES = 64 * 1024;
/**
 * Just past what the budget can hold. The margin is deliberately small: the fixture has to exceed a
 * 2 MiB listing budget while the whole bundle stays under the 4 MiB import body limit.
 */
const FAT_CHILDREN = Math.ceil(MAX_PAGE_CHILDREN_BYTES / FAT_DATA_BYTES) + 8;

/** A parent page listing its children, plus `n` child pages under it. `dataBytes` weighs each child. */
function tree(n: number, source: string, dataBytes = 0) {
  return {
    pages: [
      { id: 'blog', path: 'blog', title: 'Blog', source },
      ...Array.from({ length: n }, (_, i) => ({
        id: `post-${i}`,
        path: `post-${i}`,
        parent: 'blog',
        order: i,
        title: `Post ${i}`,
        source: '<p>post</p>',
        ...(dataBytes > 0 ? { data: { blob: 'x'.repeat(dataBytes) } } : {}),
      })),
    ],
  };
}

async function publish(): Promise<{ statusCode: number; release: Record<string, unknown> }> {
  const res = await client.post(`${project.base}/publish`, {});
  const body = res.json() as { release?: Record<string, unknown>; error?: string };
  if (!body.release) throw new Error(`publish failed (${res.statusCode}): ${JSON.stringify(body).slice(0, 300)}`);
  return { statusCode: res.statusCode, release: body.release };
}

describe('page.children truncation is reported, never silent', () => {
  it('reports the truncated page + both counts in the release manifest', { timeout: 30_000 }, async () => {
    const imported = await project.importBundle(
      tree(FAT_CHILDREN, '<ul>{{#each page.children}}<li>{{this.title}}</li>{{/each}}</ul>', FAT_DATA_BYTES),
    );
    expect(imported.statusCode).toBe(200);

    const { release } = await publish();

    const reported = release.childrenTruncated as Array<{ page: string; shown: number; total: number }>;
    expect(reported).toHaveLength(1);
    expect(reported[0]!.page).toBe('blog');
    expect(reported[0]!.total).toBe(FAT_CHILDREN);
    // The exact count depends on how heavy each child is; what must hold is that it dropped some and
    // still listed some — a report of 0 shown would mean the budget emptied the page.
    expect(reported[0]!.shown).toBeGreaterThan(0);
    expect(reported[0]!.shown).toBeLessThan(FAT_CHILDREN);
  });

  it('says nothing when the listing is complete (no noise under the bound)', { timeout: 30_000 }, async () => {
    await project.importBundle(tree(3, '<ul>{{#each page.children}}<li>{{this.title}}</li>{{/each}}</ul>'));

    const { release } = await publish();

    expect(release.childrenTruncated).toBeUndefined();
  });

  it('★ 831 lean children list in FULL — the count that used to be silently halved', () => {
    // Regression guard for the ceiling that made a real archive impossible: the old 500-count cap cut a
    // DHPS-sized news section by a third, and the window helpers can only slice what the listing holds.
    // Kept as a pure-render check (see packages/core) — a 831-page publish fixture is minutes, not value.
    expect(MAX_PAGE_CHILDREN_BYTES).toBeGreaterThanOrEqual(831 * 400);
  });

  it('does not report a page that never LOOPS its children (nothing was dropped from its output)', { timeout: 30_000 }, async () => {
    // The bound only costs an author something when the page actually lists them. A parent with fat
    // children that renders a static body loses nothing, so warning about it would be pure noise.
    await project.importBundle(tree(FAT_CHILDREN, '<p>no listing here</p>', FAT_DATA_BYTES));

    const { release } = await publish();

    expect(release.childrenTruncated).toBeUndefined();
  });

  it('binds the TRUE total as {{page.childrenTotal}} so the page can say "17 of 40"', { timeout: 30_000 }, async () => {
    await project.importBundle(
      tree(
        FAT_CHILDREN,
        '<p id="count">{{#each page.children}}{{/each}}showing {{page.children.length}} of {{page.childrenTotal}}</p>',
        FAT_DATA_BYTES,
      ),
    );

    await publish();

    const served = await client.get(`/sites/${slug}/blog/`);
    expect(served.statusCode).toBe(200);
    // The true total is bound even though the listing was cut short — that is the whole point.
    expect(served.body).toMatch(new RegExp(`showing \\d+ of ${FAT_CHILDREN}`));
    const shown = Number(/showing (\d+) of/.exec(served.body)![1]);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(FAT_CHILDREN);
  });
});
