import { describe, it, expect } from 'vitest';
import type { Brand } from '@sitewright/schema';
import { brandToCss } from '../src/lib/brand-css.js';

const brand: Brand = {
  name: 'Acme',
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

  it('handles a minimal brand with only a name', () => {
    const css = brandToCss({ name: 'Bare', colors: {} });
    expect(css).toContain(':root');
  });

  it('skips token values that contain CSS-breaking characters (defense-in-depth)', () => {
    const css = brandToCss({ name: 'x', colors: { ok: '#fff', danger: 'red; } body {}' } });
    expect(css).toContain('--sw-color-ok: #fff;');
    expect(css).not.toContain('danger');
  });
});
