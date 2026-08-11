import { describe, it, expect } from 'vitest';
import { SettingsSchema } from '../src/repo/content.js';

// The reserved translation keys were renamed flat → scoped (`cart_add` → `cart.add`) with NO read-time
// alias, so this preprocess is the ONLY thing standing between a live project and the silent loss of every
// cart/consent/theme override it has ever set. The unit tests in @sitewright/schema cover the mapping;
// this covers the wiring — that a settings row actually goes THROUGH it on read.
//
// The failure mode it guards is quiet: an unmigrated key renders as the built-in English default, so a
// shop's "N$" would revert to "$" with nothing logged and no test failing anywhere else.

const base = {
  identity: { name: 'Forever Living with Elvi', colors: {} },
  settings: { defaultLocale: 'en', locales: ['en'] },
};

describe('settings read: legacy translation keys are lifted onto their scoped names', () => {
  it('migrates a stored row through SettingsSchema, values byte-identical', () => {
    // The real catalog of project jUckbzJv9x00 — a single-locale Namibian shop.
    const parsed = SettingsSchema.parse({
      ...base,
      website: {
        shop: { enabled: true },
        translations: {
          cart_currency_symbol: { en: 'N$' },
          cart_currency_code: { en: 'NAD' },
          cart_title: { en: 'Your order' },
          cart_note: { en: 'Prices are indicative.' },
          nav_cta: { en: 'Order on WhatsApp' }, // an OPERATOR key — must survive untouched
        },
      },
    }) as { website?: { translations?: Record<string, Record<string, string>> } };

    const t = parsed.website!.translations!;
    expect(t['cart.currency_symbol']).toEqual({ en: 'N$' });
    expect(t['cart.currency_code']).toEqual({ en: 'NAD' });
    expect(t['cart.title']).toEqual({ en: 'Your order' });
    expect(t['cart.note']).toEqual({ en: 'Prices are indicative.' });
    expect(t.nav_cta).toEqual({ en: 'Order on WhatsApp' });
    // the legacy names are gone, not duplicated — a project must not carry both spellings
    expect(Object.keys(t).filter((k) => k.startsWith('cart_'))).toEqual([]);
  });

  it('lifts consent, theme and system keys too, not just the cart', () => {
    const parsed = SettingsSchema.parse({
      ...base,
      website: {
        translations: {
          consent_title: { en: 'Privacy' },
          theme_toggle: { en: 'Dark mode' },
          close: { en: 'Shut' },
          slide_next: { en: 'Onward' },
        },
      },
    }) as { website?: { translations?: Record<string, Record<string, string>> } };
    expect(Object.keys(parsed.website!.translations!).sort()).toEqual([
      'consent.title',
      'system.close',
      'system.slide_next',
      'theme.toggle',
    ]);
  });

  it('leaves an already-migrated row exactly as stored (idempotent on every read)', () => {
    const translations = { 'cart.title': { en: 'Your order' }, 'home.headline': { en: 'Hi' } };
    const parsed = SettingsSchema.parse({ ...base, website: { translations } }) as {
      website?: { translations?: Record<string, Record<string, string>> };
    };
    expect(parsed.website!.translations).toEqual(translations);
  });
});
