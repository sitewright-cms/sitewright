import { describe, it, expect } from 'vitest';
import { brandToTailwindTheme, compileUtilityCss } from '../src/index.js';
import type { Brand } from '@sitewright/schema';

describe('brandToTailwindTheme', () => {
  it('maps colors + the built-in slot utilities, and legacy fontFamilies (which win on clash)', () => {
    const theme = brandToTailwindTheme({
      colors: { primary: '#000000' },
      typography: { fontFamilies: { display: "'Bebas Neue', sans-serif" } },
    } as unknown as Brand);
    expect(theme.colors).toEqual({ primary: '#000000' });
    // heading/body always map to the live --sw-font-* vars; legacy raw token stays a font-display utility
    expect(theme.fonts).toEqual({
      heading: 'var(--sw-font-heading)',
      body: 'var(--sw-font-body)',
      display: "'Bebas Neue', sans-serif",
    });
  });

  it('exposes font-<name> for each custom named slot', () => {
    const theme = brandToTailwindTheme({
      colors: {},
      typography: { named: { boombox: { source: 'local', family: 'Boombox', weight: 800, fontId: 'up-x' } } },
    } as unknown as Brand);
    expect(theme.fonts).toMatchObject({ boombox: 'var(--sw-font-boombox)' });
  });

  it('always exposes the built-in heading/body utilities even with no typography', () => {
    const theme = brandToTailwindTheme({ colors: { primary: '#000000' } } as unknown as Brand);
    expect(theme.fonts).toEqual({ heading: 'var(--sw-font-heading)', body: 'var(--sw-font-body)' });
  });

  it('re-exports the compiler from the package barrel', () => {
    expect(typeof compileUtilityCss).toBe('function');
  });
});
