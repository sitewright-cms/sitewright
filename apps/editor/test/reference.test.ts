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

  it('documents the data-sw-* directives, the sw-* content helpers, and the dataset-aware #each', () => {
    const all = REFERENCE_GROUPS.flatMap((g) => g.entries);
    for (const directive of ['data-sw-text', 'data-sw-html', 'data-sw-href', 'data-sw-src', 'data-sw-bg']) {
      expect(all.some((e) => e.syntax.includes(directive)), directive).toBe(true);
    }
    // The content helpers are sw-prefixed (kept clear of the dataset field namespace).
    for (const helper of ['sw-url', 'sw-date', 'sw-icon', 'sw-flag', 'sw-truncate']) {
      expect(all.some((e) => e.syntax.includes(helper)), helper).toBe(true);
    }
    // eachEntry was merged into #each — the loop entry documents dataset click-to-edit.
    expect(all.some((e) => e.syntax.includes('eachEntry'))).toBe(false);
    const eachEntry = all.find((e) => e.id === 'b-each');
    expect(eachEntry?.description.toLowerCase()).toContain('click-to-edit');
  });

  it('documents that sw-icon needs the "brand:" prefix for brand/social logos', () => {
    const icon = REFERENCE_GROUPS.flatMap((g) => g.entries).find((e) => e.id === 'h-icon');
    expect(icon).toBeDefined();
    // The description must teach the prefix (bare name = Lucide, brand:slug = logo).
    expect(icon?.description).toContain('brand:');
    expect(icon?.example).toContain('brand:');
  });
});
