import { test, expect, type PlaywrightWorkerArgs } from '@playwright/test';
import { seedUser } from './helpers.js';

type PwFixture = PlaywrightWorkerArgs['playwright'];

/**
 * Clearing a page field with `null`, over BOTH write surfaces, against the deployed container.
 *
 * These exist because the two surfaces disagreed in production. `deepMerge` has always read `null`
 * as "delete this key" — the only way to remove a field, since omitting one means "leave unchanged"
 * and `template` is `.min(1)` so `""` cannot clear it. The REST `?merge=1` route deep-merges the raw
 * body and honoured that. MCP `patch_page` put a `.partial()` zod schema in front, which accepts
 * `undefined` but REJECTS `null`, so the documented contract was unreachable from the surface agents
 * actually use. Three separate clone agents hit it; their only recourse was `put_page`, the total
 * replace that wipes `data.swImport` — the marker every fidelity tool needs.
 *
 * Unit tests pin the schema. These pin the whole stack: route → deepMerge → full-PageSchema
 * revalidation → storage, on both surfaces, which is the level the divergence lived at.
 *
 * ★ `parent` is the one field a null does NOT erase. Every page hangs off a home (see
 * `withResolvedParent`), so clearing a parent un-nests the page to the home of its language rather
 * than leaving it rootless. Null is still ACCEPTED there — that acceptance is the bug these tests
 * exist for — so the parent cases below assert where the page lands, and `description` carries the
 * "a field is genuinely gone" half.
 */

async function newProject(playwright: PwFixture, baseURL: string) {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const ctx = await seedUser(playwright, baseURL, `patchnull-${stamp}@e2e.test`);
  const proj = await ctx.post(`/projects`, { data: { name: 'Patch', slug: `pn${stamp}` } });
  expect(proj.status(), 'creating the project').toBe(201);
  const projectId = (await proj.json()).project.id as string;
  return { ctx, projectId, base: `/projects/${projectId}`, stamp };
}

/** A child page carrying the fields we intend to clear, nested under `parent` (default: home). */
async function seedChild(
  ctx: Awaited<ReturnType<typeof newProject>>['ctx'],
  base: string,
  id: string,
  parent = 'home',
) {
  const res = await ctx.put(`${base}/content/page/${id}`, {
    data: {
      id,
      path: id,
      title: 'Child',
      source: '<section><h2>child</h2></section>',
      parent,
      description: 'seeded',
      data: { swImport: { sourceUrl: 'https://example.com/child' }, headline: 'hi', keep: 'me' },
    },
  });
  expect(res.status(), `seeding ${id}`).toBe(200);
}

const getPage = async (ctx: Awaited<ReturnType<typeof newProject>>['ctx'], base: string, id: string) =>
  (await (await ctx.get(`${base}/content/page/${id}`)).json()) as {
    item?: Record<string, unknown>;
  } & Record<string, unknown>;

test('REST ?merge=1: null clears a field, and omitting one leaves it alone', async ({ playwright, baseURL }) => {
  const { ctx, base } = await newProject(playwright, baseURL!);
  await seedChild(ctx, base, 'child');

  const res = await ctx.put(`${base}/content/page/child?merge=1`, { data: { id: 'child', description: null } });
  expect(res.status(), 'clearing description over REST').toBe(200);

  const page = (await getPage(ctx, base, 'child')).item ?? {};
  expect('description' in page, 'description must be GONE, not null').toBe(false);
  // Everything the patch did not mention survives — that is the whole point of a merge write.
  expect(page.title).toBe('Child');
  expect(page.parent).toBe('home');
  expect((page.data as Record<string, unknown>)?.swImport, 'the import marker must survive').toBeTruthy();
});

