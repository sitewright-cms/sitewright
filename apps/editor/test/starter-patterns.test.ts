import { describe, it, expect } from 'vitest';
import { PatternSchema } from '@sitewright/schema';
import { renderNode } from '@sitewright/blocks';
import { findDuplicateIds } from '@sitewright/core';
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
      // Node ids must be unique within the tree, or the editor's tree walker would
      // edit the wrong node after insert.
      expect(findDuplicateIds(parsed.root), `duplicate node ids in "${pattern.name}"`).toHaveLength(0);
      // Every block type resolves in the renderer (no unknown type throws).
      const html = renderNode(parsed.root);
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain('data-sw-block=');
    });
  }
});
