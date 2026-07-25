import { describe, it, expect } from 'vitest';
import { COMPONENT_CATALOG } from '@sitewright/schema';
import { TEXTURE_NAMES } from '@sitewright/blocks';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

// GET /authoring/components — the machine-readable component authoring contract. Public,
// static platform metadata (no tenant data), mirroring /health and /version; the MCP
// `get_components` tool serves the same constant. The catalog↔runtime sync itself is
// guarded in @sitewright/blocks (component-catalog.test.ts).
describe('GET /authoring/components', () => {
  it('serves the component catalog without authentication', async () => {
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/authoring/components' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { components: typeof COMPONENT_CATALOG };
    expect(body.components).toEqual(COMPONENT_CATALOG);
    // contract spot-checks: each entry is a complete authoring unit
    for (const entry of body.components) {
      expect(entry).toMatchObject({
        type: expect.any(String),
        marker: expect.any(String),
        skeleton: expect.any(String),
        noJs: expect.any(String),
        notes: expect.any(String),
      });
    }
    await app.close();
  });

  it('GET /authoring/icons/search — multi-term search, honours limit, empty q → empty groups', async () => {
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    // Multiple terms (comma + whitespace) + a limit.
    const res = await app.inject({ method: 'GET', url: '/authoring/icons/search?q=settings,%20trash%20gear&limit=3' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { query: string; results: Array<{ term: string; matches: string[] }> };
    expect(body.results.map((g) => g.term)).toEqual(['settings', 'trash', 'gear']);
    expect(body.results[0]?.matches[0]).toBe('gear'); // "settings" → gear (alias)
    expect(body.results[0]?.matches.length).toBeLessThanOrEqual(3); // limit honoured
    // Missing q → empty results (no crash); default limit path.
    const empty = await app.inject({ method: 'GET', url: '/authoring/icons/search' });
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as { results: unknown[] }).results).toEqual([]);
    await app.close();
  });

  it('GET /authoring/icons/names + /render — the editor icon library fetches names + previews (no bundled data)', async () => {
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    const names = await app.inject({ method: 'GET', url: '/authoring/icons/names' });
    expect(names.statusCode).toBe(200);
    const nb = names.json() as { names: string[]; weights: string[] };
    expect(nb.names).toContain('gear');
    expect(nb.weights).toContain('fill');
    expect(nb.weights).toContain('duotone');
    // Batch render: an icon (weighted) + a brand: logo; unknown weight → fill; unknown name → omitted.
    const render = await app.inject({ method: 'GET', url: '/authoring/icons/render?weight=bold&names=gear,brand:github,totally-unknown-xyz' });
    expect(render.statusCode).toBe(200);
    const rb = render.json() as { weight: string; svgs: Record<string, string> };
    expect(rb.weight).toBe('bold');
    expect(rb.svgs.gear).toContain('sw-icon-gear sw-icon-bold');
    expect(rb.svgs['brand:github']).toContain('sw-icon-brand-github');
    expect(rb.svgs['totally-unknown-xyz']).toBeUndefined();
    // A bad weight falls back to fill.
    const dflt = await app.inject({ method: 'GET', url: '/authoring/icons/render?weight=nope&names=star' });
    expect((dflt.json() as { weight: string }).weight).toBe('fill');
    await app.close();
  });

  it('stays an API path (unknown /authoring/* is a JSON 404, not the SPA shell)', async () => {
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/authoring/bogus' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    await app.close();
  });
});

describe('GET /authoring/textures', () => {
  it('lists names without q, and returns per-term search groups with q', async () => {
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    const list = await app.inject({ method: 'GET', url: '/authoring/textures' });
    expect(list.statusCode).toBe(200);
    const lb = list.json() as { names: string[] };
    expect(lb.names).toEqual([...TEXTURE_NAMES]);
    expect(lb.names).toContain('cartographer');

    const search = await app.inject({ method: 'GET', url: '/authoring/textures?q=fabric,%20paper&limit=3' });
    expect(search.statusCode).toBe(200);
    const sb = search.json() as { query: string; results: Array<{ term: string; matches: string[] }> };
    expect(sb.results.map((g) => g.term)).toEqual(['fabric', 'paper']);
    expect(sb.results[0]?.matches.length).toBeLessThanOrEqual(3);
    expect(sb.results[0]?.matches.every((m) => m.includes('fabric'))).toBe(true);
    await app.close();
  });

  it('serves a real texture PNG (image/png, immutable, cross-origin) and 404s unknown/non-png/traversal', async () => {
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    const ok = await app.inject({ method: 'GET', url: '/authoring/textures/cartographer.png' });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('image/png');
    expect(ok.headers['cache-control']).toContain('immutable');
    expect(ok.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(ok.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic

    for (const url of ['/authoring/textures/not-a-real-texture.png', '/authoring/textures/cartographer.txt']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(404);
    }
    await app.close();
  });
});
