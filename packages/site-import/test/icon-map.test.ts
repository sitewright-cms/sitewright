import { describe, expect, it } from 'vitest';
import { ICON_NAMES, BRAND_ICON_NAMES, validateTemplate } from '@sitewright/blocks';
import { mapIconClass, mapMaterialLigature, mapFlagClass } from '../src/transform/icon-map.js';
import { parse } from '../src/dom.js';
import { transformBody, type TransformCtx } from '../src/transform/page.js';
import { DEFAULT_LIMITS } from '../src/limits.js';

const LUCIDE = new Set(ICON_NAMES);
const BRANDS = new Set(BRAND_ICON_NAMES);

describe('mapIconClass — catalog-aware foreign icon → {{sw-icon}}', () => {
  it('matches FA names that equal a Lucide name directly (no alias needed)', () => {
    for (const n of ['phone', 'star', 'heart', 'user', 'users', 'search', 'calendar', 'clock', 'globe', 'lightbulb', 'handshake', 'briefcase', 'repeat']) {
      expect(mapIconClass(`fa fa-${n}`), n).toEqual({ icon: n });
    }
  });

  it('resolves aliases for genuine naming differences', () => {
    expect(mapIconClass('fa fa-suitcase')).toEqual({ icon: 'briefcase' });
    expect(mapIconClass('fa fa-envelope')).toEqual({ icon: 'mail' });
    expect(mapIconClass('fa fa-paper-plane')).toEqual({ icon: 'send' });
    expect(mapIconClass('fa fa-map-marker')).toEqual({ icon: 'map-pin' });
    expect(mapIconClass('fa fa-bars')).toEqual({ icon: 'menu' });
    expect(mapIconClass('fa fa-question-circle')).toEqual({ icon: 'circle-help' });
    expect(mapIconClass('fa fa-pencil-square-o')).toEqual({ icon: 'square-pen' });
    expect(mapIconClass('fa fa-sign-out')).toEqual({ icon: 'log-out' }); // 'sign-out' isn't a Lucide name → alias
    expect(mapIconClass('fa fa-life-ring')).toEqual({ icon: 'life-buoy' });
  });

  it('ignores FA size/style/animation modifiers when finding the icon token', () => {
    expect(mapIconClass('fa fa-4x fa-suitcase mt-auto')).toEqual({ icon: 'briefcase' });
    expect(mapIconClass('fas fa-fw fa-spin fa-handshake')).toEqual({ icon: 'handshake' });
  });

  it('skips FA6 family tokens (fa-brands/fa-solid) and finds the real icon token', () => {
    expect(mapIconClass('fa-brands fa-instagram')).toEqual({ brand: 'instagram' });
    expect(mapIconClass('fa-solid fa-phone')).toEqual({ icon: 'phone' });
  });

  it('strips FA outline (-o) / -alt variants to the base name', () => {
    expect(mapIconClass('fa fa-lightbulb-o')).toEqual({ icon: 'lightbulb' });
    expect(mapIconClass('fa fa-handshake-o')).toEqual({ icon: 'handshake' });
    expect(mapIconClass('fa fa-mobile-alt')).toEqual({ icon: 'smartphone' });
  });

  it('maps FA brand/social icons to brand: slugs (and LinkedIn to the Lucide glyph)', () => {
    expect(mapIconClass('fab fa-facebook-f')).toEqual({ brand: 'facebook' });
    expect(mapIconClass('fab fa-facebook')).toEqual({ brand: 'facebook' });
    expect(mapIconClass('fab fa-instagram')).toEqual({ brand: 'instagram' });
    expect(mapIconClass('fab fa-youtube')).toEqual({ brand: 'youtube' });
    expect(mapIconClass('fab fa-whatsapp')).toEqual({ brand: 'whatsapp' });
    expect(mapIconClass('fab fa-github')).toEqual({ brand: 'github' });
    expect(mapIconClass('fab fa-tiktok')).toEqual({ brand: 'tiktok' });
    expect(mapIconClass('fab fa-twitter')).toEqual({ brand: 'x' }); // simple-icons renamed twitter → x
    expect(mapIconClass('fab fa-x-twitter')).toEqual({ brand: 'x' });
    expect(mapIconClass('fab fa-linkedin')).toEqual({ icon: 'linkedin' }); // LinkedIn lives in Lucide, not the brand set
    expect(mapIconClass('fab fa-linkedin-in')).toEqual({ icon: 'linkedin' });
  });

  it('maps Bootstrap Icons (bi-*)', () => {
    expect(mapIconClass('bi bi-telephone')).toEqual({ icon: 'phone' });
    expect(mapIconClass('bi bi-geo-alt')).toEqual({ icon: 'map-pin' });
    expect(mapIconClass('bi bi-envelope-fill')).toEqual({ icon: 'mail' });
    expect(mapIconClass('bi bi-person')).toEqual({ icon: 'user' });
    expect(mapIconClass('bi bi-cart')).toEqual({ icon: 'shopping-cart' });
    expect(mapIconClass('bi bi-facebook')).toEqual({ brand: 'facebook' });
    expect(mapIconClass('bi bi-house')).toEqual({ icon: 'house' });
  });

  it('maps Ionicons (ion-*, ion-md-*, ion-logo-*)', () => {
    expect(mapIconClass('ion ion-md-call')).toEqual({ icon: 'phone' });
    expect(mapIconClass('ion-ios-mail')).toEqual({ icon: 'mail' });
    expect(mapIconClass('ion-logo-facebook')).toEqual({ brand: 'facebook' });
    expect(mapIconClass('ion-md-logo-instagram')).toEqual({ brand: 'instagram' });
  });

  it('maps Feather (feather-*) and Glyphicons (glyphicon-*)', () => {
    expect(mapIconClass('feather feather-phone')).toEqual({ icon: 'phone' });
    expect(mapIconClass('glyphicon glyphicon-envelope')).toEqual({ icon: 'mail' });
    expect(mapIconClass('lucide lucide-map-pin')).toEqual({ icon: 'map-pin' }); // inline-lucide class convention
  });

  it('maps Material Icons ligature text (the element text is the icon name)', () => {
    expect(mapMaterialLigature('home')).toEqual({ icon: 'home' }); // Lucide keeps both `home` and `house`
    expect(mapMaterialLigature('mail')).toEqual({ icon: 'mail' });
    expect(mapMaterialLigature('shopping_cart')).toEqual({ icon: 'shopping-cart' });
    expect(mapMaterialLigature('call')).toEqual({ icon: 'phone' });
    expect(mapMaterialLigature('favorite')).toEqual({ icon: 'heart' });
    expect(mapMaterialLigature('arrow_forward')).toEqual({ icon: 'arrow-right' });
    expect(mapMaterialLigature('facebook')).toEqual({ brand: 'facebook' });
    expect(mapMaterialLigature('  Home  ')).toEqual({ icon: 'home' }); // trims + lowercases
    expect(mapMaterialLigature('please contact us')).toBeNull(); // multi-word prose is not a ligature
    expect(mapMaterialLigature('')).toBeNull();
  });

  it('maps country flag fonts to a {{sw-flag}} code (flag-icon-css, lipis fi, generic flag)', () => {
    expect(mapFlagClass('flag-icon flag-icon-de')).toEqual({ flag: 'de' });
    expect(mapFlagClass('fi fi-us')).toEqual({ flag: 'us' });
    expect(mapFlagClass('flag flag-gb')).toEqual({ flag: 'gb' });
    expect(mapFlagClass('fi-fr')).toBeNull(); // lipis `fi-<cc>` needs its `fi` base class to disambiguate
    expect(mapFlagClass('flag-icon flag-icon-zz')).toBeNull(); // not a real country code
    expect(mapFlagClass('btn btn-primary')).toBeNull();
    expect(mapFlagClass('')).toBeNull();
  });

  it('every produced name actually EXISTS in the platform icon sets (no dangling refs)', () => {
    const samples = ['fa-suitcase', 'fa-envelope', 'fa-question-circle', 'fa-cog', 'fa-twitter', 'fa-facebook-f', 'fa-linkedin', 'fa-pie-chart', 'fa-sign-out', 'fa-trash', 'bi-telephone', 'bi-cart'];
    for (const s of samples) {
      const r = mapIconClass(`fa ${s}`) ?? mapIconClass(s);
      expect(r, s).toBeTruthy();
      if (r && 'brand' in r) expect(BRANDS.has(r.brand), r.brand).toBe(true);
      else if (r) expect(LUCIDE.has(r.icon), r.icon).toBe(true);
    }
  });

  it('returns null for non-icon input or an icon name with no equivalent', () => {
    expect(mapIconClass('btn btn-primary')).toBeNull();
    expect(mapIconClass('')).toBeNull();
    expect(mapIconClass(null)).toBeNull();
    expect(mapIconClass(undefined)).toBeNull();
    expect(mapIconClass('fa fa-totally-not-an-icon-xyz')).toBeNull();
    expect(mapIconClass('bi bi-not-a-real-icon-xyz')).toBeNull();
  });
});

