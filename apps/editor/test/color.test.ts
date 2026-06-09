import { describe, it, expect } from 'vitest';
import {
  parseColor,
  formatColor,
  formatHex,
  rgbToHsv,
  hsvToRgb,
  type Rgba,
} from '../src/views/settings/color';

const RGBA = (r: number, g: number, b: number, a = 1): Rgba => ({ r, g, b, a });

describe('color kernel — parse', () => {
  it('parses 3/4/6/8-digit hex (with alpha)', () => {
    expect(parseColor('#0af')).toEqual(RGBA(0, 170, 255));
    expect(parseColor('#0ea5e9')).toEqual(RGBA(14, 165, 233));
    expect(parseColor('#0ea5e980')).toEqual({ r: 14, g: 165, b: 233, a: 128 / 255 });
    expect(parseColor('#FFFFFF')).toEqual(RGBA(255, 255, 255));
    // 5 and 7 digits are not valid hex colors.
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor('#1234567')).toBeNull();
  });

  it('parses rgb()/rgba() in comma, space, percent, and slash-alpha forms', () => {
    expect(parseColor('rgb(14, 165, 233)')).toEqual(RGBA(14, 165, 233));
    expect(parseColor('rgb(14 165 233)')).toEqual(RGBA(14, 165, 233));
    expect(parseColor('rgba(14,165,233,0.5)')).toEqual(RGBA(14, 165, 233, 0.5));
    expect(parseColor('rgb(14 165 233 / 50%)')).toEqual(RGBA(14, 165, 233, 0.5));
    expect(parseColor('rgb(100% 0% 0%)')).toEqual(RGBA(255, 0, 0));
  });

  it('parses hsl()/hsla()', () => {
    expect(parseColor('hsl(0 100% 50%)')).toEqual(RGBA(255, 0, 0));
    expect(parseColor('hsl(120 100% 50%)')).toEqual(RGBA(0, 255, 0));
    expect(parseColor('hsl(240, 100%, 50%)')).toEqual(RGBA(0, 0, 255));
    expect(parseColor('hsla(0 0% 100% / 0.25)')).toEqual(RGBA(255, 255, 255, 0.25));
  });

  it('parses oklch() including %/slash-alpha', () => {
    // White ≈ oklch(1 0 0); black ≈ oklch(0 0 0).
    expect(parseColor('oklch(1 0 0)')).toEqual(RGBA(255, 255, 255));
    expect(parseColor('oklch(0 0 0)')).toEqual(RGBA(0, 0, 0));
    const red = parseColor('oklch(0.628 0.2577 29.23)')!;
    expect(red.r).toBeGreaterThan(250); // ≈ pure sRGB red
    expect(red.g).toBeLessThan(10);
    expect(red.b).toBeLessThan(10);
    expect(parseColor('oklch(0.7 0.1 200 / 0.4)')!.a).toBeCloseTo(0.4, 5);
  });

  it('parses keywords + rejects unknown/garbage', () => {
    expect(parseColor('white')).toEqual(RGBA(255, 255, 255));
    expect(parseColor('transparent')).toEqual(RGBA(0, 0, 0, 0));
    expect(parseColor('rebeccapurple')).toBeNull(); // not in the compact map
    expect(parseColor('not a color')).toBeNull();
    expect(parseColor('')).toBeNull();
  });
});

describe('color kernel — format', () => {
  it('formats hex, dropping alpha at a=1 and emitting #rrggbbaa below it', () => {
    expect(formatHex(RGBA(14, 165, 233))).toBe('#0ea5e9');
    expect(formatHex(RGBA(14, 165, 233, 0.5))).toBe('#0ea5e980');
    expect(formatHex(RGBA(255, 255, 255, 0))).toBe('#ffffff00');
  });

  it('formats rgb/hsl/oklch with and without alpha', () => {
    expect(formatColor(RGBA(14, 165, 233), 'rgb')).toBe('rgb(14 165 233)');
    expect(formatColor(RGBA(14, 165, 233, 0.5), 'rgb')).toBe('rgb(14 165 233 / 0.5)');
    expect(formatColor(RGBA(255, 0, 0), 'hsl')).toBe('hsl(0 100% 50%)');
    expect(formatColor(RGBA(255, 255, 255), 'oklch')).toMatch(/^oklch\(1 0 0\)$/);
    expect(formatColor(RGBA(255, 0, 0, 0.3), 'oklch')).toMatch(/ \/ 0\.3\)$/);
  });
});

describe('color kernel — round-trips', () => {
  const samples = ['#0ea5e9', '#4f46e5', '#f59e0b', '#171627', '#ffffff', '#1a1a23', '#000000'];

  it('hex → rgb → hsv → rgb → hex is stable', () => {
    for (const hex of samples) {
      const rgba = parseColor(hex)!;
      const back = hsvToRgb(rgbToHsv(rgba));
      expect(formatHex(back)).toBe(hex);
    }
  });

  it('every format string re-parses to (about) the same color', () => {
    for (const hex of samples) {
      const rgba = parseColor(hex)!;
      for (const fmt of ['rgb', 'hsl', 'oklch'] as const) {
        const round = parseColor(formatColor(rgba, fmt))!;
        // Display strings round to clean values (integer HSL %, 3-dp OKLCH) for readability,
        // so a re-parse can drift up to ~3/255. The STORED value is the exact canonical hex —
        // never the display string — so this rounding is cosmetic only.
        expect(Math.abs(round.r - rgba.r)).toBeLessThanOrEqual(3);
        expect(Math.abs(round.g - rgba.g)).toBeLessThanOrEqual(3);
        expect(Math.abs(round.b - rgba.b)).toBeLessThanOrEqual(3);
      }
    }
  });

  it('alpha survives a hex round-trip within 1/255', () => {
    const c = RGBA(14, 165, 233, 0.5);
    expect(parseColor(formatHex(c))!.a).toBeCloseTo(0.5, 2);
  });
});
