import { describe, expect, it } from 'vitest';
import { minifyJs, minifyCss } from '../src/minify.js';

describe('minifyJs', () => {
  it('strips whitespace/comments and shrinks the source', () => {
    const src = `
      // a comment
      function greet(name) {
        const message = 'hello ' + name;
        return message;
      }
    `;
    const out = minifyJs(src);
    expect(out.length).toBeLessThan(src.length);
    expect(out).not.toContain('// a comment');
    expect(out).toContain('function greet');
  });

  it('is a no-op for empty input', () => {
    expect(minifyJs('')).toBe('');
  });

  it('falls back to the original source on a parse error (never throws)', () => {
    const broken = 'function ( { this is not js';
    expect(minifyJs(broken)).toBe(broken);
  });
});

describe('minifyCss', () => {
  it('collapses whitespace and drops redundant attribute-selector quotes', () => {
    const src = `
      :root[data-sw-theme="dark"] {
        --x: 1;
      }
    `;
    const out = minifyCss(src);
    expect(out).toContain(':root[data-sw-theme=dark]{');
    expect(out.length).toBeLessThan(src.length);
  });

  it('preserves @layer and !important', () => {
    const out = minifyCss('@layer sw-normalize {\n  *{box-sizing:border-box}\n}\n[x]{display:none !important}');
    expect(out).toContain('@layer sw-normalize{');
    expect(out).toContain('!important');
  });

  it('is a no-op for empty input', () => {
    expect(minifyCss('')).toBe('');
  });

  it('never throws on odd input (returns a string; the try/catch guards a genuine esbuild error)', () => {
    // esbuild's CSS parser is lenient and rarely throws — the guarantee we depend on is that a build is
    // never broken by minification, i.e. this always returns a string rather than throwing.
    expect(typeof minifyCss('this is {{{ not css')).toBe('string');
    expect(typeof minifyCss('@media')).toBe('string');
  });
});
