import { test, expect, type PlaywrightWorkerArgs } from '@playwright/test';
import { adminContext, seedUser } from './helpers.js';

type PwFixture = PlaywrightWorkerArgs['playwright'];

// Stock-images over HTTP against the deployed instance. Gating + admin key config +
// secret masking run unconditionally. The REAL keyed search/import (Unsplash/Pexels/Pixabay)
// runs only when SW_E2E_<PROVIDER>_KEY is provided to the test run, so no provider secret is
// ever committed and a keyless CI still exercises the wiring.

const KEYED_PROVIDERS = ['unsplash', 'pexels', 'pixabay'] as const;
const LIVE_KEYS: Record<(typeof KEYED_PROVIDERS)[number], string | undefined> = {
  unsplash: process.env.SW_E2E_UNSPLASH_KEY,
  pexels: process.env.SW_E2E_PEXELS_KEY,
  pixabay: process.env.SW_E2E_PIXABAY_KEY,
};

async function newProject(playwright: PwFixture, baseURL: string) {
  const stamp = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const ctx = await seedUser(playwright, baseURL, `u-${stamp}@e2e.test`);
  const proj = await ctx.post(`/projects`, { data: { name: 'Site', slug: `s${stamp}` } });
  expect(proj.status()).toBe(201);
  const projectId = (await proj.json()).project.id as string;
  return { ctx, projectId, base: `/projects/${projectId}` };
}

test('stock: provider availability, search gating, and tenant isolation', async ({ playwright, baseURL }) => {
  const { ctx, base } = await newProject(playwright, baseURL!);

  const providers = await ctx.get(`${base}/stock/providers`);
  expect(providers.status()).toBe(200);
  const byName = Object.fromEntries(((await providers.json()).providers as Array<{ name: string; available: boolean }>).map((p) => [p.name, p.available]));
  expect(byName.openverse).toBe(true); // keyless → always available

  // A keyed provider with no instance key configured → 400. This asserts INSTANCE-wide state that the
  // "admin configures provider keys" test below WRITES, so establish it rather than assuming it: send
  // `stock: null`, which clears every stored key (a per-provider object only ever sets or retains — an
  // omitted key keeps the stored one and an empty string is rejected). Without this the spec passed
  // exactly once per fresh slot and failed on every re-run, which is no use in a gate you want to run
  // repeatedly. (A stale comment here claimed clearing was impossible; `stock: null` has always done it.)
  const cleaner = await adminContext(playwright, baseURL!);
  expect((await cleaner.put('/admin/settings', { data: { stock: null } })).status()).toBe(200);
  await cleaner.dispose();
  for (const provider of KEYED_PROVIDERS) {
    expect((await ctx.get(`${base}/stock/search?provider=${provider}&q=cats`)).status()).toBe(400);
  }
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
  const results = (await search.json()).results as Array<{ id: string; thumbUrl: string; previewUrl: string }>;
  // If the anonymous tier is transiently rate-limited the search may legitimately
  // come back empty; only assert the import path when there is something to import.
  if (results.length > 0) {
    expect(results[0]!.thumbUrl).toMatch(/^https:\/\//);
    expect(results[0]!.previewUrl).toMatch(/^https:\/\//); // the full-size preview rendition
    const imp = await ctx.post(`${base}/stock/import`, { data: { provider: 'openverse', id: results[0]!.id } });
    expect(imp.status()).toBe(201);
    const asset = (await imp.json()).item;
    expect(asset.attribution.provider).toBe('openverse');
    // Flat scheme (#708-711), self-hosted not hotlinked. The extension depends on the source: a
    // photo wider than the 2400px import cap is downscaled + re-encoded to .webp.
    expect(asset.url).toMatch(/^\/media\/[\w-]+\/[\w-]+\.(jpe?g|png|webp|avif|gif)$/);
    expect(asset.width).toBeLessThanOrEqual(2400);
    expect((await ctx.get(asset.url)).status()).toBe(200);
  }
  await ctx.dispose();
});

test('stock: `all` fans out across every available provider without a key', async ({ playwright, baseURL }) => {
  const { ctx, base } = await newProject(playwright, baseURL!);

  // With no instance keys, the fan-out still works — keyless Openverse carries it, and the unkeyed
  // providers are SKIPPED rather than failing the search.
  const res = await ctx.get(`${base}/stock/search?provider=all&q=mountain`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.provider).toBe('all');
  expect(typeof body.hasMore).toBe('boolean');
  for (const hit of body.results as Array<{ provider: string }>) {
    // Every RESULT names a concrete provider, which is what an import passes back.
    expect(['openverse', ...KEYED_PROVIDERS]).toContain(hit.provider);
  }
  await ctx.dispose();
});

test('stock: admin configures provider keys, which are stored masked (never echoed)', async ({ playwright, baseURL }) => {
  const admin = await adminContext(playwright, baseURL!);

  const secrets = { unsplash: 'unsplash-secret-key-xyz', pexels: 'pexels-secret-key-abc', pixabay: 'pixabay-secret-key-def' };
  const put = await admin.put('/admin/settings', { data: { stock: secrets } });
  expect(put.status()).toBe(200);
  const body = await put.text();
  for (const secret of Object.values(secrets)) expect(body).not.toContain(secret);
  const stored = { hasUnsplash: true, hasPexels: true, hasPixabay: true };
  expect(JSON.parse(body).settings.stock).toEqual(stored);

  // Re-read confirms persistence and still no secrets.
  const read = await admin.get('/admin/settings');
  expect(JSON.parse(await read.text()).settings.stock).toEqual(stored);
  await admin.dispose();
});

for (const provider of KEYED_PROVIDERS) {
  const key = LIVE_KEYS[provider];
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
    // The retained original is stored (source of truth); no eager variants any more.
    expect(typeof asset.original).toBe('string');
    expect(asset.original.length).toBeGreaterThan(0);
    // Self-hosted: the URL is under this instance's /media, NOT a provider CDN. It is the id-bearing
    // DELIVERY route ending in the stored original name (a stock photo >2400px is capped → .webp).
    expect(asset.url).toMatch(/^\/media\/[\w-]+\/[\w-]+\/[\w-]+\.(jpe?g|png|webp|avif|gif)$/);
    const served = await ctx.get(asset.url);
    expect(served.status()).toBe(200);
    // The bare delivery URL serves the compressed `xl` thumbnail (WebP) by default.
    expect(served.headers()['content-type']).toBe('image/webp');

    await ctx.dispose();
  });
}
