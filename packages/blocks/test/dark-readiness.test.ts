import { describe, it, expect } from 'vitest';
import { componentAssets } from '../src/components.js';
import { CART_CSS } from '../src/cart.js';
import { RIPPLE_CSS } from '../src/ripple.js';
import { ANIMATION_CSS } from '../src/animations.js';
import { LAZYLOAD_CSS } from '../src/lazyload.js';
import { PRELOADER_CSS } from '../src/preloader.js';
import { baseStyles } from '../src/base-css.js';
import { previewStyles } from '../src/preview-css.js';
import { hexToOklch } from '../src/color-oklch.js';

// Dark-readiness lint (PR 3). Opt-in light/dark schemes flip the `--sw-color-*` tokens, so first-party
// chrome must read those tokens rather than hard-coding a light surface — otherwise the surface stays
// light in dark mode (the cookie banner / cart drawer bug this PR fixes). This guard fails when a new
// chrome rule reintroduces a raw light BACKGROUND, and pins the on-brand text tokens.
//
// Scope: BACKGROUNDS only. A light surface that doesn't flip is the jarring failure in dark mode; text
// colour is lower-risk (it inherits, or sits on a non-flipping coloured chip such as the red count
// badge where white is correct in both schemes), so we guard on-brand text positively (it must use the
// derived `--sw-color-primary-content` token) instead of negatively flagging every `color:#fff`.

// Components whose CSS is INTENTIONALLY a fixed-palette / dark surface — exempt from "must flip":
//  - Lightbox: a fullscreen media VIEWER, dark by convention in BOTH schemes (black scrims + light-on-
//    dark controls).
//  - DateTimePicker: vendored Vanilla Calendar Pro, which ships its own light AND dark theme CSS.
const SCHEME_EXEMPT_COMPONENTS = ['Lightbox', 'DateTimePicker'] as const;
const FIRST_PARTY_COMPONENTS = ['CookieConsent', 'Modal', 'Tabs', 'Form', 'Carousel'] as const;

// Selector-level allowlist for raw light backgrounds that are deliberately scheme-independent:
//  - `Unknown`: the [data-sw-block="Unknown"] diagnostic swatch pairs its own light bg + dark text, so
//    it stays legible on its own regardless of the page scheme (an editor warning, not themed chrome).
//  - `waves-light`: the shared ripple's explicit "light ripple for a surface that is dark in BOTH
//    schemes" marker (e.g. a coloured button).
const ALLOWED_BG_SELECTOR_SUBSTRINGS = ['Unknown', 'waves-light'];

// Above this OKLCH lightness a colour reads as a "light" surface.
const LIGHT_L = 0.72;

