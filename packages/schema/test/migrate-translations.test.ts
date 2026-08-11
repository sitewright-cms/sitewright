import { describe, it, expect } from 'vitest';
import {
  LEGACY_TRANSLATION_KEYS,
  migrateTranslationKeys,
  mergeLegacyTranslations,
} from '../src/migrate-translations.js';
import { RESERVED_TRANSLATION_DEFAULTS } from '../src/reserved-translations.js';
import type { Translations } from '../src/website.js';

// Keys that shipped SCOPED from the start and therefore have no legacy name to migrate from. Listing
// them explicitly is the point: the exhaustiveness test below turns "I added a reserved key and forgot
// the migration row" into a failure, and adding a key here is the deliberate way to say "no legacy name".
const NO_LEGACY_NAME = new Set(['cart.yes']);

describe('reserved translation key migration', () => {
  // The whole compatibility story for the hard rename. A reserved key missing from this map means every
  // catalog still holding its legacy name silently loses that override — no error, just the English default.
  it('maps a legacy name onto every reserved key', () => {
    const reserved = new Set(Object.keys(RESERVED_TRANSLATION_DEFAULTS));
    const migratedTo = new Set(Object.values(LEGACY_TRANSLATION_KEYS));
    const unmapped = [...reserved].filter((k) => !migratedTo.has(k) && !NO_LEGACY_NAME.has(k));
    expect(unmapped, 'reserved keys with no migration row').toEqual([]);
  });

  it('never maps onto a key that is not reserved (no typos in the target names)', () => {
    const reserved = new Set(Object.keys(RESERVED_TRANSLATION_DEFAULTS));
    const strays = Object.values(LEGACY_TRANSLATION_KEYS).filter((k) => !reserved.has(k));
    expect(strays, 'migration targets that no longer exist in the registry').toEqual([]);
  });

  it('lifts a flat catalog onto the scoped names, values untouched', () => {
    const out = migrateTranslationKeys({
      cart_currency_symbol: { en: 'N$' },
      cart_title: { en: 'Your order' },
      close: { en: 'Close', de: 'Schließen' },
    } as unknown as Translations)!;
    expect(out).toEqual({
      'cart.currency_symbol': { en: 'N$' },
      'cart.title': { en: 'Your order' },
      'system.close': { en: 'Close', de: 'Schließen' },
    });
  });

  it('passes operator keys through untouched', () => {
    const input = { 'home.headline': { en: 'Hi' }, nav_cta: { en: 'Order' }, 'shop.name': { en: 'Name' } };
    expect(migrateTranslationKeys({ ...input, cart_add: { en: 'Add' } } as unknown as Translations)).toEqual({
      ...input,
      'cart.add': { en: 'Add' },
    });
  });

  it('is idempotent and returns the SAME reference when nothing needs lifting', () => {
    const already = { 'cart.add': { en: 'Add' }, 'home.x': { en: 'y' } } as unknown as Translations;
    expect(migrateTranslationKeys(already)).toBe(already);
    expect(migrateTranslationKeys(migrateTranslationKeys(already))).toBe(already);
  });

  it('prefers the scoped row when both names are present, and drops the legacy one', () => {
    const out = migrateTranslationKeys({
      cart_add: { en: 'OLD' },
      'cart.add': { en: 'NEW' },
    } as unknown as Translations)!;
    expect(out).toEqual({ 'cart.add': { en: 'NEW' } });
    expect(Object.keys(out)).not.toContain('cart_add');
  });

  it('mergeLegacyTranslations reaches website.translations and leaves everything else alone', () => {
    const raw = {
      identity: { name: 'Acme' },
      settings: { defaultLocale: 'en' },
      website: { siteUrl: 'https://acme.test', translations: { cart_currency_code: { en: 'NAD' } } },
    };
    const out = mergeLegacyTranslations(raw) as typeof raw;
    expect(out.website.translations).toEqual({ 'cart.currency_code': { en: 'NAD' } });
    expect(out.identity).toBe(raw.identity); // untouched branches keep their reference
    expect(out.website.siteUrl).toBe('https://acme.test');
  });

  it('mergeLegacyTranslations passes through anything that is not shaped like settings', () => {
    for (const raw of [undefined, null, 42, 'x', [], {}, { website: null }, { website: { translations: 7 } }]) {
      expect(mergeLegacyTranslations(raw)).toBe(raw);
    }
  });

  it('does not carry prototype-polluting keys across', () => {
    const hostile = JSON.parse('{"__proto__":{"en":"bad"},"cart_add":{"en":"ok"}}') as Translations;
    const out = migrateTranslationKeys(hostile)!;
    expect(Object.keys(out)).toEqual(['cart.add']);
    expect(({} as Record<string, unknown>).en).toBeUndefined();
  });
});
