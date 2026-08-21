import { describe, it, expect } from 'vitest';
import {
  AssetRefSchema,
  CssColorSchema,
  CssStringSchema,
  CssTokenValueSchema,
  IdSchema,
  NavTargetSchema,
  RoutePathSchema,
  SlugSchema,
  TokenValueSchema,
  containsCssComment,
  isSafeCssTokenValue,
  safeRecord,
} from '../src/primitives.js';
import { z } from 'zod';

describe('NavTargetSchema', () => {
  it('accepts empty, fragment, root-relative, http(s), and mailto/tel/sms', () => {
    for (const ok of ['', '#sec', '/about', '/about#team', 'http://x.test', 'https://x.test/p?q=1', 'mailto:a@b.test', 'tel:+15551234', 'sms:+15551234']) {
      expect(NavTargetSchema.parse(ok)).toBe(ok);
    }
  });
  it('rejects active/unknown schemes, protocol-relative, and embedded control whitespace', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.test', ' javascript:x', '/a\tjavascript:x']) {
      expect(() => NavTargetSchema.parse(bad)).toThrow();
    }
  });
});

describe('SlugSchema', () => {
  it('accepts a lowercase hyphenated slug', () => {
    expect(SlugSchema.parse('my-products')).toBe('my-products');
  });
  it.each(['../etc', 'My Slug', 'UPPER', 'a/b', 'trailing-'])('rejects %s', (s) => {
    expect(() => SlugSchema.parse(s)).toThrow();
  });
});

describe('IdSchema', () => {
  it('accepts an id with hyphens/underscores', () => {
    expect(IdSchema.parse('site_header-1')).toBe('site_header-1');
  });
  it('rejects path-traversal and slashes', () => {
    expect(() => IdSchema.parse('../x')).toThrow();
    expect(() => IdSchema.parse('a/b')).toThrow();
  });
});

describe('RoutePathSchema', () => {
  it.each(['/', '/about', '/products/widgets', '/a/b/c/'])('accepts %s', (p) => {
    expect(RoutePathSchema.parse(p)).toBe(p);
  });
  it.each(['//evil.com', 'javascript:alert(1)', 'https://x', 'no-leading-slash', '/a//b'])(
    'rejects %s',
    (p) => {
      expect(() => RoutePathSchema.parse(p)).toThrow();
    },
  );
});

describe('AssetRefSchema', () => {
  it.each(['https://cdn.example.com/a.png', '/media/logo.svg'])('accepts %s', (v) => {
    expect(AssetRefSchema.parse(v)).toBe(v);
  });
  it.each(['javascript:alert(1)', 'data:text/html,<script>', 'ftp://x', 'relative.png', '//evil.com'])(
    'rejects %s',
    (v) => {
      expect(() => AssetRefSchema.parse(v)).toThrow();
    },
  );
});

describe('CssColorSchema', () => {
  it.each(['#0a7', '#112233', 'rgb(0, 0, 0)', 'hsla(120, 50%, 50%, 0.5)', 'rebeccapurple'])(
    'accepts %s',
    (c) => {
      expect(CssColorSchema.parse(c)).toBe(c);
    },
  );
  it.each(['red; } body { display:none', '#zzz', 'url(x)', ''])('rejects %s', (c) => {
    expect(() => CssColorSchema.parse(c)).toThrow();
  });
});

describe('TokenValueSchema', () => {
  it('accepts numbers and safe strings', () => {
    expect(TokenValueSchema.parse(1.25)).toBe(1.25);
    expect(TokenValueSchema.parse('1rem')).toBe('1rem');
  });
  it('rejects CSS-breaking strings', () => {
    expect(() => TokenValueSchema.parse('1rem; } x {')).toThrow();
  });
});

describe('safeRecord', () => {
  const rec = safeRecord(z.unknown());

  it('parses a normal record', () => {
    expect(rec.parse({ a: 1, b: 'x' })).toEqual({ a: 1, b: 'x' });
  });

  it('rejects prototype-pollution keys (from JSON input)', () => {
    const polluted = JSON.parse('{"__proto__": {"polluted": true}}');
    expect(() => rec.parse(polluted)).toThrow();
  });

  it('rejects records exceeding the cardinality cap', () => {
    const tooMany: Record<string, number> = {};
    for (let i = 0; i < 300; i++) tooMany[`k${i}`] = i;
    expect(() => rec.parse(tooMany)).toThrow();
  });
});


