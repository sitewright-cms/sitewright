import { describe, it, expect } from 'vitest';
import { NAV_EFFECTS_JS, usesNavEffects } from '../src/nav-effects.js';
import { JS_NAV_EFFECTS } from '@sitewright/schema';

describe('nav-effects runtime', () => {
  it('builds the indicator with createElement + className (never innerHTML)', () => {
    expect(NAV_EFFECTS_JS).toContain("createElement('span')");
    expect(NAV_EFFECTS_JS).toContain("'sw-nav-indicator'");
    expect(NAV_EFFECTS_JS).not.toContain('innerHTML');
  });

  it('mirrors the effect CSS scope selector (landmarks + per-element nav containers)', () => {
    expect(NAV_EFFECTS_JS).toContain('#top-nav,#mobile-nav');
    expect(NAV_EFFECTS_JS).toContain('.menu,nav,[role="navigation"]');
  });

  it('wires all three JS-backed schemes (sliding line, sliding pill, spotlight)', () => {
    expect(NAV_EFFECTS_JS).toContain('sw-nav-line-sliding-bottom');
    expect(NAV_EFFECTS_JS).toContain('sw-nav-sliding-pill');
    expect(NAV_EFFECTS_JS).toContain('sw-nav-spotlight-sliding');
    // publishes the rect vars (sliding) + pointer vars (spotlight) the CSS composes:
    expect(NAV_EFFECTS_JS).toContain('--sw-ind-left');
    expect(NAV_EFFECTS_JS).toContain('--sw-mx');
  });

  it('is a self-contained IIFE that cannot break out of a <script>', () => {
    expect(NAV_EFFECTS_JS.startsWith('(function()')).toBe(true);
    expect(NAV_EFFECTS_JS.toLowerCase()).not.toContain('</script');
  });
});

describe('usesNavEffects marker', () => {
  it('detects each JS-backed scheme class and ignores pure-CSS / empty input', () => {
    for (const e of JS_NAV_EFFECTS) expect(usesNavEffects(`<body class="sw-nav-${e}">`)).toBe(true);
    expect(usesNavEffects('<body class="sw-nav-box-solid">')).toBe(false);
    expect(usesNavEffects('')).toBe(false);
    expect(usesNavEffects(null)).toBe(false);
    expect(usesNavEffects(undefined)).toBe(false);
  });
});
