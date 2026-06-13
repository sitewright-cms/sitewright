import { describe, it, expect } from 'vitest';
import { GLOBAL_WIDGETS } from '@sitewright/core';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

// GET /authoring/widgets — the slim catalog of system Widgets the editor's Widgets rail browses.
// Public, static platform metadata (no tenant data), mirroring /authoring/components. The body +
// `provides` manifest stay server-side; only name/label/description/component + dataset descriptors
// are exposed.
describe('GET /authoring/widgets', () => {
  it('serves the widget catalog without authentication', async () => {
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/authoring/widgets' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      widgets: Array<{ name: string; label: string; description: string; component: string; datasets: Array<{ slug: string; name: string }> }>;
    };
    expect(body.widgets.length).toBe(GLOBAL_WIDGETS.length);
    const hero = body.widgets.find((w) => w.name === 'hero-slider');
    expect(hero).toMatchObject({
      name: 'hero-slider',
      label: expect.any(String),
      description: expect.any(String),
      component: 'carousel',
    });
    expect(hero?.datasets).toContainEqual({ slug: 'hero', name: 'Hero' });
    // The descriptor is SLIM — it must NOT leak the body source or the full provides manifest,
    // including the nested dataset field tree / seed values.
    for (const w of body.widgets) {
      expect(w).not.toHaveProperty('source');
      expect(w).not.toHaveProperty('provides');
      for (const d of w.datasets) {
        expect(d).not.toHaveProperty('fields');
        expect(d).not.toHaveProperty('seed');
      }
    }
    await app.close();
  });
});
