import { describe, it, expect } from 'vitest';
import { translate, resolveTranslations, setTranslationCell, pruneTranslationsLocale } from '../src/translate.js';

const cat = {
  nav_home: { en: 'Home', de: 'Start', es: 'Inicio' },
  nav_cta: { en: 'Get started', de: '' }, // de cell empty → not translated
  only_en: { en: 'Only EN' },
};

describe('translate', () => {
  it('returns the locale string when present', () => {
    expect(translate(cat, 'nav_home', 'de', 'en')).toBe('Start');
    expect(translate(cat, 'nav_home', 'es', 'en')).toBe('Inicio');
  });
  it('falls back to defaultLocale when the locale cell is missing OR empty', () => {
    expect(translate(cat, 'only_en', 'de', 'en')).toBe('Only EN'); // missing de → en
    expect(translate(cat, 'nav_cta', 'de', 'en')).toBe('Get started'); // empty de → en
  });
  it('falls back to the provided fallback, then "", when nothing resolves', () => {
    expect(translate(cat, 'missing_key', 'de', 'en', 'Default')).toBe('Default');
    expect(translate(cat, 'missing_key', 'de', 'en')).toBe('');
    expect(translate(undefined, 'nav_home', 'de', 'en', 'x')).toBe('x');
  });
  it('is prototype-safe (no own-property → fallback)', () => {
    expect(translate(cat, '__proto__', 'en', 'en', 'safe')).toBe('safe');
    expect(translate(cat, 'constructor', 'en', 'en', 'safe')).toBe('safe');
  });
  it('does not fall back to default when the locale IS the default (no double-read)', () => {
    expect(translate(cat, 'nav_cta', 'en', 'en')).toBe('Get started');
  });
});

describe('resolveTranslations', () => {
  it('flattens the catalog to a key→string map for one locale, omitting unresolved keys', () => {
    expect(resolveTranslations(cat, 'de', 'en')).toEqual({
      nav_home: 'Start',
      nav_cta: 'Get started', // empty de → en fallback
      only_en: 'Only EN', // missing de → en fallback
    });
  });
  it('omits a key with no value in either locale', () => {
    const c = { ghost: { fr: '' }, real: { en: 'R' } };
    expect(resolveTranslations(c, 'de', 'en')).toEqual({ real: 'R' });
  });
  it('returns {} for an absent catalog and skips proto keys', () => {
    expect(resolveTranslations(undefined, 'en', 'en')).toEqual({});
    expect(resolveTranslations({ ['__proto__']: { en: 'x' } } as never, 'en', 'en')).toEqual({});
  });
});

describe('setTranslationCell', () => {
  it('sets a cell without mutating the input', () => {
    const before = { nav_home: { en: 'Home' } };
    const after = setTranslationCell(before, 'nav_home', 'de', 'Start');
    expect(after).toEqual({ nav_home: { en: 'Home', de: 'Start' } });
    expect(before).toEqual({ nav_home: { en: 'Home' } }); // unchanged
  });
  it('creates the key + catalog when absent', () => {
    expect(setTranslationCell(undefined, 'fresh', 'en', 'Hi')).toEqual({ fresh: { en: 'Hi' } });
    expect(setTranslationCell({}, 'fresh', 'de', 'Hallo')).toEqual({ fresh: { de: 'Hallo' } });
  });
  it('an EMPTY value deletes the cell (and drops a key left with no cells)', () => {
    expect(setTranslationCell({ k: { en: 'X', de: 'Y' } }, 'k', 'de', '')).toEqual({ k: { en: 'X' } });
    expect(setTranslationCell({ k: { en: 'X' } }, 'k', 'en', '')).toEqual({}); // last cell gone → key dropped
  });
  it('overwrites an existing cell', () => {
    expect(setTranslationCell({ k: { en: 'old' } }, 'k', 'en', 'new')).toEqual({ k: { en: 'new' } });
  });
  it('is a no-op (shallow copy) for proto / empty key or locale', () => {
    expect(setTranslationCell({ a: { en: '1' } }, '__proto__', 'en', 'x')).toEqual({ a: { en: '1' } });
    expect(setTranslationCell({ a: { en: '1' } }, 'a', 'constructor', 'x')).toEqual({ a: { en: '1' } });
    expect(setTranslationCell({ a: { en: '1' } }, '', 'en', 'x')).toEqual({ a: { en: '1' } });
    expect(Object.prototype.hasOwnProperty.call(setTranslationCell({}, '__proto__', 'en', 'x'), '__proto__')).toBe(false);
  });
});

describe('pruneTranslationsLocale', () => {
  it('removes the locale from every key, dropping keys left empty', () => {
    const before = { a: { en: 'A', de: 'A-de' }, b: { de: 'B-de' }, c: { en: 'C' } };
    const after = pruneTranslationsLocale(before, 'de');
    expect(after).toEqual({ a: { en: 'A' }, c: { en: 'C' } }); // b had only de → dropped
    expect(before.a).toEqual({ en: 'A', de: 'A-de' }); // input unchanged
  });
  it('returns {} for an absent catalog and skips proto keys/locales', () => {
    expect(pruneTranslationsLocale(undefined, 'de')).toEqual({});
    expect(pruneTranslationsLocale({ ['__proto__']: { de: 'x' } } as never, 'de')).toEqual({});
  });
  it('is a no-op for a locale that is not present', () => {
    expect(pruneTranslationsLocale({ a: { en: 'A' } }, 'fr')).toEqual({ a: { en: 'A' } });
  });
});
