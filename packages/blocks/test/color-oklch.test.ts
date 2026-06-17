import { describe, it, expect } from 'vitest';
import {
  hexToOklch,
  formatOklch,
  darkBrandShade,
  contrastText,
  DARK_BRAND_L_FLOOR,
  TEXT_ON_LIGHT,
  TEXT_ON_DARK,
} from '../src/color-oklch.js';

/** Pull the L C H numbers back out of an `oklch(L C H[ / A])` string for assertions. */
function parseOklchStr(s: string): { l: number; c: number; h: number } {
  const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)/.exec(s);
  if (!m) throw new Error(`not an oklch string: ${s}`);
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
}

describe('hexToOklch — reference values (Ottosson sRGB→OKLCH)', () => {
  // Reference OKLCH values are the well-published conversions (cross-checked against culori).
  const cases: Array<[string, { l: number; c: number; h: number }]> = [
    ['#ffffff', { l: 1, c: 0, h: 0 }],
    ['#000000', { l: 0, c: 0, h: 0 }],
    ['#ff0000', { l: 0.6279, c: 0.2577, h: 29.23 }],
    ['#00ff00', { l: 0.8664, c: 0.2948, h: 142.5 }],
    ['#0000ff', { l: 0.452, c: 0.3132, h: 264.05 }],
    ['#4f46e5', { l: 0.5107, c: 0.23, h: 277.03 }], // the default brand primary (indigo)
  ];
  for (const [hex, ref] of cases) {
    it(`${hex} → ~oklch(${ref.l} ${ref.c} ${ref.h})`, () => {
      const got = hexToOklch(hex);
      expect(got).not.toBeNull();
      expect(got!.l).toBeCloseTo(ref.l, 2);
      expect(got!.c).toBeCloseTo(ref.c, 2);
      if (ref.c > 0.01) expect(got!.h).toBeCloseTo(ref.h, 0);
    });
  }

  it('accepts 3-digit shorthand identical to its 6-digit form', () => {
    expect(hexToOklch('#fff')).toEqual(hexToOklch('#ffffff'));
    expect(hexToOklch('#abc')).toEqual(hexToOklch('#aabbcc'));
  });

  it('parses alpha from 8-digit hex', () => {
    const got = hexToOklch('#00000080');
    expect(got).not.toBeNull();
    expect(got!.alpha).toBeCloseTo(0.5, 2);
  });

  it('returns null for non-hex (named, functional, malformed)', () => {
    for (const bad of ['red', 'tomato', 'rgb(0,0,0)', 'oklch(0.5 0.1 200)', '#12', '#1234567', 'nope']) {
      expect(hexToOklch(bad), bad).toBeNull();
    }
  });
});

describe('formatOklch', () => {
  it('serialises compactly and round-trips numerically', () => {
    const s = formatOklch({ l: 0.6, c: 0.23, h: 277.03 });
    expect(s).toBe('oklch(0.6 0.23 277.03)');
  });
  it('emits alpha only when < 1', () => {
    expect(formatOklch({ l: 0.5, c: 0.1, h: 200, alpha: 1 })).toBe('oklch(0.5 0.1 200)');
    expect(formatOklch({ l: 0.5, c: 0.1, h: 200, alpha: 0.5 })).toBe('oklch(0.5 0.1 200 / 0.5)');
  });
});

describe('darkBrandShade — lift dark colours to the floor, pick legible text, solid fill', () => {
  it('lifts a dark brand colour to the floor (hue + chroma preserved) and picks dark text', () => {
    const out = darkBrandShade('#4f46e5'); // L≈0.51, below the floor
    expect(out).not.toBeNull();
    const p = parseOklchStr(out!.fill);
    expect(p.l).toBeCloseTo(DARK_BRAND_L_FLOOR, 5);
    expect(p.h).toBeCloseTo(277, 0); // hue preserved
    expect(p.c).toBeGreaterThan(0.2); // chroma preserved
    expect(out!.content).toBe(TEXT_ON_LIGHT); // at the floor (≥ threshold) → dark text, clears WCAG AA
  });

  it('lifts a near-black brand all the way to the floor', () => {
    expect(parseOklchStr(darkBrandShade('#101010')!.fill).l).toBeCloseTo(DARK_BRAND_L_FLOOR, 5);
  });

  it('leaves an already-light brand colour above the floor', () => {
    const out = darkBrandShade('#ffe600')!; // pale yellow, L well above the floor
    const ref = hexToOklch('#ffe600')!;
    expect(parseOklchStr(out.fill).l).toBeCloseTo(ref.l, 4);
    expect(parseOklchStr(out.fill).l).toBeGreaterThan(DARK_BRAND_L_FLOOR);
  });

  it('drops alpha — a brand SURFACE is a solid fill, never see-through', () => {
    const out = darkBrandShade('#4f46e580')!; // 50%-alpha indigo
    expect(out.fill).not.toContain('/'); // no `/ <alpha>` segment in the emitted oklch()
  });

  it('honours a custom floor', () => {
    expect(parseOklchStr(darkBrandShade('#000000', 0.72)!.fill).l).toBeCloseTo(0.72, 5);
  });

  it('returns null for non-hex input (caller keeps the light value)', () => {
    expect(darkBrandShade('red')).toBeNull();
  });
});

describe('contrastText — legible label colour for a fill', () => {
  it('picks white text on a dark/saturated fill', () => {
    expect(contrastText('#4f46e5')).toBe(TEXT_ON_DARK); // L≈0.51
    expect(contrastText('#000000')).toBe(TEXT_ON_DARK);
  });
  it('picks dark text on a light fill', () => {
    expect(contrastText('#ffe600')).toBe(TEXT_ON_LIGHT);
    expect(contrastText('#ffffff')).toBe(TEXT_ON_LIGHT);
  });
  it('returns null for non-hex input', () => {
    expect(contrastText('white')).toBeNull();
  });
});
