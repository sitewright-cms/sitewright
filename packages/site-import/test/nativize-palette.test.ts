import { describe, expect, it } from 'vitest';
import { buildPalette, colorToRgbKey } from '../src/nativize/palette.js';
import { colorToken } from '../src/nativize/tokens.js';

describe('colorToRgbKey', () => {
  it('parses hex (3- and 6-digit) and rgb()/rgba()', () => {
    expect(colorToRgbKey('#0b4a77')).toBe('11,74,119');
    expect(colorToRgbKey('#FFF')).toBe('255,255,255');
    expect(colorToRgbKey('rgb(11, 74, 119)')).toBe('11,74,119');
    expect(colorToRgbKey('rgba(1, 2, 3, 0.5)')).toBe('1,2,3');
  });
  it('returns null for non-snappable color forms', () => {
    expect(colorToRgbKey('rebeccapurple')).toBeNull();
    expect(colorToRgbKey('oklch(0.7 0.1 200)')).toBeNull();
    expect(colorToRgbKey(undefined)).toBeNull();
    expect(colorToRgbKey('')).toBeNull();
  });
});

describe('buildPalette', () => {
  it('snaps the brand roles, ignores base/neutral surfaces', () => {
    const p = buildPalette({ primary: '#0b4a77', secondary: '#39c1f0', accent: '#0ca3c8', neutral: '#171627', 'base-100': '#ffffff' });
    expect(p.colors).toEqual({ '11,74,119': 'primary', '57,193,240': 'secondary', '12,163,200': 'accent' });
    expect(p.fonts).toEqual([]);
  });
  it('produces a palette the tokenizer actually resolves against', () => {
    const p = buildPalette({ primary: '#0b4a77' });
    expect(colorToken('rgb(11, 74, 119)', p)).toBe('primary');
    expect(colorToken('rgb(255, 255, 255)', p)).toBe('white'); // intrinsic, even when not in the theme
  });
  it('tolerates missing/empty colors', () => {
    expect(buildPalette(undefined).colors).toEqual({});
    expect(buildPalette({ primary: 'oklch(0.5 0 0)' }).colors).toEqual({});
  });
});
