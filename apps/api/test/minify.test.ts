import { describe, expect, it } from 'vitest';
import { minifyJs, minifyCss, MINIFIER_VERSION } from '../src/publish/minify.js';
import { CART_CSS } from '@sitewright/blocks';

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

  it('PRESERVES the CONTENT inside @starting-style + the allow-discrete transition (cart/modal slide-in)', () => {
    // Regression: clean-css 5.x parses the nested inner rule of `@starting-style{ sel{…} }` as a bogus
    // property and empties the block to `@starting-style{}` (at EVERY level) — killing the ENTRY state so
    // the cart drawer "pops" instead of sliding. Assert the INNER rule survives, not just the keyword.
    const css =
      '[data-sw-cart] dialog{transform:translateX(100%);transition:transform .3s ease,display .3s allow-discrete}' +
      '[data-sw-cart] dialog[open]{transform:translateX(0);display:flex}' +
      '@starting-style{[data-sw-cart] dialog[open]{transform:translateX(100%)}}';
    const out = minifyCss(css).replace(/\s/g, '');
    expect(out, 'the @starting-style block must keep its inner selector+decl (not an empty shell)').toMatch(
      /@starting-style\{\[data-sw-cart\]dialog\[open\]\{transform:translateX\(100%\)\}\}/,
    );
    expect(out, 'must NOT be an empty @starting-style shell').not.toContain('@starting-style{}');
    expect(out, 'the allow-discrete transition must survive').toContain('allow-discrete');
    // still minified (whitespace/comment stripping is the bulk of the win)
    expect(minifyCss(`/* drop */\n${css}`)).not.toContain('/* drop */');
  });

  it('preserves the @starting-style body of the REAL shipped cart CSS (end-to-end guard)', () => {
    const out = minifyCss(CART_CSS).replace(/\s/g, '');
    // The cart drawer's entry state lives inside @starting-style — its inner dialog[open] transform must
    // survive minification, or the shipped drawer "pops" instead of sliding.
    expect(out).not.toContain('@starting-style{}'); // never an empty shell
    expect(out).toMatch(/@starting-style\{[^@]*dialog\[open\][^@]*translateX\(100%\)/);
  });

  it('does not mis-split on the literal @starting-style inside a comment (no neighbour corruption)', () => {
    // The splitter must only treat `@starting-style` followed by `{` as an at-rule; a mention in a comment
    // must not hijack a later rule's `{` and corrupt the CSS in between.
    const out = minifyCss('/* uses @starting-style semantics */\n.foo{color:red}');
    expect(out).toContain('.foo{color:red}'); // the real rule survives intact
    expect(out).not.toContain('semantics'); // the comment text isn't leaked as CSS
    // A real @starting-style still AFTER a comment mention is handled correctly.
    const out2 = minifyCss('/* @starting-style note */.a{color:red}@starting-style{.b{x:1}}');
    expect(out2).toContain('.a{color:red}');
    expect(out2).not.toContain('note'); // comment text not leaked
    expect(out2.replace(/\s/g, '')).toContain('@starting-style{.b{x:1}}');
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
