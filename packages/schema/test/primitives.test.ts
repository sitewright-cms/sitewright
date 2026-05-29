import { describe, it, expect } from 'vitest';
import {
  AssetRefSchema,
  CssColorSchema,
  IdSchema,
  MAX_PAGE_TREE_DEPTH,
  RoutePathSchema,
  SlugSchema,
  TokenValueSchema,
  assertWithinTreeDepth,
  safeRecord,
} from '../src/primitives.js';
import { z } from 'zod';

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
  it.each(['/', '/about', '/products/[slug]', '/a/b/c/'])('accepts %s', (p) => {
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
  it.each(['javascript:alert(1)', 'data:text/html,<script>', 'ftp://x', 'relative.png'])(
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

describe('assertWithinTreeDepth', () => {
  const nest = (depth: number): unknown => {
    let node: unknown = { id: 'leaf', type: 'Leaf' };
    for (let i = 0; i < depth - 1; i++) node = { id: `n${i}`, type: 'Box', children: [node] };
    return node;
  };

  it('passes for a shallow tree', () => {
    expect(() => assertWithinTreeDepth(nest(5))).not.toThrow();
  });

  it('passes at exactly the maximum depth', () => {
    expect(() => assertWithinTreeDepth(nest(MAX_PAGE_TREE_DEPTH))).not.toThrow();
  });

  it('throws beyond the maximum depth', () => {
    expect(() => assertWithinTreeDepth(nest(MAX_PAGE_TREE_DEPTH + 1))).toThrow(RangeError);
  });

  it('respects a custom max', () => {
    expect(() => assertWithinTreeDepth(nest(4), 3)).toThrow(RangeError);
  });
});
