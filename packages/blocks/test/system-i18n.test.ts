import { describe, it, expect } from 'vitest';
import { systemI18nData } from '../src/system-i18n.js';

describe('systemI18nData (JSON for the <html data-sw-i18n> attribute)', () => {
  it('returns valid JSON of every system key, flooring to English defaults when no catalog', () => {
    const dict = JSON.parse(systemI18nData(undefined));
    expect(dict.close).toBe('Close');
    expect(dict.slide_x_of_y).toBe('Slide {n} of {total}'); // placeholder preserved
    expect(dict.go_to_slide).toBe('Go to slide {n}');
    expect(dict.carousel_label).toBe('carousel');
  });

  it('prefers a catalog value over the default, and floors blank/empty to the default', () => {
    const dict = JSON.parse(systemI18nData({ close: 'Schließen', slide_prev: '   ', go_to_slide: '' }));
    expect(dict.close).toBe('Schließen'); // catalog wins
    expect(dict.slide_prev).toBe('Previous slide'); // blank → default floor
    expect(dict.go_to_slide).toBe('Go to slide {n}'); // empty → default floor
  });

  it('includes ONLY system keys (no cart_* leakage; ignores stray catalog keys)', () => {
    const dict = JSON.parse(systemI18nData({ cart_add: 'X', bogus: 'Y', close: 'C' }));
    expect(dict).not.toHaveProperty('cart_add');
    expect(dict).not.toHaveProperty('bogus');
    expect(dict.close).toBe('C');
  });
});
