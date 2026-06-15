import { describe, it, expect } from 'vitest';
import { validateTemplate } from '@sitewright/blocks';
import { GLOBAL_WIDGETS } from '@sitewright/core';

describe('GLOBAL_WIDGETS (built-in system widgets)', () => {
  it('has unique, identifier-safe names and non-empty labels/descriptions/sources', () => {
    const names = GLOBAL_WIDGETS.map((w) => w.name);
    expect(new Set(names).size).toBe(names.length);
    for (const w of GLOBAL_WIDGETS) {
      expect(w.name, `name "${w.name}"`).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
      expect(w.label.length).toBeGreaterThan(0);
      expect(w.description.length).toBeGreaterThan(0);
      expect(w.source.length).toBeGreaterThan(0);
    }
  });

  it('every widget body passes the template validator (no script/handlers/unsafe URLs)', () => {
    for (const w of GLOBAL_WIDGETS) {
      expect(() => validateTemplate(w.source), `widget "${w.name}" must be safe`).not.toThrow();
    }
  });

  it('every widget is data-backed (consumes its provided dataset via dataset.<slug>)', () => {
    for (const w of GLOBAL_WIDGETS) {
      for (const ds of w.provides.datasets) {
        // The dataset is consumed by `{{#each dataset.X}}` (loop all) OR `(sw-pick-entry dataset.X …)`
        // (render one chosen config) — both reference dataset.<slug>.
        const ok = w.source.includes(`{{#each dataset.${ds.slug}}}`) || w.source.includes(`sw-pick-entry dataset.${ds.slug}`);
        expect(ok, `widget "${w.name}" should consume dataset.${ds.slug}`).toBe(true);
      }
    }
  });
});
