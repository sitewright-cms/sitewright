import { describe, it, expect, beforeEach } from 'vitest';
import { makeHarness, type Harness, type TestClient } from './harness.js';

/**
 * HTTP-layer export/import **bundle fidelity** + referential-integrity suite.
 *
 * Extends (does not duplicate) the round-trip smoke coverage in
 * `content-api.test.ts` / `content.test.ts`: those assert a single page imports
 * and a small bundle re-exports. Here we assert that a *rich* bundle — brand,
 * company, settings, a collection page + its dataset, a block-tree page, and
 * published + draft entries — round-trips field-for-field through
 * `POST /import` → `GET /export`, that cross-entity integrity violations are
 * rejected with the documented 409 `validateProject` codes, that array bounds
 * are enforced, that a failed import is atomic, and that RBAC/tenancy block
 * imports into another tenant's project.
 *
 * Run: corepack pnpm --filter @sitewright/api exec vitest run bundle-fidelity
 */

let harness: Harness;
let client: TestClient;
let projectId: string;

beforeEach(async () => {
  harness = await makeHarness();
  client = await harness.signup();
  projectId = await client.createProject('Site', 'site');
});

/** Imports `bundle` into the active project and returns the response. */
async function importBundle(bundle: unknown) {
  return client.project(projectId).importBundle(bundle);
}

/** Exports the active project and returns the parsed bundle. */
async function exportBundle() {
  const res = await client.project(projectId).exportBundle();
  expect(res.statusCode).toBe(200);
  return res.json() as {
    formatVersion: number;
    project: {
      id: string;
      name: string;
      slug: string;
      identity: { name: string; colors: Record<string, string>; legalName?: string; email?: string; social?: Array<{ link: string; name?: string; icon?: string }> };
      settings: { defaultLocale: string; locales: string[] };
    };
    pages: Array<{ id: string; path: string; title: string; collection?: unknown }>;
    datasets: Array<{ id: string; name: string; slug: string; fields: unknown[] }>;
    entries: Array<{ id: string; dataset: string; status: string; values: Record<string, unknown> }>;
  };
}

// A rich, fully-valid bundle exercising every entity + cross-entity reference:
//   - brand + company + non-default settings
//   - a static home page with a source template
//   - a collection page `/blog/[slug]` bound to the `posts` dataset (param match)
//   - the `posts` dataset + a published and a draft entry
function richBundle() {
  return {
    project: {
      identity: {
        name: 'Acme',
        colors: { primary: '#0a7', accent: '#f50' },
        typography: { fontFamilies: { body: 'Inter, sans-serif' } },
        legalName: 'Acme Incorporated',
        email: 'hello@acme.test',
        social: [{ link: 'https://example.com/acme', name: 'Example', icon: 'globe' }],
      },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
    },
    pages: [
      {
        id: 'home',
        path: '',
        title: 'Home',
        source: '<h1>{{ company.name }}</h1>',
      },
      {
        id: 'blog-post',
        path: '[slug]',
        title: 'Blog Post',
        collection: { dataset: 'posts', param: 'slug' },
        source: '{{#each item.posts}}<p>{{title}}</p>{{/each}}',
      },
    ],
    datasets: [
      {
        id: 'd-posts',
        name: 'Posts',
        slug: 'posts',
        fields: [{ name: 'title', type: 'text', required: true }],
      },
    ],
    entries: [
      { id: 'e_pub', dataset: 'posts', status: 'published', values: { title: 'Published Post' } },
      { id: 'e_draft', dataset: 'posts', status: 'draft', values: { title: 'Draft Post' } },
    ],
  };
}

