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
