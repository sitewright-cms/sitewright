import { describe, it, expect } from 'vitest';
import { validateTemplate } from '@sitewright/blocks';
import { GLOBAL_SNIPPETS } from '@sitewright/core';

describe('GLOBAL_SNIPPETS (built-in starter snippets)', () => {
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

  it('every snippet is built from the DaisyUI vocabulary', () => {
    const daisy = /\b(btn|card|navbar|hero|menu|footer|link|badge|base-100|base-200|base-content|primary-content)\b/;
    for (const s of GLOBAL_SNIPPETS) {
      expect(daisy.test(s.source), `snippet "${s.name}" should use DaisyUI`).toBe(true);
    }
  });

  it('exposes client-editable regions and/or brand bindings', () => {
    for (const s of GLOBAL_SNIPPETS) {
      const hasEdit = /\{\{edit\s+"/.test(s.source);
      const hasBinding = /\{\{\s*company\./.test(s.source);
      expect(hasEdit || hasBinding, `snippet "${s.name}" should bind content`).toBe(true);
    }
  });
});
