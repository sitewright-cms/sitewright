import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { content } from '../src/db/schema.js';
import { newId } from '../src/id.js';

/**
 * The two reporting routes that back the File Manager's "unused files" modal and the per-project
 * storage reading. Driven over HTTP because the interesting part is the wiring — the scan and the
 * measurement have their own unit suites.
 */

let harness: Harness;
let client: TestClient;
let projectId: string;
let slug: string;
let roots: { mediaRoot: string; publishRoot: string; previewRoot: string; sourceRefRoot: string };

async function put(store: keyof typeof roots, bytes: number) {
  const dir = join(roots[store], slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'blob'), 'x'.repeat(bytes));
}

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'sw-storage-routes-'));
  roots = {
    mediaRoot: join(base, 'media'),
    publishRoot: join(base, 'sites'),
    previewRoot: join(base, 'preview'),
    sourceRefRoot: join(base, 'source-refs'),
  };
  harness = await makeHarness(roots);
  client = await harness.signup({ admin: true });
  slug = `s${Date.now().toString(36)}`;
  projectId = await client.createProject('Site', slug);
});

describe('GET /projects/:id/storage', () => {
  it('reports each store separately, and which of it is derived', async () => {
    await put('mediaRoot', 1000);
    await put('publishRoot', 200);
    await put('previewRoot', 30);
    await put('sourceRefRoot', 4);

    const res = await client.get(`/projects/${projectId}/storage`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, number>;
    expect(body).toMatchObject({ media: 1000, build: 200, preview: 30, sourceRefs: 4, total: 1234 });
    // `derived` is what the sweeps can reclaim without anyone republishing or re-importing — media
    // is the author's own upload and is NOT in it.
    expect(body.derived).toBe(234);
  });

  it('reports zeros for a project that has written nothing', async () => {
    const body = (await client.get(`/projects/${projectId}/storage`)).json() as Record<string, number>;
    expect(body).toMatchObject({ media: 0, build: 0, preview: 0, sourceRefs: 0, total: 0, derived: 0 });
  });
});

describe('GET /projects/:id/media/unused', () => {
  /**
   * The media row is planted directly. The upload pipeline wants real image bytes, and this test is
   * about the ROUTE's wiring — the scan itself has its own suite (media-usage.test.ts).
   */
  const plant = async (id: string, filename: string) =>
    harness.db.insert(content).values({
      id: newId(),
      projectId,
      kind: 'media',
      entityId: id,
      scope: '',
      data: { id, kind: 'image', format: 'png', filename, url: `/media/${slug}/${id}-${filename}`, bytes: 64 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  it('reports an asset nothing refers to, with what the scan covered', async () => {
    await plant('lonely', 'lonely.png');

    const res = await client.get(`/projects/${projectId}/media/unused`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string }>; scanned: Record<string, number> };
    expect(body.items.map((i) => i.id)).toEqual(['lonely']);
    // The UI shows the reach of the scan rather than asking to be trusted.
    expect(body.scanned).toHaveProperty('contentRows');
    expect(body.scanned).toHaveProperty('revisionRows');
    expect(body.scanned.assets).toBe(1);
  });

  it('leaves an asset a page refers to out of the list', async () => {
    await plant('used11', 'used.png');
    await client.put(`/projects/${projectId}/content/page/home`, {
      id: 'home',
      path: '',
      title: 'Home',
      source: `<img src="/media/${slug}/used11-used.png">`,
    });
    const body = (await client.get(`/projects/${projectId}/media/unused`)).json() as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it('says nothing is unused when the project has no media at all', async () => {
    const body = (await client.get(`/projects/${projectId}/media/unused`)).json() as { items: unknown[] };
    expect(body.items).toEqual([]);
  });
});