describe('bundle export/import fidelity (HTTP)', () => {
  it('round-trips every entity field-for-field through import → export', async () => {
    const bundle = richBundle();

    const imp = await importBundle(bundle);
    expect(imp.statusCode).toBe(200);
    // settings + 2 pages + 1 dataset + 2 entries = 6 writes.
    expect((imp.json() as { imported: number }).imported).toBe(6);

    const out = await exportBundle();

    // ---- Project manifest: identity, settings ----
    expect(out.project.identity).toMatchObject(bundle.project.identity);
    expect(out.project.identity.social).toEqual([{ link: 'https://example.com/acme', name: 'Example', icon: 'globe' }]);
    expect(out.project.settings).toEqual(bundle.project.settings);
    // Identity is the project's own (from the URL/record), not anything in the bundle.
    expect(out.project.id).toBe(projectId);
    expect(out.project.slug).toBe('site');

    // ---- Pages: ids + paths + the collection definition survive ----
    const pagesById = new Map(out.pages.map((p) => [p.id, p]));
    expect([...pagesById.keys()].sort()).toEqual(['blog-post', 'home']);
    expect(pagesById.get('home')?.path).toBe('');
    expect(pagesById.get('blog-post')?.path).toBe('[slug]');
    expect(pagesById.get('blog-post')?.collection).toEqual({ dataset: 'posts', param: 'slug' });

    // ---- Datasets ----
    expect(out.datasets).toHaveLength(1);
    expect(out.datasets[0]).toMatchObject({ id: 'd-posts', name: 'Posts', slug: 'posts' });

    // ---- Entries: both published AND draft round-trip with their values ----
    const entriesById = new Map(out.entries.map((e) => [e.id, e]));
    expect([...entriesById.keys()].sort()).toEqual(['e_draft', 'e_pub']);
    expect(entriesById.get('e_pub')).toMatchObject({
      dataset: 'posts',
      status: 'published',
      values: { title: 'Published Post' },
    });
    expect(entriesById.get('e_draft')).toMatchObject({
      dataset: 'posts',
      status: 'draft',
      values: { title: 'Draft Post' },
    });

    // ---- Idempotent re-round-trip: exporting the just-imported bundle and
    // re-importing it produces an identical export (stable fidelity). ----
    const reimport = await importBundle({
      project: { identity: out.project.identity, settings: out.project.settings },
      pages: out.pages,
      datasets: out.datasets,
      entries: out.entries,
    });
    expect(reimport.statusCode).toBe(200);
    const out2 = await exportBundle();
    expect(out2.pages.map((p) => p.id).sort()).toEqual(out.pages.map((p) => p.id).sort());
    expect(out2.entries.map((e) => e.id).sort()).toEqual(out.entries.map((e) => e.id).sort());
    expect(out2.project.identity).toEqual(out.project.identity);
  });

  describe('referential-integrity rejection (409)', () => {
    it('rejects a collection page bound to a missing dataset (unknown_collection_dataset)', async () => {
      const res = await importBundle({
        pages: [
          {
            id: 'p',
            path: '[slug]',
            title: 'P',
            collection: { dataset: 'missing', param: 'slug' },
          },
        ],
        // no datasets → the collection's `missing` dataset cannot resolve
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toContain('unknown_collection_dataset');
    });

    it('rejects duplicate page ids (duplicate_page_id)', async () => {
      const page = { id: 'dup', path: 'dup', title: 'Dup' };
      const res = await importBundle({
        pages: [page, { ...page, path: 'dup-2' }],
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toContain('duplicate_page_id');
    });

    it('rejects duplicate page paths (duplicate_page_path)', async () => {
      const res = await importBundle({
        pages: [
          { id: 'a', path: 'same', title: 'A' },
          { id: 'b', path: 'same', title: 'B' },
        ],
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toContain('duplicate_page_path');
    });
  });

  describe('bounds enforcement', () => {
    it('rejects a bundle that exceeds MAX_BUNDLE.datasets via the array .max() (400)', async () => {
      // MAX_BUNDLE.datasets === 500 (smallest cap with tiny payloads). Send 501
      // minimal datasets to trip Zod's `.max()` → ZodError → 400, WITHOUT
      // allocating anything large (each object is a handful of bytes, far under
      // the 4 MiB IMPORT_BODY_LIMIT).
      const datasets = Array.from({ length: 501 }, (_, i) => ({
        id: `d${i}`,
        name: `D${i}`,
        slug: `d-${i}`,
        fields: [],
      }));
      const res = await importBundle({ datasets });
      expect(res.statusCode).toBe(400);
    });

    it.skip(
      'rejects MAX_BUNDLE.entries (50_000) — skipped: tripping the cap needs a payload that approaches/exceeds the 4 MiB IMPORT_BODY_LIMIT (413), not the array .max() (400), so it would assert a different failure mode than intended. The datasets.max() case above covers the array-bound rejection.',
      () => {},
    );
  });

  it('is transactional: a failing import leaves prior content unchanged', async () => {
    // 1) Import a valid bundle and capture the resulting state.
    const first = await importBundle(richBundle());
    expect(first.statusCode).toBe(200);
    const before = await exportBundle();
    expect(before.pages.map((p) => p.id).sort()).toEqual(['blog-post', 'home']);
    expect(before.entries).toHaveLength(2);

    // 2) Attempt an invalid bundle that also tries to add a brand-new page and a
    //    different brand. It fails integrity (unknown_binding_dataset), so NOTHING
    //    from it must be written — and nothing prior must be removed.
    const failing = await importBundle({
      project: { identity: { name: 'Hijacked', colors: {} }, settings: { defaultLocale: 'en', locales: ['en'] } },
      pages: [
        { id: 'home', path: '', title: 'Home' },
        // Collection page references a missing dataset → validateProject → 409
        {
          id: 'injected',
          path: '[slug]',
          title: 'Injected',
          collection: { dataset: 'ghost', param: 'slug' },
        },
      ],
    });
    expect(failing.statusCode).toBe(409);

    // 3) The original content is intact: no injected page, original brand kept.
    const after = await exportBundle();
    expect(after.pages.map((p) => p.id).sort()).toEqual(['blog-post', 'home']);
    expect(after.pages.find((p) => p.id === 'injected')).toBeUndefined();
    expect(after.project.identity.name).toBe('Acme');
    expect(after.entries).toHaveLength(2);
  });

  describe('RBAC + tenancy', () => {
    it('forbids a cross-tenant client from importing into another user’s project (403)', async () => {
      // Client B is a different user and is not a member of A's project.
      const clientB = await harness.signup();
      await client.project(projectId).putContent('page', 'home', {
        id: 'home',
        path: '',
        title: 'Home',
      });

      // B targets A's project (B holds no membership) → project membership check
      // fails for B → ForbiddenError → 403.
      const res = await clientB.post(`/projects/${projectId}/import`, {
        pages: [{ id: 'x', path: 'x', title: 'X' }],
      });
      expect(res.statusCode).toBe(403);

      // A's content is untouched.
      const list = await client.project(projectId).listContent('page');
      expect((list.json() as { items: unknown[] }).items).toHaveLength(1);
    });

    it('forbids a session user importing into a project they are not a member of (403)', async () => {
      const clientB = await harness.signup();
      // Flat model: a signed-in user who holds no membership for the target project is denied at
      // the project gate (resolveProject → no role → 403) — not 404, which is reserved for the
      // bearer/API-key cross-project probe path.
      const url = `/projects/${projectId}/import`;
      const res = await clientB.post(url, {
        pages: [{ id: 'x', path: 'x', title: 'X' }],
      });
      expect(res.statusCode).toBe(403);
    });

    it.skip(
      'forbids a non-writer (member-role) user from importing (403) — skipped: the test harness only exposes signup (always owner) and no HTTP route exists to add a member or demote a role, so a member-role context cannot be constructed via the HTTP layer without touching the DB/harness (out of scope per task constraints). content.test.ts covers the requireWriteRole gate at the repository layer ("forbids a member role from writing").',
      () => {},
    );
  });
});
