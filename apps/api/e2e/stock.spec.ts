import { test, expect, type APIRequestContext, type PlaywrightWorkerArgs } from '@playwright/test';

type PwFixture = PlaywrightWorkerArgs['playwright'];

// Stock-images over HTTP against the deployed instance. Gating + admin key config +
// secret masking run unconditionally. The REAL keyed search/import (Unsplash/Pexels)
// runs only when SW_E2E_UNSPLASH_KEY / SW_E2E_PEXELS_KEY are provided to the test run,
// so no provider secret is ever committed and a keyless CI still exercises the wiring.

const ADMIN_EMAIL = 'admin@e2e.test';
const PW = 'pw-secret-1';
const UNSPLASH_KEY = process.env.SW_E2E_UNSPLASH_KEY;
const PEXELS_KEY = process.env.SW_E2E_PEXELS_KEY;

async function adminContext(playwright: PwFixture, baseURL: string): Promise<APIRequestContext> {
  const admin = await playwright.request.newContext({ baseURL });
  const reg = await admin.post('/auth/register', { data: { email: ADMIN_EMAIL, password: PW, orgName: 'Admin Org' } });
  if (reg.status() === 409) {
    expect((await admin.post('/auth/login', { data: { email: ADMIN_EMAIL, password: PW } })).status()).toBe(200);
  } else {
    expect(reg.status()).toBe(201);
  }
  return admin;
}

async function newProject(playwright: PwFixture, baseURL: string) {
  const ctx = await playwright.request.newContext({ baseURL });
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const reg = await ctx.post('/auth/register', { data: { email: `u-${stamp}@e2e.test`, password: PW, orgName: `Org ${stamp}` } });
  expect(reg.status()).toBe(201);
  const orgId = (await reg.json()).orgId as string;
  const proj = await ctx.post(`/orgs/${orgId}/projects`, { data: { name: 'Site', slug: `s${stamp}` } });
  expect(proj.status()).toBe(201);
  const projectId = (await proj.json()).project.id as string;
  return { ctx, orgId, projectId, base: `/orgs/${orgId}/projects/${projectId}` };
}

test('stock: provider availability, search gating, and tenant isolation', async ({ playwright, baseURL }) => {
  const { ctx, base } = await newProject(playwright, baseURL!);

  const providers = await ctx.get(`${base}/stock/providers`);
  expect(providers.status()).toBe(200);
  const byName = Object.fromEntries(((await providers.json()).providers as Array<{ name: string; available: boolean }>).map((p) => [p.name, p.available]));
  expect(byName.openverse).toBe(true); // keyless → always available

  // A keyed provider with no instance key configured → 400.
  expect((await ctx.get(`${base}/stock/search?provider=pexels&q=cats`)).status()).toBe(400);
  // Unknown provider / empty query → 400.
  expect((await ctx.get(`${base}/stock/search?provider=bogus&q=cats`)).status()).toBe(400);
  expect((await ctx.get(`${base}/stock/search?provider=openverse&q=`)).status()).toBe(400);

  // Another tenant cannot touch this project's stock endpoints.
  const other = await newProject(playwright, baseURL!);
  expect((await other.ctx.get(`${base}/stock/providers`)).status()).toBe(403);
  await other.ctx.dispose();
  await ctx.dispose();
});

test('stock: keyless Openverse search + import works with no configuration', async ({ playwright, baseURL }) => {
  const { ctx, base } = await newProject(playwright, baseURL!);

  // Openverse needs no key. A real anonymous search must succeed (the request stays
  // within Openverse's anonymous page_size<=20 limit — exceeding it returns 401).
  const search = await ctx.get(`${base}/stock/search?provider=openverse&q=mountain`);
  expect(search.status()).toBe(200);
  const results = (await search.json()).results as Array<{ id: string; thumbUrl: string }>;
  // If the anonymous tier is transiently rate-limited the search may legitimately
  // come back empty; only assert the import path when there is something to import.
  if (results.length > 0) {
    expect(results[0]!.thumbUrl).toMatch(/^https:\/\//);
    const imp = await ctx.post(`${base}/stock/import`, { data: { provider: 'openverse', id: results[0]!.id } });
    expect(imp.status()).toBe(201);
    const asset = (await imp.json()).item;
    expect(asset.attribution.provider).toBe('openverse');
    expect(asset.url).toMatch(/^\/media\/[\w-]+\/[\w-]+\/[\w-]+\.jpg$/); // self-hosted, not hotlinked
    expect((await ctx.get(asset.url)).status()).toBe(200);
  }
  await ctx.dispose();
});

test('stock: admin configures provider keys, which are stored masked (never echoed)', async ({ playwright, baseURL }) => {
  const admin = await adminContext(playwright, baseURL!);

  const put = await admin.put('/admin/settings', { data: { stock: { unsplash: 'unsplash-secret-key-xyz', pexels: 'pexels-secret-key-abc' } } });
  expect(put.status()).toBe(200);
  const body = await put.text();
  expect(body).not.toContain('unsplash-secret-key-xyz');
  expect(body).not.toContain('pexels-secret-key-abc');
  const settings = JSON.parse(body).settings;
  expect(settings.stock).toEqual({ hasUnsplash: true, hasPexels: true });

  // Re-read confirms persistence and still no secrets.
  const read = await admin.get('/admin/settings');
  expect(JSON.parse(await read.text()).settings.stock).toEqual({ hasUnsplash: true, hasPexels: true });
  await admin.dispose();
});

for (const provider of ['unsplash', 'pexels'] as const) {
  const key = provider === 'unsplash' ? UNSPLASH_KEY : PEXELS_KEY;
  test(`stock: real ${provider} search + import (download → optimize → self-host with attribution)`, async ({ playwright, baseURL }) => {
    test.skip(!key, `set SW_E2E_${provider.toUpperCase()}_KEY to run the live ${provider} import`);

    // Configure the instance key as admin (instance-level, shared across projects).
    const admin = await adminContext(playwright, baseURL!);
    expect((await admin.put('/admin/settings', { data: { stock: { [provider]: key } } })).status()).toBe(200);
    await admin.dispose();

    const { ctx, base } = await newProject(playwright, baseURL!);

    // The provider is now reported available.
    const list = (await (await ctx.get(`${base}/stock/providers`)).json()).providers as Array<{ name: string; available: boolean }>;
    expect(list.find((p) => p.name === provider)?.available).toBe(true);

    // Real authenticated search.
    const search = await ctx.get(`${base}/stock/search?provider=${provider}&q=mountain`);
    expect(search.status()).toBe(200);
    const results = (await search.json()).results as Array<{ id: string; thumbUrl: string; author: string }>;
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.thumbUrl).toMatch(/^https:\/\//);

    // Import the first result: the server downloads, optimizes, and self-hosts it.
    const imp = await ctx.post(`${base}/stock/import`, { data: { provider, id: results[0]!.id, alt: 'an e2e mountain' } });
    expect(imp.status()).toBe(201);
    const asset = (await imp.json()).item;
    expect(asset.alt).toBe('an e2e mountain');
    expect(asset.attribution.provider).toBe(provider);
    expect(asset.attribution.author.length).toBeGreaterThan(0);
    expect(asset.variants.length).toBeGreaterThan(0);
    // Self-hosted: the URL is under this instance's /media, NOT a provider CDN.
    expect(asset.url).toMatch(/^\/media\/[\w-]+\/[\w-]+\/[\w-]+\.jpg$/);
    const served = await ctx.get(asset.url);
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toBe('image/jpeg');

    await ctx.dispose();
  });
}
