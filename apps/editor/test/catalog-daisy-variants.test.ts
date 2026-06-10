import { describe, it, expect } from 'vitest';
import { LIBRARY_SECTIONS } from '../src/views/library/catalog';
import { DAISY_VARIANTS } from '../src/views/library/catalog-daisy-variants';

const daisyItems = LIBRARY_SECTIONS.find((s) => s.category === 'daisyui')!.items;
const itemIds = new Set(daisyItems.map((i) => i.id));

describe('DaisyUI variants catalog', () => {
  it('keys every variant set to a REAL daisy catalog item id (no orphans)', () => {
    const orphans = Object.keys(DAISY_VARIANTS).filter((id) => !itemIds.has(id));
    expect(orphans).toEqual([]);
  });

  it('provides variants for EVERY daisy component (full coverage)', () => {
    const missing = daisyItems.filter((i) => (DAISY_VARIANTS[i.id]?.length ?? 0) === 0).map((i) => i.name);
    expect(missing).toEqual([]);
  });

  it('every variant has a non-empty name + example', () => {
    for (const [id, variants] of Object.entries(DAISY_VARIANTS)) {
      for (const v of variants) {
        expect(v.name, `${id} variant name`).toBeTruthy();
        expect(v.example.trim().length, `${id} / ${v.name} example`).toBeGreaterThan(0);
      }
    }
  });

  it('contains only SAFE static markup (no script, event handlers, or active-scheme URLs)', () => {
    for (const [id, variants] of Object.entries(DAISY_VARIANTS)) {
      for (const v of variants) {
        const where = `${id} / ${v.name}`;
        expect(/<script/i.test(v.example), `${where}: <script>`).toBe(false);
        // Any attribute separator before on*= (space, quote, or slash) — catches `<img/onerror=` too.
        expect(/[\s"'/]on[a-z]+\s*=/i.test(v.example), `${where}: on* handler`).toBe(false); // onclick=, onload=, …
        expect(/javascript:/i.test(v.example), `${where}: javascript:`).toBe(false);
        expect(/\bdata:[a-z]/i.test(v.example), `${where}: data: URL`).toBe(false); // data-* attrs are fine
        expect(v.example.includes('{{'), `${where}: Handlebars`).toBe(false);
      }
    }
  });

  it('covers a healthy number of variants overall', () => {
    const total = Object.values(DAISY_VARIANTS).reduce((n, vs) => n + vs.length, 0);
    expect(total).toBeGreaterThan(250); // ~all components x several documented variants each
  });
});
