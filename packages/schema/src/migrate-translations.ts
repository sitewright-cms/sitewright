import type { Translations } from './website.js';

// Reserved translation keys were FLAT (`cart_add`, `consent_title`, `theme_toggle`, `close`) and are now
// SCOPED (`cart.add`, `consent.title`, `theme.toggle`, `system.close`) so they group in the editor's
// translation table like every operator key already does — see ./reserved-translations.ts.
//
// The rename is HARD: no helper reads a legacy name, so a stored catalog that still uses one would
// silently fall back to the built-in English default (a shop's `N$` reverting to `$`, with no error
// anywhere). This module is the whole compatibility story — a one-shot lift applied when a project's
// settings are read, so the rewrite cannot be forgotten and no operator action is required.
//
// Modelled on ./migrate-identity.ts: a pure, exhaustively-tested mapping plus an idempotent transform.

// Keys we never copy from an untrusted record (prototype-pollution defence-in-depth; the schema strips
// them downstream, but don't carry them at all).
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Legacy flat key → current scoped key, for every reserved key that has ever shipped.
 *
 * This map is APPEND-ONLY and must never lose a row: dropping one silently orphans that string in every
 * catalog still holding it. `migrate-translations.test.ts` asserts the map's values cover
 * RESERVED_TRANSLATION_DEFAULTS exactly, so adding a reserved key without a legacy name (e.g. `cart.yes`,
 * which shipped scoped from the start) is a deliberate omission the test spells out rather than a silent gap.
 */
export const LEGACY_TRANSLATION_KEYS: Readonly<Record<string, string>> = Object.freeze({
  // Shop · Cart
  cart_add: 'cart.add',
  cart_title: 'cart.title',
  cart_toggle: 'cart.toggle',
  cart_note: 'cart.note',
  cart_added: 'cart.added',
  cart_empty: 'cart.empty',
  cart_total: 'cart.total',
  cart_clear: 'cart.clear',
  cart_sent: 'cart.sent',
  cart_order_lead: 'cart.order_lead',
  cart_currency_symbol: 'cart.currency_symbol',
  cart_currency_code: 'cart.currency_code',
  // Themes
  theme_toggle: 'theme.toggle',
  // Consent · Cookie banner
  consent_title: 'consent.title',
  consent_intro: 'consent.intro',
  consent_accept_all: 'consent.accept_all',
  consent_reject_all: 'consent.reject_all',
  consent_customize: 'consent.customize',
  consent_save: 'consent.save',
  consent_prefs_title: 'consent.prefs_title',
  consent_settings: 'consent.settings',
  consent_privacy: 'consent.privacy',
  consent_necessary: 'consent.necessary',
  consent_necessary_desc: 'consent.necessary_desc',
  consent_functional: 'consent.functional',
  consent_functional_desc: 'consent.functional_desc',
  consent_analytics: 'consent.analytics',
  consent_analytics_desc: 'consent.analytics_desc',
  consent_marketing: 'consent.marketing',
  consent_marketing_desc: 'consent.marketing_desc',
  consent_allow_once: 'consent.allow_once',
  consent_always_allow: 'consent.always_allow',
  consent_embed_note: 'consent.embed_note',
  // System · Components
  close: 'system.close',
  slide_prev: 'system.slide_prev',
  slide_next: 'system.slide_next',
  slide_x_of_y: 'system.slide_x_of_y',
  go_to_slide: 'system.go_to_slide',
  carousel_label: 'system.carousel_label',
});

/**
 * Lift a stored translation catalog onto the scoped reserved keys.
 *
 * IDEMPOTENT — an already-migrated catalog is returned unchanged (by value), so this is safe to run on
 * every read. Rules:
 *  - a legacy key moves to its scoped name and the legacy row disappears;
 *  - if BOTH names are present the scoped one WINS and the legacy row is dropped — the operator edited
 *    the new row, so their newer intent is the one to keep;
 *  - a non-reserved key (`home.headline`, `shop.name`) is passed through untouched;
 *  - insertion order is preserved, so the editor's alphabetical load order is unaffected.
 *
 * Returns the SAME object reference when nothing needed lifting, so callers can cheaply detect a no-op
 * (`migrated === original`) and skip a pointless settings write.
 */
export function migrateTranslationKeys(translations: Translations | undefined): Translations | undefined {
  if (!translations) return translations;
  const legacyPresent = Object.keys(translations).some(
    (k) => Object.prototype.hasOwnProperty.call(LEGACY_TRANSLATION_KEYS, k) && !DANGEROUS_KEYS.has(k),
  );
  if (!legacyPresent) return translations; // hot path: already scoped (or a catalog of purely operator keys)

  const out: Record<string, unknown> = {};
  for (const [key, cells] of Object.entries(translations)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    const scoped = Object.prototype.hasOwnProperty.call(LEGACY_TRANSLATION_KEYS, key)
      ? // eslint-disable-next-line security/detect-object-injection -- guarded by hasOwnProperty against a frozen const map, and DANGEROUS_KEYS is excluded above
        LEGACY_TRANSLATION_KEYS[key]!
      : key;
    // The scoped row wins: only fill from a legacy row when the scoped name carries nothing yet.
    if (scoped !== key && Object.prototype.hasOwnProperty.call(translations, scoped)) continue;
    // eslint-disable-next-line security/detect-object-injection -- `scoped` is a frozen-map value or the original key; proto keys excluded above
    out[scoped] = cells;
  }
  return out as Translations;
}

/**
 * Normalize any record carrying `website.translations` (a `settings` row, a bundle's `project`) onto the
 * scoped reserved keys. The settings-level twin of {@link mergeLegacyIdentity} and applied at the same read
 * boundaries (DB settings row, bundle import) via `z.preprocess`, so old catalogs upgrade transparently on
 * read and re-persist on the next put.
 *
 * Defensive by design — this runs BEFORE schema validation, so every level is shape-checked and anything
 * unexpected is passed through untouched for the schema to reject with its own message. Returns the input
 * reference unchanged when there is nothing to lift, so an already-migrated row costs one key scan.
 */
export function mergeLegacyTranslations(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  const website = obj.website;
  if (!website || typeof website !== 'object' || Array.isArray(website)) return raw;
  const w = website as Record<string, unknown>;
  const t = w.translations;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return raw;
  const migrated = migrateTranslationKeys(t as Translations);
  if (migrated === t) return raw; // already scoped — no copy
  return { ...obj, website: { ...w, translations: migrated } };
}
