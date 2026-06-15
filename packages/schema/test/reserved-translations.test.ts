import { describe, it, expect } from 'vitest';
import {
  RESERVED_TRANSLATION_GROUPS,
  RESERVED_TRANSLATION_DEFAULTS,
  SYSTEM_TRANSLATION_KEYS,
} from '../src/reserved-translations.js';

describe('reserved translations registry', () => {
  it('has an always-on SYSTEM group (no feature gate) with the component-runtime keys', () => {
    const sys = RESERVED_TRANSLATION_GROUPS.find((g) => g.id === 'system');
    expect(sys).toBeDefined();
    expect(sys!.feature).toBeUndefined(); // no feature → always surfaced in the editor
    const keys = sys!.keys.map((k) => k.key);
    expect(keys).toEqual(['close', 'slide_prev', 'slide_next', 'slide_x_of_y', 'go_to_slide', 'carousel_label']);
  });

  it('SYSTEM_TRANSLATION_KEYS mirrors the system group keys', () => {
    expect([...SYSTEM_TRANSLATION_KEYS]).toEqual(['close', 'slide_prev', 'slide_next', 'slide_x_of_y', 'go_to_slide', 'carousel_label']);
  });

  it('flat defaults include both system and shop keys, with placeholders intact', () => {
    expect(RESERVED_TRANSLATION_DEFAULTS.close).toBe('Close');
    expect(RESERVED_TRANSLATION_DEFAULTS.slide_x_of_y).toBe('Slide {n} of {total}');
    expect(RESERVED_TRANSLATION_DEFAULTS.go_to_slide).toBe('Go to slide {n}');
    expect(RESERVED_TRANSLATION_DEFAULTS.cart_add).toBe('Add to cart'); // shop group still present
  });

  it('keys are unique across all groups (one flat catalog namespace)', () => {
    const all = RESERVED_TRANSLATION_GROUPS.flatMap((g) => g.keys.map((k) => k.key));
    expect(new Set(all).size).toBe(all.length);
  });
});
