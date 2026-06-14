import { describe, it, expect } from 'vitest';
import { translate, resolveTranslations } from '../src/translate.js';

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
