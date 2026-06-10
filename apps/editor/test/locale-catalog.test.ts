import { describe, it, expect } from 'vitest';
import {
  LOCALE_CATALOG,
  localeInfo,
  localeLabel,
  localeFlag,
  validateLocale,
} from '../src/views/i18n/locale-catalog';

describe('locale-catalog', () => {
  it('has a unique, well-formed catalog', () => {
    const codes = LOCALE_CATALOG.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length); // no duplicates
    for (const l of LOCALE_CATALOG) {
      expect(l.code).toMatch(/^[A-Za-z0-9-]+$/);
      expect(l.name.length).toBeGreaterThan(0);
      expect(l.flag.length).toBeGreaterThan(0);
    }
  });

  it('localeInfo is case-insensitive and undefined for unknown tags', () => {
    expect(localeInfo('DE')?.name).toBe('German');
    expect(localeInfo('de')?.name).toBe('German');
    expect(localeInfo('xx-yy')).toBeUndefined();
  });

  it('localeLabel falls back to the tag for unknown locales', () => {
    expect(localeLabel('fr')).toBe('French');
    expect(localeLabel('xx')).toBe('xx');
  });

  it('localeFlag uses the catalog, derives from a region subtag, else a globe', () => {
    expect(localeFlag('de')).toBe('🇩🇪'); // catalog
    expect(localeFlag('en-CA')).toBe('🇨🇦'); // derived from the region subtag
    expect(localeFlag('xx')).toBe('🌐'); // no catalog entry, no region
  });

  it('validateLocale accepts valid tags and rejects bad ones', () => {
    expect(validateLocale('  pt-BR ')).toEqual({ locale: 'pt-BR' });
    expect(validateLocale('').error).toBeTruthy();
    expect(validateLocale('de_DE').error).toBeTruthy(); // underscore not allowed
    expect(validateLocale('a'.repeat(40)).error).toBeTruthy(); // too long
  });
});
