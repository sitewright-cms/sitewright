import { describe, expect, it } from 'vitest';
import type { Brand } from '@sitewright/schema';
import { brandToCss } from '../src/brand-css.js';

function brand(overrides: Partial<Brand> = {}): Brand {
  return { name: 'Acme', colors: {}, ...overrides } as Brand;
}

describe('brandToCss', () => {
  it('emits color custom properties under :root', () => {
    const css = brandToCss(brand({ colors: { primary: '#0a7', 'base-content': '#111' } }));
    expect(css).toContain(':root {');
    expect(css).toContain('--sw-color-primary: #0a7;');
    expect(css).toContain('--sw-color-base-content: #111;');
  });

  it('emits font, spacing and radius tokens', () => {
    const css = brandToCss(
      brand({
        typography: { fontFamilies: { heading: 'Inter' } },
        spacing: { lg: '2rem' },
        radii: { card: '0.5rem' },
      }),
    );
    expect(css).toContain('--sw-font-heading: Inter;');
    expect(css).toContain('--sw-space-lg: 2rem;');
    expect(css).toContain('--sw-radius-card: 0.5rem;');
  });

  it('drops values that could break out of the declaration', () => {
    const css = brandToCss(brand({ colors: { evil: 'red; } body { display:none' } }));
    expect(css).not.toContain('display:none');
    expect(css).not.toContain('--sw-color-evil');
  });
});
