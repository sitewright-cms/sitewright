import { describe, it, expect } from 'vitest';
import { COMPONENT_CATALOG } from '@sitewright/schema';
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

  it('stays an API path (unknown /authoring/* is a JSON 404, not the SPA shell)', async () => {
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/authoring/bogus' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    await app.close();
  });
});
