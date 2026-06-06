import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Integration coverage for reusable PARTIALS at the HTTP layer: creation via the
// content API, reference from a page's block tree (`PageNode.partialRef`),
// expansion through publish (the in-process build runs `resolvePartials` via
// `allRoutes` in `buildSite`), and rejection of cycles / unknown references.
//
// Partial-reference mechanism (verified from packages/schema/src/block.ts +
// packages/core/src/partials.ts): a page node carries an OPTIONAL string field
// `partialRef` holding a partial's id. At build time `resolvePartials` replaces
// that node wholesale with the referenced partial's `root` subtree (only the
// host node's `id` is preserved). Partials may reference other partials, so
// expansion is recursive. There is NO dedicated `PartialRef` node *type* — any
// node `type` may carry `partialRef`; conventionally a placeholder `Slot`.
//
// This file COMPLEMENTS the unit-level packages/core/test/partials.test.ts
// (pure resolver) and apps/api/test/content-api.test.ts (generic CRUD) by
// exercising the full HTTP path: PUT content/partial → publish → served HTML.

let harness: Harness;
let publishRoot: string;

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-partials-'));
  harness = await makeHarness({ publishRoot });
});

afterEach(async () => {
  await harness.close();
  await rm(publishRoot, { recursive: true, force: true });
});

/** A reusable partial body for the `content/partial/<id>` route. */
function partial(id: string, root: Record<string, unknown>) {
  return { id, name: `Partial ${id}`, root };
}

/** A page that references `partialId` through a placeholder `Slot` node. */
function pageWithPartialRef(
  id: string,
  path: string,
  partialId: string,
  hostId = `host-${id}`,
) {
  return {
    id,
    path,
    title: `Page ${id}`,
    root: {
      id: `r-${id}`,
      type: 'Section',
      children: [{ id: hostId, type: 'Slot', partialRef: partialId }],
    },
  };
}

/** Publishes the project and returns the publish response. */
async function publish(client: TestClient, projectId: string) {
  return client.post(`${client.project(projectId).base}/publish`);
}

/** Fetches the served home page HTML for a project by its slug (public route). */
async function servedHome(harnessApp: Harness, slug: string) {
  return harnessApp.app.inject({ method: 'GET', url: `/sites/${slug}/` });
}