const ctx: TransformCtx = {
  pageUrl: 'https://ex.com/about',
  siteBase: 'https://ex.com/',
  internalRoutes: new Map(),
  assetMap: new Map(),
  limits: DEFAULT_LIMITS,
};

function run(bodyHtml: string) {
  return transformBody(parse(`<html><body>${bodyHtml}</body></html>`), ctx);
}

describe('sanitizeForSource icon pass (via transformBody)', () => {
  it('rewrites foreign icon fonts to {{sw-icon}} (FA brand, FA solid, Material ligature) with valid source', () => {
    const { source, diagnostics } = run(
      '<p><i class="fab fa-facebook"></i><i class="fas fa-phone"></i><i class="material-icons">mail</i></p>',
    );
    expect(source).toContain('{{sw-icon "brand:facebook"');
    expect(source).toContain('{{sw-icon "phone"');
    expect(source).toContain('{{sw-icon "mail"');
    expect(source).not.toContain('fa-facebook'); // the foreign markup is gone
    expect(source).not.toContain('material-icons');
    expect(diagnostics.filter((d) => d.code === 'icon-mapped')).toHaveLength(3);
    expect(() => validateTemplate(source)).not.toThrow(); // emitted mustaches survive + validate
  });

  it('preserves size classes onto the mapped icon (and defaults to h-5 w-5)', () => {
    const sized = run('<i class="fas fa-star w-8 h-8 text-yellow-500"></i>').source;
    expect(sized).toMatch(/\{\{sw-icon "star" "[^"]*w-8[^"]*h-8[^"]*"\}\}/);
    const fa2x = run('<i class="fa fa-2x fa-star"></i>').source;
    expect(fa2x).toContain('{{sw-icon "star" "h-8 w-8"}}'); // fa-2x → box size
    const bare = run('<i class="fas fa-phone"></i>').source;
    expect(bare).toContain('{{sw-icon "phone" "h-5 w-5"}}'); // default box
  });

  it('leaves a foreign icon with NO platform equivalent unchanged', () => {
    const { source, diagnostics } = run('<i class="fa fa-totally-unknown-xyz"></i>');
    expect(source).toContain('fa-totally-unknown-xyz'); // kept verbatim
    expect(source).not.toContain('sw-icon');
    expect(diagnostics.some((d) => d.code === 'icon-mapped')).toBe(false);
  });

  it('maps a hinted inline <svg> (lucide-<name>) but leaves a nameless svg alone', () => {
    const hinted = run('<svg class="lucide lucide-phone" viewBox="0 0 24 24"><path d="M1 1"/></svg>').source;
    expect(hinted).toContain('{{sw-icon "phone"');
    const nameless = run('<svg viewBox="0 0 24 24"><path d="M2 2"/></svg>').source;
    expect(nameless).toContain('<svg'); // already a clean vector icon → untouched
    expect(nameless).not.toContain('sw-icon');
  });

  it('does not mistake a <span> of real text or an italic word for an icon', () => {
    const { source } = run('<p><span class="badge">New</span> and <i>emphasis</i></p>');
    expect(source).toContain('New');
    expect(source).toContain('emphasis');
    expect(source).not.toContain('sw-icon');
  });

  it('maps a Bootstrap icon on a <span> and keeps surrounding text', () => {
    const { source } = run('<a href="tel:123"><span class="bi bi-telephone"></span> Call us</a>');
    expect(source).toContain('{{sw-icon "phone"');
    expect(source).toContain('Call us');
  });

  it('maps a country flag font to the separate {{sw-flag}} helper', () => {
    const { source, diagnostics } = run('<span class="flag-icon flag-icon-de"></span>');
    expect(source).toContain('{{sw-flag "de" "h-4"}}'); // flag helper, flag-appropriate default height
    expect(source).not.toContain('flag-icon-de');
    expect(diagnostics.some((d) => d.code === 'icon-mapped')).toBe(true);
    expect(() => validateTemplate(source)).not.toThrow();
  });
});