// `identity.cssTokens` values. DELIBERATELY wider than TokenValueSchema — parentheses and commas are
// allowed so a gradient/shadow/var() chain can be a token at all — which makes every case below a
// SECURITY assertion, not a formatting one. `isSafeCssTokenValue` is the shared predicate behind the
// schema, the renderer's emitter and the importer's :root transcription; testing it here covers all three.
describe('CssTokenValueSchema / isSafeCssTokenValue', () => {
  const ACCEPTED = [
    'linear-gradient(135deg,#06f 0%,#0cf 100%)',
    '0 2px 5px rgba(0,0,0,.2), 0 1px 1px rgba(0,0,0,.1)',
    'cubic-bezier(.16,1,.3,1)',
    'color-mix(in oklab, var(--sw-color-primary) 25%, transparent)',
    'calc(100% - var(--sw-space-lg))',
    "'Inter', ui-sans-serif, system-ui",
    '#0a7',
    'clamp(1rem, 2vw + .5rem, 2rem)',
  ];
  it.each(ACCEPTED)('accepts the rich value %s', (v) => {
    expect(CssTokenValueSchema.parse(v)).toBe(v);
    expect(isSafeCssTokenValue(v)).toBe(true);
  });

  const REJECTED: Array<[string, string]> = [
    ['semicolon ends the declaration', 'red; color: blue'],
    ['closing brace escapes the rule', 'red} body{display:none'],
    ['opening brace starts a rule', 'red{'],
    ['angle brackets could close a <style>', '</style><script>alert(1)</script>'],
    ['backslash can rebuild a blocked char as a hex escape', 'red\\3b color:blue'],
    ['an open comment swallows the rest of the block', 'red /*'],
    ['a close comment re-opens the stylesheet', '*/ body{display:none} /*'],
    ['url() fetches', 'url(https://evil.test/x.png)'],
    ['url() with padding still fetches', '  url( "https://evil.test/x.png" )'],
    ['image-set() fetches', 'image-set("https://evil.test/a.png" 1x)'],
    ['-webkit-image-set() fetches', '-webkit-image-set(url(https://evil.test/a.png) 1x)'],
    ['src() fetches', 'src("https://evil.test/f.woff2")'],
    ['image() fetches', 'image("https://evil.test/a.png")'],
    ['element() references another element', 'element(#secret)'],
    ['expression() evaluates script in legacy IE', 'expression(alert(1))'],
    ['@import pulls a stylesheet', '@import "https://evil.test/x.css"'],
    ['an unclosed function consumes the stylesheet', 'linear-gradient(#fff,#000'],
    ['a stray close paren unbalances the block', 'red)'],
    ['nested parens must still balance', 'calc((1px + 2px)'],
    ['a newline can straddle a comment', 'red\n  color: blue'],
    ['NUL', 'red\u0000'],
    // Vendor-prefixed aliases of the blocked functions — a bare-name check walks straight past these.
    ['-webkit-image-set() is still image-set()', '-webkit-image-set(url(https://evil.test/a.png) 1x)'],
    ['-moz-element() is still element()', '-moz-element(#secret)'],
    ['case does not matter', 'URL(https://evil.test/x.png)'],
    ['whitespace before the paren does not help', 'url\t(https://evil.test/x.png)'],
    ['nested inside an allowed function', 'linear-gradient(#fff, url(https://evil.test/x.png))'],
    ['hidden in a var() fallback', 'var(--x, url(https://evil.test/x.png))'],
    // Invisible format characters exist only to make a blocked construct read as something else.
    ['zero-width space inside a function name', 'u\u200brl(https://evil.test/x.png)'],
    ['byte-order mark', 'red\ufeff'],
    ['bidi override', 'red\u202e'],
  ];
  it.each(REJECTED)('rejects a value where %s', (_why, v) => {
    expect(() => CssTokenValueSchema.parse(v)).toThrow();
    expect(isSafeCssTokenValue(v)).toBe(false);
  });

  it('allows a function NAME that merely CONTAINS a blocked one (no false positives)', () => {
    // `blurl(` ends in "url(" but is not `url(`; the guard anchors on a token boundary.
    for (const ok of ['blurl(2px)', 'my-url-thing(1)', 'oklch(0.7 0.1 200)']) {
      expect(isSafeCssTokenValue(ok)).toBe(true);
    }
  });

  it('bounds the length', () => {
    expect(() => CssTokenValueSchema.parse('a'.repeat(301))).toThrow();
    expect(CssTokenValueSchema.parse('a'.repeat(300))).toHaveLength(300);
  });
});

// The schema boundary itself. Denying whitespace controls was mistaken for denying comments — `/*`
// needs no whitespace — so a font stack or design token could carry one all the way to the emitters.
describe('CSS comment sequences are rejected at the boundary', () => {
  it('CssStringSchema rejects a value opening or closing a comment', () => {
    expect(CssStringSchema.safeParse('Arial/*').success).toBe(false);
    expect(CssStringSchema.safeParse('*/ Arial').success).toBe(false);
  });

  it('TokenValueSchema rejects the same', () => {
    expect(TokenValueSchema.safeParse('1rem/*').success).toBe(false);
    expect(TokenValueSchema.safeParse('*/1rem').success).toBe(false);
  });

  it('still accepts ordinary values', () => {
    expect(CssStringSchema.safeParse('Georgia, serif').success).toBe(true);
    expect(TokenValueSchema.safeParse('1.5rem').success).toBe(true);
    expect(TokenValueSchema.safeParse(16).success).toBe(true);
  });

  it('containsCssComment is the shared predicate both emitters reuse', () => {
    expect(containsCssComment('a/*b')).toBe(true);
    expect(containsCssComment('a*/b')).toBe(true);
    expect(containsCssComment('a/b*c')).toBe(false);
  });
});