test('REST ?merge=1: a null parent un-nests to the home, never to rootless', async ({ playwright, baseURL }) => {
  const { ctx, base } = await newProject(playwright, baseURL!);
  await seedChild(ctx, base, 'mid');
  await seedChild(ctx, base, 'deep', 'mid');

  const res = await ctx.put(`${base}/content/page/deep?merge=1`, { data: { id: 'deep', parent: null } });
  expect(res.status(), 'clearing parent over REST').toBe(200);

  const page = (await getPage(ctx, base, 'deep')).item ?? {};
  // Not `mid` (the null was honoured) and not absent (a page is never a second root).
  expect(page.parent, 'a cleared parent resolves to the home').toBe('home');
  expect((page.data as Record<string, unknown>)?.swImport, 'the import marker must survive').toBeTruthy();
});

test('MCP patch_page: null clears a field (the surface that used to reject it)', async ({ playwright, baseURL }) => {
  const { ctx, base } = await newProject(playwright, baseURL!);
  await seedChild(ctx, base, 'mid');
  await seedChild(ctx, base, 'child', 'mid');

  const mint = await ctx.post(`${base}/api-keys`, {
    data: { name: 'e2e-mcp', role: 'owner', capabilities: ['content:read', 'content:write'], expiresInDays: 1 },
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
    const call = async (page: Record<string, unknown>) => {
      const res = await mcp.post('/mcp', {
        data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'patch_page', arguments: { page } } },
      });
      expect(res.status(), 'MCP tools/call must be accepted').toBe(200);
      return res.text();
    };

    // NEGATIVE CONTROL first. The real assertion below is "no input-validation error", which would
    // pass vacuously if this harness could never observe one. Prove it can: a wrongly-TYPED value is
    // still rejected, and the rejection is visible in exactly the place the next assertion reads.
    const rejected = await call({ id: 'child', nav: 'header' });
    expect(rejected, 'the control must show that a bad argument IS visible here').toContain('Input validation error');

    // A rejected null used to surface the same way — that was the bug.
    const body = await call({ id: 'child', parent: null });
    expect(body, 'null must not be rejected as an invalid argument').not.toContain('Input validation error');
    expect(body).not.toContain('expected string, received null');

    // The null was applied, not dropped: `child` was seeded under `mid`, and clearing its parent
    // returns it to the home rather than leaving it rootless.
    const page = (await getPage(ctx, base, 'child')).item ?? {};
    expect(page.parent, 'MCP must be able to clear a field too').toBe('home');
    expect((page.data as Record<string, unknown>)?.swImport, 'patch must not wipe the import marker').toBeTruthy();

    // And a field with no invariant behind it disappears outright over the same surface.
    const cleared = await call({ id: 'child', description: null });
    expect(cleared, 'null must not be rejected as an invalid argument').not.toContain('Input validation error');
    const after = (await getPage(ctx, base, 'child')).item ?? {};
    expect('description' in after, 'description must be GONE, not null').toBe(false);
  } finally {
    await mcp.dispose();
  }
});

test('a single data key clears without taking data.swImport with it', async ({ playwright, baseURL }) => {
  const { ctx, base } = await newProject(playwright, baseURL!);
  await seedChild(ctx, base, 'child');

  const res = await ctx.put(`${base}/content/page/child?merge=1`, {
    data: { id: 'child', data: { headline: null } },
  });
  expect(res.status()).toBe(200);

  const data = ((await getPage(ctx, base, 'child')).item?.data ?? {}) as Record<string, unknown>;
  expect('headline' in data, 'the named key is gone').toBe(false);
  expect(data.keep, 'its siblings are untouched').toBe('me');
  expect(data.swImport, 'the import marker survives a nested clear').toBeTruthy();
});

test('nulling a REQUIRED field is refused by the merged-page validation, and stores nothing', async ({ playwright, baseURL }) => {
  const { ctx, base } = await newProject(playwright, baseURL!);
  await seedChild(ctx, base, 'child');

  // `title` is required on the full PageSchema, which validates the MERGED result — so a patch that
  // deletes it must fail there rather than persisting a page that can never render.
  const res = await ctx.put(`${base}/content/page/child?merge=1`, { data: { id: 'child', title: null } });
  expect(res.status(), 'a merge that would break the page must 400').toBe(400);

  const page = (await getPage(ctx, base, 'child')).item ?? {};
  expect(page.title, 'the stored page is untouched by the refused patch').toBe('Child');
});
