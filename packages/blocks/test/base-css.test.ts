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

    it('links inherit text colour; nav + button links drop the underline contextually', () => {
      expect(css).toContain('a { color: inherit; }');
      expect(css).toContain(':is(nav, [role="navigation"]) a, .btn { text-decoration: inherit; }');
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
    it('is thin, brand-coloured and arrow-less (Firefox + WebKit)', () => {
      expect(css).toContain('scrollbar-width: thin;');
      expect(css).toContain('scrollbar-color: color-mix(in srgb, var(--sw-color-primary, #4f46e5) 55%, transparent) transparent;');
      expect(css).toContain('*::-webkit-scrollbar { width: 11px; height: 11px; }');
      expect(css).toContain('*::-webkit-scrollbar-track { background: transparent; }');
      // no stepper arrows
      expect(css).toContain('*::-webkit-scrollbar-button { width: 0; height: 0; display: none; }');
    });

    it('thumb uses the brand primary and thickens on hover / focus / drag', () => {
      expect(css).toContain('var(--sw-color-primary, #4f46e5)');
      expect(css).toMatch(/scrollbar-thumb:active/);
      expect(css).toMatch(/:hover::-webkit-scrollbar-thumb/);
      // scoped to the focused scrollable element itself, NOT :focus-within (which
      // would propagate to ancestors and widen the page scrollbar on any input focus)
      expect(css).toMatch(/:focus::-webkit-scrollbar-thumb/);
      expect(css).not.toMatch(/:focus-within::-webkit-scrollbar-thumb/);
      // constant track width + transparent border = widens thumb without reflow
      expect(css).toContain('border: 3.5px solid transparent;');
      expect(css).toContain('background-clip: padding-box;');
    });
  });
});
