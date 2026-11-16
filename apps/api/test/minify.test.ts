import { describe, expect, it } from 'vitest';
import {
  minifyJs,
  minifyJsStats,
  MINIFY_JS_CACHE_MAX,
  minifyCss,
  minifyCssStats,
  MINIFY_CSS_CACHE_MAX,
  MINIFIER_VERSION,
} from '../src/publish/minify.js';
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

describe('minifyCss caching', () => {
  // The platform's inline CSS (base + brand + theme + effects) is IDENTICAL on every page of a build,
  // and renderDocument minifies it per page. A 1,126-route site therefore ran clean-css 1,126 times on
  // the same input: measured at ~45% of total build time, all of it recomputing the same bytes.
  it('minifies a repeated input only ONCE, and returns the identical result', () => {
    const css = `${CART_CSS}\n.x { color: #ff0000; margin: 0px 0px 0px 0px; }`;
    const before = minifyCssStats().misses;

    const first = minifyCss(css);
    const second = minifyCss(css);
    const third = minifyCss(css);

    expect(second).toBe(first);
    expect(third).toBe(first);
    // Three calls, one real minify — the other two are served from the cache.
    expect(minifyCssStats().misses - before).toBe(1);
  });

  it('still minifies a DIFFERENT input (the cache keys on the css, not on "seen anything")', () => {
    const before = minifyCssStats().misses;
    const a = minifyCss('.a { color: #ff0000; }');
    const b = minifyCss('.b { color: #00ff00; }');

    expect(a).not.toBe(b);
    expect(a).toContain('.a');
    expect(b).toContain('.b');
    expect(minifyCssStats().misses - before).toBe(2);
  });

  it('★ keeps a stylesheet every page shares while a stream of one-off page sheets passes through', () => {
    // Each page brings its own utility sheet; the platform sheet is on every page. Evicting by AGE threw
    // the shared one out as fast as the one-offs arrived, so it was re-minified on every page.
    const shared = `${CART_CSS}\n.shared { color: #00ff00; }`;
    minifyCss(shared);
    const before = minifyCssStats().misses;
    for (let i = 0; i < MINIFY_CSS_CACHE_MAX * 3; i++) {
      minifyCss(`.page-${i} { margin: ${i}px; }`); // a one-off
      minifyCss(shared); // …and the sheet every page carries
    }
    // Only the one-offs missed.
    expect(minifyCssStats().misses - before).toBe(MINIFY_CSS_CACHE_MAX * 3);
  });

  it('bounds the cache so a build with many distinct stylesheets cannot grow it without limit', () => {
    for (let i = 0; i < MINIFY_CSS_CACHE_MAX * 2; i++) minifyCss(`.c${i} { color: #ff0000; }`);
    expect(minifyCssStats().size).toBeLessThanOrEqual(MINIFY_CSS_CACHE_MAX);
  });
});

describe('minifyJs caching', () => {
  // Every build writes the same ~20 first-party runtime bundles, and terser re-minified all of them each
  // time: 28% of a preview rebuild's CPU, on the main thread every other request waits for.
  it('minifies a repeated bundle only ONCE, and returns the identical result', async () => {
    const src = `(function(){ var unusedLongName = 1; function runtimeEntry(a){ return a + unusedLongName; } window.rt = runtimeEntry; })();`;
    const before = minifyJsStats().misses;

    const first = await minifyJs(src);
    const second = await minifyJs(src);

    expect(second).toBe(first);
    expect(first.length).toBeLessThan(src.length);
    expect(minifyJsStats().misses - before).toBe(1);
  });

  it('shares ONE terser run between concurrent callers of the same bundle', async () => {
    // Concurrent preview builds of different sites ask for the same component chunks at the same moment.
    const src = `(function(){ var sharedChunk = ${Date.now()}; window.sc = function(){ return sharedChunk; }; })();`;
    const before = minifyJsStats().misses;

    const [a, b, c] = await Promise.all([minifyJs(src), minifyJs(src), minifyJs(src)]);

    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(minifyJsStats().misses - before).toBe(1);
  });

  it('still minifies a DIFFERENT bundle, and never caches a fallback (it is retried next time)', async () => {
    const before = minifyJsStats().misses;
    const a = await minifyJs('window.a = function(x){ return x + 1; };');
    const b = await minifyJs('window.b = function(y){ return y * 2; };');
    expect(a).not.toBe(b);
    expect(minifyJsStats().misses - before).toBe(2);

    const broken = 'function ( { still not js';
    expect(await minifyJs(broken)).toBe(broken);
    expect(await minifyJs(broken)).toBe(broken);
    expect(minifyJsStats().misses - before).toBe(4);
  });

  it('bounds the cache by entry count and by retained bytes', async () => {
    for (let i = 0; i < MINIFY_JS_CACHE_MAX * 2; i++) await minifyJs(`window.v${i} = ${i};`);
    expect(minifyJsStats().size).toBeLessThanOrEqual(MINIFY_JS_CACHE_MAX);

    // Bundles of ~600 KB each would sit under the entry cap while retaining far more than the budget.
    const big = `window.pad = "${'x'.repeat(600_000)}";`;
    for (let i = 0; i < 12; i++) await minifyJs(`${big}\nwindow.n${i} = ${i};`);
    expect(minifyJsStats().bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(minifyJsStats().size).toBeGreaterThan(0);
  });
});

describe('minifyCss cache memory bound', () => {
  it('caps RETAINED bytes, not just entry count (the key is a whole stylesheet)', () => {
    // 12 stylesheets of ~400 KB each would sit under the entry cap while retaining ~9 MB. The budget
    // must price the minified VALUE too, not just the source key it is stored under.
    const big = '.pad{content:"' + 'x'.repeat(400_000) + '";}';
    for (let i = 0; i < 12; i++) minifyCss(`${big}\n.n${i}{color:#ff0000}`);
    expect(minifyCssStats().bytes).toBeLessThanOrEqual(4 * 1024 * 1024);
    // Independently confirm the accounting matches what is actually held.
    expect(minifyCssStats().size).toBeGreaterThan(0);
  });
});
