import { describe, it, expect } from 'vitest';
import { brandToTailwindTheme, compileUtilityCss } from '../src/index.js';
import type { Brand } from '@sitewright/schema';

describe('brandToTailwindTheme', () => {
  it('maps colors and font families', () => {
    const theme = brandToTailwindTheme({
      colors: { primary: '#000000' },
      typography: { fontFamilies: { body: 'serif' } },
    } as unknown as Brand);
    expect(theme.colors).toEqual({ primary: '#000000' });
    expect(theme.fonts).toEqual({ body: 'serif' });
  });

  it('defaults fonts to an empty map when the brand has no typography', () => {
    const theme = brandToTailwindTheme({ colors: { primary: '#000000' } } as unknown as Brand);
    expect(theme.fonts).toEqual({});
  });

  it('re-exports the compiler from the package barrel', () => {
    expect(typeof compileUtilityCss).toBe('function');
  });
});
