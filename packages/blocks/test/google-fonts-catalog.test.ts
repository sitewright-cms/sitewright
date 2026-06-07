import { describe, expect, it } from 'vitest';
import { GOOGLE_FONTS, googleFont, isGoogleFamily, familySlug } from '../src/google-fonts-catalog.js';

describe('google-fonts-catalog', () => {
  it('bundles a substantial, well-formed catalog', () => {
    expect(GOOGLE_FONTS.length).toBeGreaterThan(1000);
    for (const f of GOOGLE_FONTS.slice(0, 50)) {
      expect(typeof f.family).toBe('string');
      expect(['serif', 'sans-serif', 'monospace', 'cursive']).toContain(f.fallback);
      expect(f.weights.length).toBeGreaterThan(0);
      // only normal numeric weights in the 100–900 scale
      for (const w of f.weights) expect(w % 100 === 0 && w >= 100 && w <= 900).toBe(true);
    }
  });

  it('googleFont() returns a known family and undefined for an unknown one', () => {
    const pf = googleFont('Playfair Display');
    expect(pf).toMatchObject({ family: 'Playfair Display', fallback: 'serif' });
    expect(pf!.weights).toContain(700);
    expect(googleFont('Definitely Not A Font')).toBeUndefined();
  });

  it('isGoogleFamily() is the allowlist gate (exact, case-sensitive)', () => {
    expect(isGoogleFamily('Inter')).toBe(true);
    expect(isGoogleFamily('inter')).toBe(false); // exact match only
    expect(isGoogleFamily('../etc/passwd')).toBe(false);
  });

  it('familySlug() produces a path-safe id', () => {
    expect(familySlug('Playfair Display')).toBe('playfair-display');
    expect(familySlug('  Spaced  Out  ')).toBe('spaced-out');
    expect(familySlug("It's Display!")).toBe('it-s-display');
    expect(familySlug('Roboto')).toBe('roboto');
  });
});
