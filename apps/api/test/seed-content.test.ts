import { describe, it, expect } from 'vitest';
import { validateTemplate } from '@sitewright/blocks';
import {
  EXAMPLE_PAGES,
  EXAMPLE_WEBSITE,
  EXAMPLE_DATASETS,
  EXAMPLE_ENTRIES,
} from '../src/seed-data.js';

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

  it('every dataset the pages bind via {{#each data.<slug>}} has seeded entries', () => {
    const entriesByDataset = new Set(EXAMPLE_ENTRIES.map((e) => e.dataset));
    const datasetSlugs = new Set(EXAMPLE_DATASETS.map((d) => d.slug));
    const sources = EXAMPLE_PAGES.map((p) => p.source ?? '').join('\n');
    const bound = [...sources.matchAll(/\{\{#each data\.([a-z0-9_-]+)\}\}/g)].map((m) => m[1]);
    expect(bound.length).toBeGreaterThan(0); // the demo actually exercises datasets
    for (const slug of bound) {
      expect(datasetSlugs.has(slug!), `dataset "${slug}" is defined`).toBe(true);
      expect(entriesByDataset.has(slug!), `dataset "${slug}" has entries`).toBe(true);
    }
  });
});
