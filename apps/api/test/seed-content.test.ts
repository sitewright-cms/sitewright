import { describe, it, expect } from 'vitest';
import { validateTemplate } from '@sitewright/blocks';
import { examplePages, EXAMPLE_WEBSITE, EXAMPLE_DATASETS, exampleEntries } from '../src/seed-data.js';

// The image-bearing content is now parameterized by an asset-URL map; for these structural/
// validator checks the URLs are irrelevant, so seed with an empty map (→ empty image refs).
const EXAMPLE_PAGES = examplePages({});
const EXAMPLE_ENTRIES = exampleEntries({});

/**
 * Guards the seeded demo CONTENT against the no-JS template validator + cross-references the
 * dataset bindings. The bootstrap test (`seed.test.ts`) proves the seed PARSES (schemas) and boots;
 * this proves every code-first page `source` + skeleton slot is SAFE to render and that every
 * `{{#each data.<slug>}}` the pages reference resolves to seeded entries — so a future edit to the
 * demo can't silently ship a page that only blows up at publish time.
 */
describe('seed demo content', () => {
  it('every code-first page source passes the no-JS template validator', () => {
    for (const page of EXAMPLE_PAGES) {
      if (page.source) {
        expect(() => validateTemplate(page.source as string), `page "${page.id}"`).not.toThrow();
      }
    }
  });

  it('the skeleton slots (topNav, footer) pass the validator', () => {
    expect(() => validateTemplate(EXAMPLE_WEBSITE.topNav)).not.toThrow();
    expect(() => validateTemplate(EXAMPLE_WEBSITE.footer)).not.toThrow();
  });

  it('every dataset the pages bind via {{#each(Entry) data.<slug>}} has seeded entries', () => {
    const entriesByDataset = new Set(EXAMPLE_ENTRIES.map((e) => e.dataset));
    const datasetSlugs = new Set(EXAMPLE_DATASETS.map((d) => d.slug));
    const sources = EXAMPLE_PAGES.map((p) => p.source ?? '').join('\n');
    // The demo uses {{#eachEntry}} (click-to-edit rows); also accept the plain {{#each}} form.
    const bound = [...sources.matchAll(/\{\{#each(?:Entry)?\s+data\.([a-z0-9_-]+)\s*\}\}/g)].map((m) => m[1]);
    expect(bound.length).toBeGreaterThan(0); // the demo actually exercises datasets
    for (const slug of bound) {
      expect(datasetSlugs.has(slug!), `dataset "${slug}" is defined`).toBe(true);
      expect(entriesByDataset.has(slug!), `dataset "${slug}" has entries`).toBe(true);
    }
  });

  it('binds the provided LOCAL asset URLs into entries + pages — and uses NO remote image hosts', () => {
    const assets = {
      'proj-harbor': '/media/p/ex-proj-harbor/ex-proj-harbor-800.jpg',
      'team-mara': '/media/p/ex-team-mara/ex-team-mara-400.jpg',
      // The entry id is `team-dev` but it looks up the `team-devon` asset key — pin that mapping.
      'team-devon': '/media/p/ex-team-devon/ex-team-devon-400.jpg',
      hero: '/media/p/ex-hero/ex-hero-800.jpg',
      studio: '/media/p/ex-studio/ex-studio-800.jpg',
    };
    const entries = exampleEntries(assets);
    const pages = examplePages(assets);
    // Dataset image fields take the local URL.
    expect(JSON.stringify(entries.find((e) => e.id === 'proj-harbor'))).toContain(assets['proj-harbor']);
    expect(JSON.stringify(entries.find((e) => e.id === 'team-mara'))).toContain(assets['team-mara']);
    expect(JSON.stringify(entries.find((e) => e.id === 'team-dev'))).toContain(assets['team-devon']);
    // Page hero/studio <img> take the local URL.
    const sources = pages.map((p) => p.source ?? '').join('\n');
    expect(sources).toContain(assets.hero);
    expect(sources).toContain(assets.studio);
    // No remote image hosts anywhere in the seeded demo content.
    const all = [JSON.stringify(entries), sources].join('\n');
    expect(all).not.toContain('picsum');
    expect(all).not.toMatch(/https?:\/\/[^"']*\.(?:jpg|jpeg|png|webp|gif|avif)/i);
  });
});
