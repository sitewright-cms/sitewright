import { describe, it, expect } from 'vitest';
import { PageSchema, EntrySchema, ORDER_MAX_SCHEMA } from '../src/index.js';

// The order ceiling was 100_000, which left ~120 units between neighbours in an 831-item group —
// too little for midpoint insertion to survive more than ~6 moves in one spot. Raising a maximum is
// a RELAXATION: every stored value stays valid, so there is nothing to migrate.

const page = (over: Record<string, unknown>) => ({ id: 'p', path: 'p', title: 'T', ...over });
const entry = (over: Record<string, unknown>) => ({ id: 'e_1', dataset: 'news', values: {}, ...over });

describe('sibling order accepts the full 2^31 range', () => {
  it('accepts an order far above the old 100_000 ceiling', () => {
    expect(PageSchema.safeParse(page({ order: 1_000_000 })).success).toBe(true);
    expect(PageSchema.safeParse(page({ order: ORDER_MAX_SCHEMA })).success).toBe(true);
    expect(EntrySchema.safeParse(entry({ order: 1_000_000 })).success).toBe(true);
    expect(EntrySchema.safeParse(entry({ order: ORDER_MAX_SCHEMA })).success).toBe(true);
  });

  it('accepts a legacy value written under the old ceiling (nothing to migrate)', () => {
    expect(PageSchema.safeParse(page({ order: 0 })).success).toBe(true);
    expect(PageSchema.safeParse(page({ order: 99_999 })).success).toBe(true);
    expect(EntrySchema.safeParse(entry({ order: 99_999 })).success).toBe(true);
  });

  it('still rejects a negative, a fraction, and anything past the new ceiling', () => {
    expect(PageSchema.safeParse(page({ order: -1 })).success).toBe(false);
    expect(PageSchema.safeParse(page({ order: 1.5 })).success).toBe(false);
    expect(PageSchema.safeParse(page({ order: ORDER_MAX_SCHEMA + 1 })).success).toBe(false);
    expect(EntrySchema.safeParse(entry({ order: -1 })).success).toBe(false);
    expect(EntrySchema.safeParse(entry({ order: ORDER_MAX_SCHEMA + 1 })).success).toBe(false);
  });

  it('raises the legacy nav.order alongside it, so the two cannot disagree', () => {
    expect(PageSchema.safeParse(page({ nav: { slots: ['header'], order: 1_000_000 } })).success).toBe(true);
  });
});
