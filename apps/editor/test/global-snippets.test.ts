import { describe, it, expect } from 'vitest';
import { validateTemplate } from '@sitewright/blocks';
import { GLOBAL_SNIPPETS } from '@sitewright/core';

describe('GLOBAL_SNIPPETS (reference cookbook)', () => {
  it('has unique, identifier-safe names (usable as {{> name}}) and non-empty labels/sources', () => {
    const names = GLOBAL_SNIPPETS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const s of GLOBAL_SNIPPETS) {
      expect(s.name, `name "${s.name}"`).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.source.length).toBeGreaterThan(0);
    }
  });

  it('every snippet passes the template validator (no script/handlers/unsafe URLs)', () => {
    for (const s of GLOBAL_SNIPPETS) {
      expect(() => validateTemplate(s.source), `snippet "${s.name}" must be safe`).not.toThrow();
    }
  });

  it('is built from platform primitives (a DaisyUI class, a data-sw-* component/region, or an sw-* helper)', () => {
    const daisy = /\b(btn|card|navbar|hero|menu|footer|link|badge|base-100|base-200|base-300|base-content|primary-content)\b/;
    const primitive = /(data-sw-|\{\{\s*sw-|\{\{#sw-)/; // a component/part/directive or an sw-* helper/block
    for (const s of GLOBAL_SNIPPETS) {
      expect(daisy.test(s.source) || primitive.test(s.source), `snippet "${s.name}" should use a platform primitive`).toBe(true);
    }
  });

  it('binds content — an editable region, a component, a loop, or a helper (never a static blob)', () => {
    for (const s of GLOBAL_SNIPPETS) {
      const hasEditable = /data-sw-/.test(s.source); // editable leaves + component/part markers
      const hasDynamic = /\{\{/.test(s.source); // a Handlebars binding/loop/helper (each, sw-*, company, …)
      expect(hasEditable || hasDynamic, `snippet "${s.name}" should bind content`).toBe(true);
    }
  });

  it('every recipe declares a grouping category + a one-line description (for the rail + agents)', () => {
    const categories = new Set(['slider', 'gallery', 'tabs', 'modal', 'data', 'chrome', 'effects']);
    for (const s of GLOBAL_SNIPPETS) {
      expect(categories.has(s.category), `recipe "${s.name}" category`).toBe(true);
      expect(s.description.trim().length, `recipe "${s.name}" description`).toBeGreaterThan(10);
    }
  });
});
