import { describe, it, expect } from 'vitest';
import { GOOGLE_FONTS } from '@sitewright/blocks/google-fonts-catalog';
import { searchGoogleFonts, resolveGoogleFamily, suggestGoogleFamilies } from '../src/google-fonts.js';

/**
 * `search_google_fonts` answers from the catalog the platform already bundles (the editor's picker
 * and the server-side download allowlist read the same list), so finding a family costs no request
 * to anyone — and a family it returns is exactly one `select_google_font` will accept.
 */
describe('searchGoogleFonts', () => {
  it('ranks an exact name first, then names that START with the query, then the rest', () => {
    const families = searchGoogleFonts('inter', { limit: 50 }).map((f) => f.family);
    expect(families[0]).toBe('Inter');
    const firstNonPrefix = families.findIndex((f) => !f.toLowerCase().startsWith('inter'));
    if (firstNonPrefix >= 0) {
      expect(families.slice(firstNonPrefix).every((f) => !f.toLowerCase().startsWith('inter'))).toBe(true);
    }
  });

  it('matches case-insensitively, anywhere in the name', () => {
    expect(searchGoogleFonts('DISPLAY').map((f) => f.family)).toContain('Playfair Display');
  });

  it('a word-start match ("Open Sans") outranks a match mid-word ("Parkinsans")', () => {
    const families = searchGoogleFonts('sans', { limit: 1000 }).map((f) => f.family);
    expect(families).toContain('Parkinsans');
    expect(families.indexOf('Open Sans')).toBeLessThan(families.indexOf('Parkinsans'));
    // Every mid-word hit trails every word-start hit.
    expect(families.at(-1)).toBe('Parkinsans');
  });

  it('filters by the generic category, with or without a query', () => {
    const mono = searchGoogleFonts('', { category: 'monospace', limit: 1000 });
    expect(mono.length).toBeGreaterThan(5);
    expect(mono.every((f) => f.fallback === 'monospace')).toBe(true);
    expect(mono).toHaveLength(GOOGLE_FONTS.filter((f) => f.fallback === 'monospace').length);
    expect(searchGoogleFonts('roboto', { category: 'monospace' }).map((f) => f.family)).toContain('Roboto Mono');
  });

  it('honours the limit, defaults to 20, and finds nothing for nonsense', () => {
    expect(searchGoogleFonts('a')).toHaveLength(20);
    expect(searchGoogleFonts('a', { limit: 3 })).toHaveLength(3);
    expect(searchGoogleFonts('zzqx nonexistent')).toEqual([]);
  });
});

describe('resolveGoogleFamily / suggestGoogleFamilies', () => {
  it('resolves a family case-insensitively to the catalog spelling, and nothing else', () => {
    expect(resolveGoogleFamily('Inter')).toBe('Inter');
    expect(resolveGoogleFamily('  playfair DISPLAY ')).toBe('Playfair Display');
    expect(resolveGoogleFamily('Playfair Bold')).toBeUndefined();
  });

  it('suggests by the whole name, else by its first word (a style word glued on)', () => {
    expect(suggestGoogleFamilies('Display SC')).toContain('Playfair Display SC');
    expect(suggestGoogleFamilies('Open Sans Light')).toContain('Open Sans');
    expect(suggestGoogleFamilies('Zzqx Nonexistent')).toEqual([]);
    expect(suggestGoogleFamilies('o', 2)).toHaveLength(2);
  });
});
