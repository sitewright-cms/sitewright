import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_PAGE_CHILDREN } from '@sitewright/core';
import { makeHarness, type Harness, type TestClient, type ProjectClient } from './harness.js';

// `{{#each page.children}}` is capped at MAX_PAGE_CHILDREN and USED TO SAY NOTHING when it dropped
// the rest: a parent with 831 posts listed 500 and the author had no way to learn the difference —
// the page looked complete. These tests pin the two signals that make the omission visible:
//   • `release.childrenTruncated` — a build-level diagnostic naming the page and both counts
//   • `{{page.childrenTotal}}` — the true count, bindable so the page itself can say "500 of 831"

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

const OVER = 5; // children past the cap — enough to prove truncation without a slow fixture

/** A parent page listing its children, plus `n` child pages under it. */
function tree(n: number, source: string) {
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
    const imported = await project.importBundle(tree(MAX_PAGE_CHILDREN + OVER, '<ul>{{#each page.children}}<li>{{this.title}}</li>{{/each}}</ul>'));
    expect(imported.statusCode).toBe(200);

    const { release } = await publish();

    expect(release.childrenTruncated).toEqual([
      { page: 'blog', shown: MAX_PAGE_CHILDREN, total: MAX_PAGE_CHILDREN + OVER },
    ]);
  });

  it('says nothing when the listing is complete (no noise under the cap)', { timeout: 30_000 }, async () => {
    await project.importBundle(tree(3, '<ul>{{#each page.children}}<li>{{this.title}}</li>{{/each}}</ul>'));

    const { release } = await publish();

    expect(release.childrenTruncated).toBeUndefined();
  });

  it('does not report a page that never LOOPS its children (nothing was dropped from its output)', { timeout: 30_000 }, async () => {
    // The cap only costs an author something when the page actually lists them. A parent with 505
    // children that renders a static body loses nothing, so warning about it would be pure noise.
    await project.importBundle(tree(MAX_PAGE_CHILDREN + OVER, '<p>no listing here</p>'));

    const { release } = await publish();

    expect(release.childrenTruncated).toBeUndefined();
  });

  it('binds the TRUE total as {{page.childrenTotal}} so the page can say "500 of 505"', { timeout: 30_000 }, async () => {
    await project.importBundle(
      tree(MAX_PAGE_CHILDREN + OVER, '<p id="count">{{#each page.children}}{{/each}}showing {{page.children.length}} of {{page.childrenTotal}}</p>'),
    );

    await publish();

    const served = await client.get(`/sites/${slug}/blog/`);
    expect(served.statusCode).toBe(200);
    expect(served.body).toContain(`showing ${MAX_PAGE_CHILDREN} of ${MAX_PAGE_CHILDREN + OVER}`);
  });
});
