import { describe, it, expect } from 'vitest';
import { systemI18nScript } from '../src/system-i18n.js';

describe('systemI18nScript', () => {
  it('publishes window.__SW_T__ (merged, not clobbered) with English defaults when no catalog', () => {
    const js = systemI18nScript(undefined);
    expect(js).toContain('window.__SW_T__=Object.assign(window.__SW_T__||{},');
    expect(js).toContain('"close":"Close"');
    expect(js).toContain('"slide_x_of_y":"Slide {n} of {total}"'); // placeholder preserved
    expect(js).toContain('"go_to_slide":"Go to slide {n}"');
    expect(js).toContain('"carousel_label":"carousel"');
  });

  it('prefers a catalog value over the default, and floors blank/empty to the default', () => {
    const js = systemI18nScript({ close: 'Schließen', slide_prev: '   ', go_to_slide: '' });
    expect(js).toContain('"close":"Schließen"'); // catalog wins
    expect(js).toContain('"slide_prev":"Previous slide"'); // blank → default floor
    expect(js).toContain('"go_to_slide":"Go to slide {n}"'); // empty → default floor
  });

  it('includes ONLY system keys (no cart_* leakage; ignores stray catalog keys)', () => {
    const js = systemI18nScript({ cart_add: 'X', bogus: 'Y', close: 'C' });
    expect(js).not.toContain('cart_add');
    expect(js).not.toContain('bogus');
    expect(js).toContain('"close":"C"');
  });
});
