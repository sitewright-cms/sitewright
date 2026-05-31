import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import type { StockServiceLike } from '../src/http/stock-routes.js';
import { StockProviderError } from '../src/stock/providers.js';
import { EncryptionUnavailableError } from '../src/repo/instance-settings.js';
import type { StockProviderName } from '@sitewright/schema';

// A tiny but valid 1x1 PNG so the sharp pipeline can decode + optimize the "imported" image.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

let mediaRoot: string;
beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-stock-api-'));
});
afterEach(async () => {
  await rm(mediaRoot, { recursive: true, force: true });
});

async function makeApp(stockService?: StockServiceLike): Promise<FastifyInstance> {
  const app = await createApp({ db: await makeTestDb(), mediaRoot, ...(stockService ? { stockService } : {}) });
  await app.ready();
  return app;
}

async function setup(app: FastifyInstance, email: string, orgName: string) {
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'pw-secret-1', orgName } });
  const t = token(reg);
  const orgId = (reg.json() as { orgId: string }).orgId;
  const proj = await app.inject({
    method: 'POST',
    url: `/orgs/${orgId}/projects`,
    cookies: { sw_session: t },
    payload: { name: 'Site', slug: 'site' },
  });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, orgId, projectId, base: `/orgs/${orgId}/projects/${projectId}` };
}

/** A fake stock service so route tests never touch the network. */
function fakeStock(overrides: Partial<StockServiceLike> = {}): StockServiceLike {
  return {
    availability: async () => ({
      providers: [
        { name: 'openverse', available: true, requiresKey: false },
        { name: 'unsplash', available: false, requiresKey: true },
        { name: 'pexels', available: false, requiresKey: true },
      ],
    }),
    search: async (provider: StockProviderName, query: string, page: number) => ({
      provider,
      page,
      results: [
        { provider, id: 'hit1', thumbUrl: 'https://cdn.example/hit1', width: 4, height: 3, author: 'Ann', sourceUrl: 'https://src/hit1', license: 'CC0' },
      ],
    }),
    fetchForImport: async () => ({
      buffer: PNG_1X1,
      contentType: 'image/png',
      attribution: { provider: 'openverse', author: 'Ann', sourceUrl: 'https://src/hit1', license: 'CC0' },
    }),
    ...overrides,
  };
}

