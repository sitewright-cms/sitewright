import { describe, it, expect } from 'vitest';
import { SeoSchema } from '../src/seo.js';

describe('SeoSchema', () => {
  it('parses full SEO metadata', () => {
    const seo = SeoSchema.parse({
      title: 'Home',
      description: 'Welcome',
      canonical: 'https://example.com/',
      ogImage: '/og.png',
      noindex: true,
    });
    expect(seo.noindex).toBe(true);
    expect(seo.ogImage).toBe('/og.png');
  });

  it('rejects a non-URL canonical', () => {
    expect(() => SeoSchema.parse({ canonical: 'not-a-url' })).toThrow();
  });

  it('rejects a javascript: ogImage (XSS surface)', () => {
    expect(() => SeoSchema.parse({ ogImage: 'javascript:alert(1)' })).toThrow();
  });

  it('allows an empty object', () => {
    expect(SeoSchema.parse({})).toEqual({});
  });
});
