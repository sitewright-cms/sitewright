import { describe, it, expect } from 'vitest';
import { BrandSchema } from '../src/brand.js';

describe('BrandSchema', () => {
  it('parses a minimal brand and defaults colors to {}', () => {
    const b = BrandSchema.parse({ name: 'Acme' });
    expect(b.colors).toEqual({});
  });

  it('parses a full brand with tokens', () => {
    const b = BrandSchema.parse({
      name: 'Acme',
      logo: { light: '/logo.svg', favicon: '/fav.ico' },
      colors: { primary: '#0a7', text: '#111' },
      typography: { fontFamilies: { body: 'Inter' }, scale: { base: '1rem', lg: 1.25 } },
      spacing: { md: '1rem' },
      radii: { md: 8 },
    });
    expect(b.colors.primary).toBe('#0a7');
    expect(b.typography?.fontFamilies.body).toBe('Inter');
  });

  it('rejects a brand without a name', () => {
    expect(() => BrandSchema.parse({ colors: {} })).toThrow();
  });
});
