import { describe, it, expect } from 'vitest';
import type { BrandTokens } from '@sitewright/schema';
import { brandToCss } from '../src/lib/brand-css.js';

const brand: BrandTokens = {
  colors: { primary: '#0ea5e9', ink: '#0f172a' },
  typography: { fontFamilies: { body: 'Inter, sans-serif' } },
  radii: { card: '0.75rem' },
};

describe('brandToCss', () => {
  it('emits a :root block with prefixed custom properties', () => {
    const css = brandToCss(brand);
    expect(css).toMatch(/^:root \{/);
    expect(css).toContain('--sw-color-primary: #0ea5e9;');
    expect(css).toContain('--sw-color-ink: #0f172a;');
    expect(css).toContain('--sw-font-body: Inter, sans-serif;');
    expect(css).toContain('--sw-radius-card: 0.75rem;');
  });

  it('handles a minimal token set (no tokens at all)', () => {
    const css = brandToCss({ colors: {} });
    expect(css).toContain(':root');
  });

  it('skips token values that contain CSS-breaking characters (defense-in-depth)', () => {
    const css = brandToCss({ colors: { ok: '#fff', danger: 'red; } body {}' } });
    expect(css).toContain('--sw-color-ok: #fff;');
    expect(css).not.toContain('danger');
  });
});
