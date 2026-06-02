import { describe, it, expect } from 'vitest';
import { validateTemplate } from '@sitewright/blocks';
import { CODE_PATTERNS } from '../src/lib/code-patterns';

describe('CODE_PATTERNS (DaisyUI starter patterns)', () => {
  it('has unique ids and non-empty names/sources', () => {
    const ids = CODE_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of CODE_PATTERNS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.source.length).toBeGreaterThan(0);
    }
  });

  it('every pattern passes the template validator (no script/handlers/unsafe URLs)', () => {
    for (const p of CODE_PATTERNS) {
      expect(() => validateTemplate(p.source), `pattern "${p.id}" must be safe`).not.toThrow();
    }
  });

  it('every pattern is built from the DaisyUI vocabulary', () => {
    // At least one DaisyUI component/surface class per pattern (btn, card, navbar, hero, …).
    const daisy = /\b(btn|card|navbar|hero|menu|footer|link|badge|base-100|base-200|base-content|primary-content)\b/;
    for (const p of CODE_PATTERNS) {
      expect(daisy.test(p.source), `pattern "${p.id}" should use DaisyUI`).toBe(true);
    }
  });

  it('exposes client-editable regions and/or brand bindings', () => {
    for (const p of CODE_PATTERNS) {
      const hasEdit = /\{\{edit\s+"/.test(p.source);
      const hasBinding = /\{\{\s*company\./.test(p.source);
      expect(hasEdit || hasBinding, `pattern "${p.id}" should bind content`).toBe(true);
    }
  });
});
