import { describe, it, expect } from 'vitest';
import { systemI18nData } from '../src/system-i18n.js';

describe('systemI18nData (JSON for the <html data-sw-i18n> attribute)', () => {
  it('returns valid JSON of every system key, flooring to English defaults when no catalog', () => {
    const dict = JSON.parse(systemI18nData(undefined));
    expect(dict['system.close']).toBe('Close');
    expect(dict['system.slide_x_of_y']).toBe('Slide {n} of {total}'); // placeholder preserved
    expect(dict['system.go_to_slide']).toBe('Go to slide {n}');
    expect(dict['system.carousel_label']).toBe('carousel');
  });

  it('prefers a catalog value over the default, and floors blank/empty to the default', () => {
    const dict = JSON.parse(
      systemI18nData({ 'system.close': 'Schließen', 'system.slide_prev': '   ', 'system.go_to_slide': '' }),
    );
    expect(dict['system.close']).toBe('Schließen'); // catalog wins
    expect(dict['system.slide_prev']).toBe('Previous slide'); // blank → default floor
    expect(dict['system.go_to_slide']).toBe('Go to slide {n}'); // empty → default floor
  });

  it('includes ONLY system keys (no cart.* leakage; ignores stray catalog keys)', () => {
    const dict = JSON.parse(systemI18nData({ 'cart.add': 'X', bogus: 'Y', 'system.close': 'C' }));
    expect(dict).not.toHaveProperty('cart.add');
    expect(dict).not.toHaveProperty('bogus');
    expect(dict['system.close']).toBe('C');
  });

  // The dict is keyed by the SCOPED registry name, and the component runtimes look it up by that exact
  // string (`swT('system.slide_prev', …)`). A legacy flat key in a stored catalog is lifted by
  // migrateTranslationKeys on read, so it must NOT be honoured here — otherwise the two lookup names
  // would silently diverge and the runtimes would fall back to English with no error anywhere.
  it('ignores a legacy flat key (migration owns that, not the renderer)', () => {
    const dict = JSON.parse(systemI18nData({ close: 'Schließen' }));
    expect(dict['system.close']).toBe('Close');
  });
});