describe('stock API — real service (no network needed for gating)', () => {
  it('reports openverse available and keyed providers unavailable without keys', async () => {
    const app = await makeApp();
    const { t, base } = await setup(app, 'a@acme.test', 'Acme');
    const res = await app.inject({ method: 'GET', url: `${base}/stock/providers`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(200);
    const by = Object.fromEntries((res.json() as { providers: Array<{ name: string; available: boolean }> }).providers.map((p) => [p.name, p.available]));
    expect(by).toEqual({ openverse: true, unsplash: false, pexels: false });
  });

  it('rejects searching a keyed provider that has no key configured (400)', async () => {
    const app = await makeApp();
    const { t, base } = await setup(app, 'a@acme.test', 'Acme');
    const res = await app.inject({ method: 'GET', url: `${base}/stock/search?provider=unsplash&q=cats`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown provider (400)', async () => {
    const app = await makeApp();
    const { t, base } = await setup(app, 'a@acme.test', 'Acme');
    const res = await app.inject({ method: 'GET', url: `${base}/stock/search?provider=bogus&q=cats`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing/empty query (400)', async () => {
    const app = await makeApp();
    const { t, base } = await setup(app, 'a@acme.test', 'Acme');
    const res = await app.inject({ method: 'GET', url: `${base}/stock/search?provider=openverse&q=`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(400);
  });

  it('requires authentication for providers/search/import', async () => {
    const app = await makeApp();
    const { base } = await setup(app, 'a@acme.test', 'Acme');
    expect((await app.inject({ method: 'GET', url: `${base}/stock/providers` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `${base}/stock/search?provider=openverse&q=cats` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: `${base}/stock/import`, payload: { provider: 'openverse', id: 'x' } })).statusCode).toBe(401);
  });

  it('forbids another tenant from using stock endpoints (403)', async () => {
    const app = await makeApp();
    const a = await setup(app, 'a@acme.test', 'Acme');
    const b = await setup(app, 'b@globex.test', 'Globex');
    const res = await app.inject({ method: 'GET', url: `${a.base}/stock/providers`, cookies: { sw_session: b.t } });
    expect(res.statusCode).toBe(403);
  });
});

describe('stock API — injected fake service', () => {
  it('searches and returns provider-hosted thumbnails', async () => {
    const app = await makeApp(fakeStock());
    const { t, base } = await setup(app, 'a@acme.test', 'Acme');
    const res = await app.inject({ method: 'GET', url: `${base}/stock/search?provider=openverse&q=cats`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { provider: string; results: Array<{ id: string; thumbUrl: string }> };
    expect(body.provider).toBe('openverse');
    expect(body.results[0]?.id).toBe('hit1');
  });

  it('imports a stock image: downloads → optimizes → self-hosts with attribution', async () => {
    const app = await makeApp(fakeStock());
    const { t, base } = await setup(app, 'a@acme.test', 'Acme');
    const res = await app.inject({
      method: 'POST',
      url: `${base}/stock/import`,
      cookies: { sw_session: t },
      payload: { provider: 'openverse', id: 'hit1', alt: 'a cat' },
    });
    expect(res.statusCode).toBe(201);
    const asset = (res.json() as { item: { id: string; url: string; alt?: string; attribution?: { author: string }; variants: unknown[] } }).item;
    expect(asset.alt).toBe('a cat');
    expect(asset.attribution?.author).toBe('Ann');
    expect(asset.variants.length).toBeGreaterThan(0);
    // The imported image is self-hosted (served locally, not hotlinked).
    expect(asset.url).toMatch(/^\/media\/[\w-]+\/[\w-]+\/[\w-]+\.jpg$/);
    const served = await app.inject({ method: 'GET', url: asset.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');

    // And it shows up in the media list.
    const list = await app.inject({ method: 'GET', url: `${base}/media`, cookies: { sw_session: t } });
    expect((list.json() as { items: unknown[] }).items).toHaveLength(1);
  });

  it('returns 404 when the provider cannot resolve the id', async () => {
    const app = await makeApp(fakeStock({ fetchForImport: async () => null }));
    const { t, base } = await setup(app, 'a@acme.test', 'Acme');
    const res = await app.inject({
      method: 'POST',
      url: `${base}/stock/import`,
      cookies: { sw_session: t },
      payload: { provider: 'openverse', id: 'missing' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an import body that fails schema validation (400)', async () => {
    const app = await makeApp(fakeStock());
    const { t, base } = await setup(app, 'a@acme.test', 'Acme');
    const res = await app.inject({
      method: 'POST',
      url: `${base}/stock/import`,
      cookies: { sw_session: t },
      payload: { provider: 'openverse' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('maps a provider failure to 502 and an encryption outage to 503', async () => {
    const provFail = await makeApp(fakeStock({ fetchForImport: async () => { throw new StockProviderError('boom'); } }));
    const a = await setup(provFail, 'a@acme.test', 'Acme');
    const r502 = await provFail.inject({ method: 'POST', url: `${a.base}/stock/import`, cookies: { sw_session: a.t }, payload: { provider: 'openverse', id: 'x' } });
    expect(r502.statusCode).toBe(502);
    expect((r502.json() as { error: string }).error).not.toContain('boom'); // generic message, no upstream leak

    const encFail = await makeApp(fakeStock({ fetchForImport: async () => { throw new EncryptionUnavailableError(); } }));
    const b = await setup(encFail, 'b@globex.test', 'Globex');
    const r503 = await encFail.inject({ method: 'POST', url: `${b.base}/stock/import`, cookies: { sw_session: b.t }, payload: { provider: 'unsplash', id: 'y' } });
    expect(r503.statusCode).toBe(503);
  });

  it('maps a provider failure on search to 502', async () => {
    const app = await makeApp(fakeStock({ search: async () => { throw new StockProviderError('boom'); } }));
    const { t, base } = await setup(app, 'a@acme.test', 'Acme');
    const res = await app.inject({ method: 'GET', url: `${base}/stock/search?provider=openverse&q=cats`, cookies: { sw_session: t } });
    expect(res.statusCode).toBe(502);
  });
});
