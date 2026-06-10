import { describe, it, expect } from 'vitest';
import { flagIcon, FLAG_CODES } from '../src/flag-icons.js';

describe('flag-icons (flag-icons 4:3 + circle-flags, MIT)', () => {
  it('exposes the full ISO set (+ org flags) keyed by alpha-2 code', () => {
    expect(FLAG_CODES.length).toBeGreaterThanOrEqual(240);
    for (const code of ['de', 'us', 'gb', 'fr', 'jp', 'br', 'za', 'au']) {
      expect(FLAG_CODES).toContain(code);
    }
    // The 5 organisation flags are included (rectangle-only).
    for (const org of ['asean', 'cefta', 'eac', 'arab', 'pc']) expect(FLAG_CODES).toContain(org);
  });

  it('resolves a code case-insensitively to a named, full-color rectangular flag', () => {
    const de = flagIcon('DE');
    expect(de?.name).toBe('Germany');
    expect(de?.rect.viewBox).toBe('0 0 640 480');
    expect(de?.rect.body).toContain('fill='); // keeps its own colors (not currentColor)
    expect(flagIcon('zz')).toBeUndefined();
  });

  it('every flag has a valid rectangular shape; ISO flags also have a circular one', () => {
    const orgs = new Set(['asean', 'cefta', 'eac', 'arab', 'pc']);
    for (const code of FLAG_CODES) {
      const f = flagIcon(code)!;
      expect(f.name.length, code).toBeGreaterThan(0);
      expect(f.rect.viewBox, code).toMatch(/^0 0 \d+ \d+$/);
      expect(f.rect.body.length, code).toBeGreaterThan(10);
      if (!orgs.has(code)) {
        expect(f.circle, code).not.toBeNull();
        expect(f.circle!.viewBox, code).toBe('0 0 512 512');
      }
    }
  });

  it('inlined markup carries no active content and every id is namespaced per country', () => {
    for (const code of FLAG_CODES) {
      const f = flagIcon(code)!;
      for (const shape of [f.rect, f.circle]) {
        if (!shape) continue;
        expect(/<script|<style|\son[a-z-]+=|javascript:/i.test(shape.body), code).toBe(false);
        // Any id in the body must start with the per-(shape,code) prefix → no cross-flag collisions.
        for (const m of shape.body.matchAll(/\bid="([^"]+)"/g)) {
          const id = m[1]!;
          expect(id.startsWith(`r${code}-`) || id.startsWith(`c${code}-`), `${code}:${id}`).toBe(true);
        }
      }
    }
  });
});
