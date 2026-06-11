import { describe, expect, it } from 'vitest';
import { baseStyles } from '../src/base-css.js';

describe('baseStyles — platform base stylesheet', () => {
  const css = baseStyles();

  describe('modern-normalize baseline', () => {
    it('embeds modern-normalize wrapped in the weakest cascade layer', () => {
      expect(css).toContain('@layer sw-normalize {');
      // a couple of signature normalize rules that PRESERVE (not reset) defaults
      expect(css).toContain('font-weight: bolder;'); // b, strong
      expect(css).toContain('vertical-align: baseline;'); // sub/sup, progress
      expect(css).toContain('-webkit-appearance: button;'); // clickable types
    });

    it('ships the MIT attribution banner in the emitted CSS', () => {
      expect(css).toContain('modern-normalize v3.0.1 | MIT License');
    });

    it('does NOT strip semantic defaults the way Tailwind preflight would', () => {
      // No global heading/list/margin reset — authored semantic HTML keeps its look.
      expect(css).not.toMatch(/h1\s*,\s*h2[^}]*font-size:\s*inherit/);
      expect(css).not.toMatch(/\b(ul|ol)\b[^}]*list-style:\s*none/);
    });
  });

  describe('Sitewright platform defaults', () => {
    it('keeps a border-box foundation unlayered (always wins)', () => {
      // the platform copy lives OUTSIDE the @layer block (after the normalize layer)
      expect(css).toContain('/* Foundational box model');
      const platform = css.slice(css.indexOf('/* Foundational box model'));
      expect(platform).toMatch(/\*,\s*\*::before,\s*\*::after\s*{\s*box-sizing: border-box;/);
    });

    it('links inherit colour (never UA blue); nav / menu / button links also drop the underline', () => {
      // global colour inherit — the universal default; utilities (text-*) still win
      expect(css).toContain('a { color: inherit; }');
      expect(css).toContain(':is(nav, [role="navigation"]) a, .menu a, .btn { text-decoration: inherit; }');
    });

    it('leaves body-copy links alone (no global text-decoration:none)', () => {
      // we must NOT kill underlines globally — only in nav/buttons
      expect(css).not.toMatch(/(^|\s)a\s*{[^}]*text-decoration:\s*none/);
    });

    it('makes media responsive without forcing display on icons', () => {
      expect(css).toContain('img, video { max-width: 100%; height: auto; }');
      expect(css).not.toMatch(/svg[^}]*display:\s*block/);
    });
  });

  describe('custom scrollbars', () => {
    it('gates webkit pseudos vs the standard props by browser (they are mutually exclusive)', () => {
      // WebKit/Blink path uses the pseudos; Firefox path uses the standard props.
      expect(css).toContain('@supports selector(::-webkit-scrollbar) {');
      expect(css).toContain('@supports not selector(::-webkit-scrollbar) {');
      // the standard scrollbar-* props MUST be confined to the Firefox branch, else
      // they disable the ::-webkit pseudos in Chrome 121+ (the original bug)
      const webkitBranch = css.slice(
        css.indexOf('@supports selector(::-webkit-scrollbar)'),
        css.indexOf('@supports not selector(::-webkit-scrollbar)'),
      );
      const fxBranch = css.slice(css.indexOf('@supports not selector(::-webkit-scrollbar)'));
      expect(fxBranch).toContain('scrollbar-width: thin;');
      expect(fxBranch).toContain('scrollbar-color: var(--sw-color-primary, #4f46e5) var(--sw-color-base-100, #ffffff);');
      // regression guard: the STANDARD props must NOT be in the webkit branch (only
      // the `auto` reset is) — else they re-disable the pseudos in Chrome.
      expect(webkitBranch).not.toContain('scrollbar-width: thin');
      expect(webkitBranch).not.toMatch(/scrollbar-color: var\(--sw-color-primary/);
    });

    it('resets the root back to auto in WebKit so daisyUI’s :root{scrollbar-color} cannot keep the page bar grey', () => {
      expect(css).toContain('html:root { scrollbar-color: auto; scrollbar-width: auto; }');
    });

    it('uses a SOLID track (page background, no transparency) and no arrows', () => {
      expect(css).toContain('*::-webkit-scrollbar { width: 12px; height: 12px; background: var(--sw-color-base-100, #ffffff); }');
      expect(css).toContain('*::-webkit-scrollbar-track,\n  *::-webkit-scrollbar-track-piece,\n  *::-webkit-scrollbar-corner { background: var(--sw-color-base-100, #ffffff); }');
      expect(css).toContain('*::-webkit-scrollbar-button { width: 0; height: 0; display: none; }');
      // NO transparency anywhere in the scrollbar CSS
      const sb = css.slice(css.indexOf('@supports selector(::-webkit-scrollbar)'));
      expect(sb).not.toContain('transparent');
      expect(sb).not.toMatch(/color-mix\([^)]*transparent/);
    });

    it('thumb is a SOLID brand primary, darker while grabbed, full-width (no inset)', () => {
      expect(css).toContain('*::-webkit-scrollbar-thumb { background-color: var(--sw-color-primary, #4f46e5); border-radius: 9999px; }');
      // darker (solid, mixed with black — not an alpha) while grabbed, with a
      // plain-primary fallback first for browsers without color-mix
      expect(css).toContain('*::-webkit-scrollbar-thumb:active { background-color: var(--sw-color-primary, #4f46e5); background-color: color-mix(in srgb, var(--sw-color-primary, #4f46e5) 82%, #000); }');
      const webkitBranch = css.slice(
        css.indexOf('@supports selector(::-webkit-scrollbar)'),
        css.indexOf('@supports not selector(::-webkit-scrollbar)'),
      );
      expect(webkitBranch).not.toContain('background-clip: padding-box');
      expect(webkitBranch).not.toMatch(/:hover::-webkit-scrollbar-thumb/);
    });
  });
});