/** Whether a CSS value is a RAW light colour literal (not a token / derived value, which flips). */
function valueIsLight(value: string): boolean {
  const v = value.trim();
  if (/\b(?:var|color-mix)\(/.test(v)) return false; // token / derived → flips with the scheme
  if (/\bwhite\b/i.test(v)) return true;
  if (/rgba?\(\s*255[\s,]+255[\s,]+255/i.test(v)) return true;
  const hex = /#[0-9a-fA-F]{3,8}\b/.exec(v);
  if (hex) {
    const oklch = hexToOklch(hex[0]);
    if (oklch && oklch.l > LIGHT_L) return true;
  }
  return false;
}

/**
 * Every `background`/`background-color` declaration in `css` whose EFFECTIVE value is a raw light
 * literal. A rule whose background chain includes a token/derived value (var()/color-mix()) is
 * theme-aware and skipped — this also covers the progressive-enhancement fallback pattern
 * (`background:#EEE; background:color-mix(…)`), where the last declaration wins. Allowlisted selectors
 * are skipped. Splitting on `}` over-splits nested @media bodies, which is harmless here (we only look
 * for background declarations inside each `{ … }` segment).
 */
function lightBackgroundViolations(css: string, label: string): string[] {
  const out: string[] = [];
  for (const segment of css.split('}')) {
    const braceAt = segment.indexOf('{');
    const selector = braceAt >= 0 ? segment.slice(0, braceAt) : '';
    const body = braceAt >= 0 ? segment.slice(braceAt + 1) : segment;
    if (ALLOWED_BG_SELECTOR_SUBSTRINGS.some((s) => selector.includes(s))) continue;
    const bgs = [...body.matchAll(/background(?:-color)?:\s*([^;{}]+)/g)].map((m) => m[1] ?? '');
    if (bgs.length === 0) continue;
    // CSS cascade within a rule: the LAST background declaration wins. A token/derived effective value
    // is theme-aware (this also covers the PE fallback chain `background:#EEE; background:color-mix(…)`).
    const effective = bgs[bgs.length - 1] ?? '';
    if (/\b(?:var|color-mix)\(/.test(effective)) continue;
    if (valueIsLight(effective)) out.push(`${label} » ${selector.trim()} { background:${effective.trim()} }`);
  }
  return out;
}

describe('dark-readiness: scheme-aware chrome flips its surfaces (no hard-coded light backgrounds)', () => {
  const sources: Array<[string, string]> = [
    ['base-css', baseStyles()],
    ['preview-css', previewStyles()],
    ['cart', CART_CSS],
    ['ripple', RIPPLE_CSS],
    ['animations', ANIMATION_CSS],
    ['lazyload', LAZYLOAD_CSS],
    ['preloader', PRELOADER_CSS],
    ...FIRST_PARTY_COMPONENTS.map((t) => [t, componentAssets([t]).css] as [string, string]),
  ];

  it('no chrome rule paints a raw light background that would stay light in dark mode', () => {
    const violations = sources.flatMap(([label, css]) => lightBackgroundViolations(css, label));
    expect(
      violations,
      `hard-coded light surfaces (read a --sw-color-* token instead, or add a documented allowlist entry):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('the scanner actually has teeth (catches a reintroduced white surface)', () => {
    expect(lightBackgroundViolations('.x{background:#fff}', 'probe')).toHaveLength(1);
    expect(lightBackgroundViolations('.x{background:var(--sw-color-base-100,#fff)}', 'probe')).toHaveLength(0);
    expect(lightBackgroundViolations('.x{background:#b00020}', 'probe')).toHaveLength(0); // dark red, fine
    // PE fallback chain (raw light first, token last) is theme-aware → not flagged.
    expect(lightBackgroundViolations('.x{background:#EEE;background:color-mix(in srgb,var(--a) 8%,var(--b))}', 'probe')).toHaveLength(0);
    // a reversed chain (token first, raw light last) DOES NOT flip → must be flagged.
    expect(lightBackgroundViolations('.x{background:var(--a,#fff);background:#fff}', 'probe')).toHaveLength(1);
    // the documented selector allowlist (e.g. the .waves-light light-on-dark ripple) is exempt.
    expect(lightBackgroundViolations('.waves-light .waves-ripple{background:rgba(255,255,255,.45)}', 'probe')).toHaveLength(0);
  });

  it('exempt components still resolve to real CSS (guards against a silent type-name typo)', () => {
    for (const t of SCHEME_EXEMPT_COMPONENTS) {
      expect(componentAssets([t]).css.length, t).toBeGreaterThan(0);
    }
  });
});

describe('dark-readiness: labels on the brand fill use the on-primary content token', () => {
  const brandChrome: Array<[string, string]> = [
    ['CookieConsent', componentAssets(['CookieConsent']).css],
    ['Modal', componentAssets(['Modal']).css],
    ['Tabs', componentAssets(['Tabs']).css],
    ['Form', componentAssets(['Form']).css],
    ['cart', CART_CSS],
    ['preview-css', previewStyles()],
  ];

  it('references --sw-color-primary-content so text stays legible on the (dark-tuned) brand fill', () => {
    for (const [label, css] of brandChrome) {
      expect(css, label).toContain('var(--sw-color-primary-content');
    }
  });
});
