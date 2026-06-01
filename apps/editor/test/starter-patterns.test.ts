import { describe, it, expect } from 'vitest';
import { PatternSchema } from '@sitewright/schema';
import { renderNode } from '@sitewright/blocks';
import { STARTER_PATTERNS } from '../src/lib/starter-patterns';

describe('STARTER_PATTERNS (built-in global snippet library)', () => {
  it('has unique pattern ids and non-empty names', () => {
    const ids = STARTER_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(STARTER_PATTERNS.every((p) => p.name.trim().length > 0)).toBe(true);
  });

  for (const pattern of STARTER_PATTERNS) {
    it(`"${pattern.name}" validates against PatternSchema and renders to HTML`, () => {
      // Parse the literal through the real schema — guards prop shapes + tree safety.
      const parsed = PatternSchema.parse(pattern);
      // Every block type resolves in the renderer (no unknown type throws).
      const html = renderNode(parsed.root);
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain('data-sw-block=');
    });
  }
});
