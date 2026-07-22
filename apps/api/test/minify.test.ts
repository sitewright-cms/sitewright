import { describe, expect, it } from 'vitest';
import { minifyJs, minifyCss, MINIFIER_VERSION } from '../src/publish/minify.js';

describe('minifyJs (terser)', () => {
  it('strips whitespace/comments and shrinks the source', async () => {
    const src = `
      // a line comment
      function greet(name) {
        const message = 'hello ' + name;
        return message;
      }
    `;
    const out = await minifyJs(src);
    expect(out.length).toBeLessThan(src.length);
    expect(out).not.toContain('// a line comment');
    expect(out).toContain('function greet');
  });

  it('PRESERVES /*! … */ license banners (MIT attribution must survive minification)', async () => {
    const out = await minifyJs('/*! Sitewright runtime. embla-carousel@8.6.0 (MIT) */\n(function(){var x=1;})();');
    expect(out).toContain('/*! Sitewright runtime. embla-carousel@8.6.0 (MIT) */');
  });

  it('is a no-op for empty input and never throws on invalid JS', async () => {
    expect(await minifyJs('')).toBe('');
    expect(await minifyJs('function ( { this is not js')).toBe('function ( { this is not js');
  });
});

describe('minifyCss (clean-css)', () => {
  it('collapses whitespace and shrinks the source', () => {
    const src = `
      :root {
        --sw-color-primary: #0a7;
      }
    `;
    const out = minifyCss(src);
    expect(out).toContain('--sw-color-primary:#0a7');
    expect(out.length).toBeLessThan(src.length);
  });

  it('PRESERVES /*! … */ license banners (e.g. modern-normalize MIT attribution)', () => {
    const out = minifyCss('/*! modern-normalize v3.0.1 | MIT License */\n*{box-sizing:border-box}');
    expect(out).toContain('/*! modern-normalize v3.0.1 | MIT License */');
  });

  it('PRESERVES @starting-style + allow-discrete transitions (the cart/modal slide-in)', () => {
    // Regression: clean-css's structural optimizations (level 1 `all`) silently DROP `@starting-style`
    // and the `transition: … allow-discrete` rule, so the cart drawer "pops" instead of sliding.
    const css =
      '[data-sw-cart] dialog{transform:translateX(100%);transition:transform .3s ease,display .3s allow-discrete,overlay .3s allow-discrete}' +
      '[data-sw-cart] dialog[open]{transform:translateX(0);display:flex}' +
      '@starting-style{[data-sw-cart] dialog[open]{transform:translateX(100%)}}';
    const out = minifyCss(css);
    expect(out, 'the @starting-style entry state must survive').toContain('@starting-style');
    expect(out, 'the allow-discrete transition must survive').toContain('allow-discrete');
    expect(out, 'the base closed-state transform must survive').toContain('translateX(100%)');
    // still minified (whitespace/comment stripping is the bulk of the win)
    expect(minifyCss(`/* drop */\n${css}`)).not.toContain('/* drop */');
  });

  it('is a no-op for empty input and never throws on odd input', () => {
    expect(minifyCss('')).toBe('');
    expect(typeof minifyCss('this is {{{ not css')).toBe('string');
  });
});

describe('MINIFIER_VERSION', () => {
  it('identifies both minifiers so a version bump re-busts the asset cache', () => {
    expect(MINIFIER_VERSION).toMatch(/^terser-.+\+cleancss-.+$/);
  });
});
