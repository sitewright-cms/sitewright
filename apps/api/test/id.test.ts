import { describe, it, expect } from 'vitest';
import { IdSchema } from '@sitewright/schema';
import { newId } from '../src/id.js';

describe('newId', () => {
  it('is 12 base62 chars by default and honours a custom length', () => {
    expect(newId()).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(newId(8)).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(newId(24)).toHaveLength(24);
  });

  it('always satisfies IdSchema (so it is a drop-in for any internal id column)', () => {
    for (let i = 0; i < 200; i += 1) expect(() => IdSchema.parse(newId())).not.toThrow();
  });

  it('is collision-free across a large batch (unique primary keys)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) ids.add(newId());
    expect(ids.size).toBe(20_000);
  });

  it('uses the full base62 alphabet (no single char dominates → no gross modulo bias)', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 2_000; i += 1) for (const ch of newId()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    // 24k chars over 62 symbols ≈ 387 each; a biased mapping would spike some far above others.
    expect(counts.size).toBeGreaterThan(55);
    const max = Math.max(...counts.values());
    expect(max).toBeLessThan(900); // ~2.3× the mean — well within sampling noise, not a 4× bias spike
  });
});
