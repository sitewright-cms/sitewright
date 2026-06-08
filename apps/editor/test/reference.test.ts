import { describe, it, expect } from 'vitest';
import { REFERENCE_GROUPS } from '../src/views/library/reference';

describe('REFERENCE_GROUPS', () => {
  it('has unique group + entry ids and non-empty content', () => {
    const groupIds = REFERENCE_GROUPS.map((g) => g.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);
    const entryIds: string[] = [];
    for (const g of REFERENCE_GROUPS) {
      expect(g.title.length, g.id).toBeGreaterThan(0);
      expect(g.entries.length, g.id).toBeGreaterThan(0);
      for (const e of g.entries) {
        entryIds.push(e.id);
        expect(e.syntax.length, e.id).toBeGreaterThan(0);
        expect(e.description.length, e.id).toBeGreaterThan(0);
      }
    }
    expect(new Set(entryIds).size).toBe(entryIds.length);
  });

  it('documents the data-sw-* directives and the {{#eachEntry}} helper', () => {
    const all = REFERENCE_GROUPS.flatMap((g) => g.entries);
    for (const directive of ['data-sw-text', 'data-sw-html', 'data-sw-href', 'data-sw-src', 'data-sw-bg']) {
      expect(all.some((e) => e.syntax.includes(directive)), directive).toBe(true);
    }
    expect(all.some((e) => e.syntax.includes('eachEntry'))).toBe(true);
  });
});
