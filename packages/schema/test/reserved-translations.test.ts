import { describe, it, expect } from 'vitest';
import {
  RESERVED_TRANSLATION_GROUPS,
  RESERVED_TRANSLATION_DEFAULTS,
  SYSTEM_TRANSLATION_KEYS,
} from '../src/reserved-translations.js';
import { TranslationsSchema } from '../src/website.js';

const SYSTEM_KEYS = [
  'system.close',
  'system.slide_prev',
  'system.slide_next',
  'system.slide_x_of_y',
  'system.go_to_slide',
  'system.carousel_label',
];

describe('reserved translations registry', () => {
  it('has an always-on SYSTEM group (no feature gate) with the component-runtime keys', () => {
    const sys = RESERVED_TRANSLATION_GROUPS.find((g) => g.id === 'system');
    expect(sys).toBeDefined();
    expect(sys!.feature).toBeUndefined(); // no feature → always surfaced in the editor
    expect(sys!.keys.map((k) => k.key)).toEqual(SYSTEM_KEYS);
  });

  it('SYSTEM_TRANSLATION_KEYS mirrors the system group keys', () => {
    expect([...SYSTEM_TRANSLATION_KEYS]).toEqual(SYSTEM_KEYS);
  });

  it('flat defaults include both system and shop keys, with placeholders intact', () => {
    expect(RESERVED_TRANSLATION_DEFAULTS['system.close']).toBe('Close');
    expect(RESERVED_TRANSLATION_DEFAULTS['system.slide_x_of_y']).toBe('Slide {n} of {total}');
    expect(RESERVED_TRANSLATION_DEFAULTS['system.go_to_slide']).toBe('Go to slide {n}');
    expect(RESERVED_TRANSLATION_DEFAULTS['cart.add']).toBe('Add to cart'); // shop group still present
  });

  it('keys are unique across all groups (one flat catalog namespace)', () => {
    const all = RESERVED_TRANSLATION_GROUPS.flatMap((g) => g.keys.map((k) => k.key));
    expect(new Set(all).size).toBe(all.length);
  });

  // The registry's keys ARE catalog keys, so the catalog's own schema has to accept every one of them.
  // This is the guard that lets the registry use dotted scopes at all: KeyNameSchema (the old contract)
  // forbids the dot, TranslationKeySchema allows a dotted scope path.
  it('every reserved key is a valid catalog key', () => {
    const all = RESERVED_TRANSLATION_GROUPS.flatMap((g) => g.keys.map((k) => k.key));
    const catalog = Object.fromEntries(all.map((k) => [k, { en: 'x' }]));
    expect(() => TranslationsSchema.parse(catalog)).not.toThrow();
  });

  // Every key carries exactly ONE scope, so the editor can group them. A key that lost its prefix would
  // otherwise land silently among the operator's free rows.
  it('every reserved key is scoped to a known group prefix', () => {
    const SCOPES = new Set(['system', 'cart', 'theme', 'consent']);
    for (const group of RESERVED_TRANSLATION_GROUPS) {
      for (const { key } of group.keys) {
        const [scope, ...rest] = key.split('.');
        expect(SCOPES.has(scope!), `${key} has no known scope`).toBe(true);
        expect(rest.length, `${key} should be exactly one level deep`).toBe(1);
      }
    }
  });
});
