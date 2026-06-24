import { describe, expect, it } from 'vitest';
import { mapFaIcon } from '../src/nativize/icon-map.js';
import { ICON_NAMES, BRAND_ICON_NAMES } from '@sitewright/blocks';

const LUCIDE = new Set(ICON_NAMES);
const BRANDS = new Set(BRAND_ICON_NAMES);

describe('mapFaIcon — catalog-aware FontAwesome → {{sw-icon}}', () => {
  it('matches FA names that equal a Lucide name directly (no alias needed)', () => {
    for (const n of ['phone', 'star', 'heart', 'user', 'users', 'search', 'calendar', 'clock', 'globe', 'lightbulb', 'handshake', 'briefcase', 'repeat']) {
      expect(mapFaIcon(`fa fa-${n}`), n).toBe(n);
    }
  });

  it('resolves aliases for genuine naming differences', () => {
    expect(mapFaIcon('fa fa-suitcase')).toBe('briefcase');
    expect(mapFaIcon('fa fa-envelope')).toBe('mail');
    expect(mapFaIcon('fa fa-paper-plane')).toBe('send');
    expect(mapFaIcon('fa fa-map-marker')).toBe('map-pin');
    expect(mapFaIcon('fa fa-bars')).toBe('menu');
    expect(mapFaIcon('fa fa-question-circle')).toBe('circle-help');
    expect(mapFaIcon('fa fa-pencil-square-o')).toBe('square-pen');
    expect(mapFaIcon('fa fa-sign-out')).toBe('log-out'); // 'sign-out' isn't a Lucide name → alias
    expect(mapFaIcon('fa fa-life-ring')).toBe('life-buoy');
  });

  it('ignores FA size/style/animation modifiers when finding the icon token', () => {
    expect(mapFaIcon('fa fa-4x fa-suitcase mt-auto')).toBe('briefcase');
    expect(mapFaIcon('fas fa-fw fa-spin fa-handshake')).toBe('handshake');
  });

  it('strips FA outline (-o) / -alt variants to the base name', () => {
    expect(mapFaIcon('fa fa-lightbulb-o')).toBe('lightbulb');
    expect(mapFaIcon('fa fa-handshake-o')).toBe('handshake');
    expect(mapFaIcon('fa fa-mobile-alt')).toBe('smartphone');
  });

  it('maps social icons to brand: slugs (and LinkedIn to the Lucide glyph)', () => {
    expect(mapFaIcon('fab fa-facebook-f')).toBe('brand:facebook');
    expect(mapFaIcon('fab fa-instagram')).toBe('brand:instagram');
    expect(mapFaIcon('fab fa-youtube')).toBe('brand:youtube');
    expect(mapFaIcon('fab fa-twitter')).toBe('brand:x'); // simple-icons renamed twitter → x
    expect(mapFaIcon('fab fa-linkedin')).toBe('linkedin'); // LinkedIn lives in Lucide, not the brand set
  });

  it('every produced name actually EXISTS in the platform icon sets (no dangling refs)', () => {
    const samples = ['fa-suitcase', 'fa-envelope', 'fa-question-circle', 'fa-cog', 'fa-twitter', 'fa-facebook-f', 'fa-linkedin', 'fa-pie-chart', 'fa-sign-out', 'fa-trash'];
    for (const s of samples) {
      const r = mapFaIcon(`fa ${s}`);
      expect(r, s).toBeTruthy();
      if (r!.startsWith('brand:')) expect(BRANDS.has(r!.slice(6)), r!).toBe(true);
      else expect(LUCIDE.has(r!), r!).toBe(true);
    }
  });

  it('returns null for non-FA input or an FA name with no equivalent', () => {
    expect(mapFaIcon('btn btn-primary')).toBeNull();
    expect(mapFaIcon('')).toBeNull();
    expect(mapFaIcon(null)).toBeNull();
    expect(mapFaIcon('fa fa-totally-not-an-icon-xyz')).toBeNull();
  });
});