describe('partials expansion (HTTP)', () => {
  it('creates a partial, references it from a page, and expands it through publish', async () => {
    const client = await harness.signup();
    const slug = 'partials-single';
    const projectId = await client.createProject('Site', slug);
    const proj = client.project(projectId);

    // 1. Create a reusable partial whose root renders visible text.
    const putPartial = await proj.putContent(
      'partial',
      'cta',
      partial('cta', {
        id: 'cta-root',
        type: 'Heading',
        props: { level: 2, text: 'Reusable CTA' },
      }),
    );
    expect(putPartial.statusCode).toBe(200);

    // 2. Reference it from a page tree via `partialRef`.
    const putPage = await proj.putContent('page', 'home', pageWithPartialRef('home', '', 'cta'));
    expect(putPage.statusCode).toBe(200);

    // 3. Publish → the partial's rendered content appears in the exported HTML.
    const pub = await publish(client, projectId);
    expect(pub.statusCode).toBe(200);
    expect((pub.json() as { release: { routes: number } }).release.routes).toBe(1);

    const served = await servedHome(harness, slug);
    expect(served.statusCode).toBe(200);
    expect(served.body).toContain('Reusable CTA');
    // The Heading from the partial is rendered in-place (partialRef consumed).
    expect(served.body).toContain('<h2 data-sw-block="Heading">Reusable CTA</h2>');
  });

  it('renders one partial referenced by multiple pages in each (reuse)', async () => {
    const client = await harness.signup();
    const slug = 'partials-reuse';
    const projectId = await client.createProject('Site', slug);
    const proj = client.project(projectId);

    await proj.putContent(
      'partial',
      'footer',
      partial('footer', {
        id: 'footer-root',
        type: 'Heading',
        props: { level: 3, text: 'Shared Footer Mark' },
      }),
    );
    // Two distinct pages both reference the SAME partial id.
    await proj.putContent('page', 'home', pageWithPartialRef('home', '', 'footer', 'host-a'));
    await proj.putContent('page', 'about', pageWithPartialRef('about', 'about', 'footer', 'host-b'));

    const pub = await publish(client, projectId);
    expect(pub.statusCode).toBe(200);
    expect((pub.json() as { release: { routes: number } }).release.routes).toBe(2);

    const home = await servedHome(harness, slug);
    expect(home.body).toContain('Shared Footer Mark');

    const about = await harness.app.inject({ method: 'GET', url: `/sites/${slug}/about/` });
    expect(about.statusCode).toBe(200);
    expect(about.body).toContain('Shared Footer Mark');
  });

  it('expands nested partials (partial A includes partial B)', async () => {
    const client = await harness.signup();
    const slug = 'partials-nested';
    const projectId = await client.createProject('Site', slug);
    const proj = client.project(projectId);

    // Partial B: a leaf with visible text.
    await proj.putContent(
      'partial',
      'brand',
      partial('brand', {
        id: 'brand-root',
        type: 'Heading',
        props: { level: 4, text: 'Inner Brand' },
      }),
    );
    // Partial A references partial B through a child node's partialRef.
    await proj.putContent(
      'partial',
      'header',
      partial('header', {
        id: 'header-root',
        type: 'Section',
        children: [
          { id: 'header-title', type: 'Heading', props: { level: 2, text: 'Outer Header' } },
          { id: 'header-brand-slot', type: 'Slot', partialRef: 'brand' },
        ],
      }),
    );
    // Page references partial A.
    await proj.putContent('page', 'home', pageWithPartialRef('home', '', 'header'));

    const pub = await publish(client, projectId);
    expect(pub.statusCode).toBe(200);

    const served = await servedHome(harness, slug);
    expect(served.statusCode).toBe(200);
    // Both the outer (A) and the nested inner (B) partial content render.
    expect(served.body).toContain('Outer Header');
    expect(served.body).toContain('Inner Brand');
  });

  it('rejects a partial reference cycle (A → B → A) at publish (409)', async () => {
    const client = await harness.signup();
    const projectId = await client.createProject();
    const proj = client.project(projectId);

    // A → B and B → A: a mutual cycle. Each partial is individually schema-valid
    // (partialRef is just an id string), so the PUTs succeed; the cycle only
    // manifests when `resolvePartials` runs at build time.
    const putA = await proj.putContent(
      'partial',
      'cyc-a',
      partial('cyc-a', { id: 'a-root', type: 'Slot', partialRef: 'cyc-b' }),
    );
    expect(putA.statusCode).toBe(200);
    const putB = await proj.putContent(
      'partial',
      'cyc-b',
      partial('cyc-b', { id: 'b-root', type: 'Slot', partialRef: 'cyc-a' }),
    );
    expect(putB.statusCode).toBe(200);

    await proj.putContent('page', 'home', pageWithPartialRef('home', '', 'cyc-a'));

    // `validateProject` (run on import) does NOT detect cycles — its own comment
    // defers cycle detection to `resolvePartials`. At publish, `resolvePartials`
    // throws `PartialResolutionError`, which `buildSite` wraps in `PublishError`
    // → HTTP 409 (author-correctable bad route graph).
    const pub = await publish(client, projectId);
    expect(pub.statusCode).toBe(409);
    expect((pub.json() as { error: string }).error).toMatch(/cycle/i);

    // Sanity: the cycle is likewise NOT caught by import validation, confirming
    // publish is the enforcement point for cycles (documents the boundary).
    const imp = await proj.importBundle({
      partials: [
        partial('cyc-a', { id: 'a-root', type: 'Slot', partialRef: 'cyc-b' }),
        partial('cyc-b', { id: 'b-root', type: 'Slot', partialRef: 'cyc-a' }),
      ],
      pages: [pageWithPartialRef('home', '', 'cyc-a')],
    });
    expect(imp.statusCode).toBe(200);
  });

  it('rejects an unknown partial reference on import (409 unknown_partial) and at publish (409)', async () => {
    const client = await harness.signup();
    const projectId = await client.createProject();
    const proj = client.project(projectId);

    // Import: a page referencing a partial that does not exist in the bundle is
    // caught by `validateProject` (code `unknown_partial`) → 409.
    const imp = await proj.importBundle({
      pages: [pageWithPartialRef('home', '', 'ghost')],
      partials: [],
    });
    expect(imp.statusCode).toBe(409);
    expect((imp.json() as { error: string }).error).toContain('unknown_partial');

    // Persisted directly (the generic PUT validates only the page's own schema,
    // not cross-entity references), then published: `resolvePartials` throws on
    // the missing partial → `PublishError` → 409.
    const putPage = await proj.putContent('page', 'home', pageWithPartialRef('home', '', 'ghost'));
    expect(putPage.statusCode).toBe(200);

    const pub = await publish(client, projectId);
    expect(pub.statusCode).toBe(409);
    expect((pub.json() as { error: string }).error).toMatch(/unknown partial/i);
  });

  it('isolates partials across tenants (tenant B cannot read or write tenant A’s partials)', async () => {
    const a = await harness.signup({ email: 'a-partials@acme.test'});
    const b = await harness.signup({ email: 'b-partials@globex.test'});
    const projectId = await a.createProject();
    const projA = a.project(projectId);

    await projA.putContent(
      'partial',
      'secret',
      partial('secret', { id: 'secret-root', type: 'Heading', props: { text: 'A only' } }),
    );

    const base = projA.base; // /projects/<projectId>

    // B reads A's partial → blocked (B is not a member of A's project).
    const bRead = await b.get(`${base}/content/partial/secret`);
    expect(bRead.statusCode).toBe(403);

    // B lists A's partials → blocked.
    const bList = await b.get(`${base}/content/partial`);
    expect(bList.statusCode).toBe(403);

    // B writes a partial into A's project → blocked.
    const bWrite = await b.put(
      `${base}/content/partial/intruder`,
      partial('intruder', { id: 'x', type: 'Heading', props: { text: 'pwned' } }),
    );
    expect(bWrite.statusCode).toBe(403);

    // A can still read its own partial (positive control).
    const aRead = await projA.getContent('partial', 'secret');
    expect(aRead.statusCode).toBe(200);
    expect((aRead.json() as { item: { name: string } }).item.name).toBe('Partial secret');
  });
});
