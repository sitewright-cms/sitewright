import { describe, it, expect } from 'vitest';
import { normalizeEntryValues } from '../src/repo/entry-values.js';

// The write side nests a row's fields under `values`; the render side reads them bare. Sending them
// FLAT used to strip the unknown keys, save `values:{}`, report success, and render nothing — the agent
// guide calls it "THE #1 MISTAKE", which is an admission the shape is surprising, not a defence of it.
describe('normalizeEntryValues', () => {
  it('folds flat field values into values', () => {
    expect(normalizeEntryValues({ id: 'delays', dataset: 'faq', question: 'Q?', answer: 'A.' })).toEqual({
      values: { question: 'Q?', answer: 'A.' },
      id: 'delays',
      dataset: 'faq',
    });
  });

  it('leaves a correctly-shaped body completely alone', () => {
    const good = { id: 'x', dataset: 'faq', status: 'published', order: 2, values: { q: 1 } };
    expect(normalizeEntryValues(good)).toBe(good); // same reference — no work done
  });

  it('merges a MIXED body, and an explicit values wins the collision', () => {
    // The caller said where that one belongs; a stray key of the same name must not overwrite it.
    expect(normalizeEntryValues({ id: 'x', dataset: 'd', title: 'flat', values: { title: 'nested', a: 1 } })).toEqual({
      values: { title: 'nested', a: 1 },
      id: 'x',
      dataset: 'd',
    });
  });

  it('keeps every envelope key exactly as given', () => {
    const out = normalizeEntryValues({
      id: 'x', dataset: 'd', locale: 'de', status: 'draft', order: 7, headline: 'H',
    }) as Record<string, unknown>;
    expect(out.id).toBe('x');
    expect(out.dataset).toBe('d');
    expect(out.locale).toBe('de');
    expect(out.status).toBe('draft');
    expect(out.order).toBe(7);
    expect(out.values).toEqual({ headline: 'H' });
  });

  it('is inert on non-objects', () => {
    for (const v of [null, undefined, 'x', 42, [1, 2]]) expect(normalizeEntryValues(v)).toBe(v);
  });
});
