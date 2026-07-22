import { describe, it, expect } from 'vitest';
import { renderIconSvg, isPhosphorName, aliasToPhosphor, phosphorBody, PHOSPHOR_WEIGHTS } from '../src/index.js';

describe('renderIconSvg — Phosphor icon resolution', () => {
  it('renders a Phosphor FILL glyph by default (256 viewBox, fill, name+weight hooks)', () => {
    const out = renderIconSvg('gear');
    expect(out).toContain('viewBox="0 0 256 256"');
    expect(out).toContain('fill="currentColor"');
    expect(out).not.toContain('stroke="currentColor"');
    expect(out).toContain('class="sw-icon sw-icon-gear sw-icon-fill h-5 w-5"'); // default class = h-5 w-5
    expect(out).toContain('<path');
  });

  it('a ":weight" suffix picks the weight (and only a REAL weight suffix is treated as one)', () => {
    for (const w of PHOSPHOR_WEIGHTS) {
      expect(renderIconSvg(`gear:${w}`)).toContain(`sw-icon-gear sw-icon-${w}`);
    }
    // A hyphenated name whose trailing token is NOT a weight is treated as the whole name.
    expect(renderIconSvg('caret-double-left')).toContain('sw-icon-caret-double-left sw-icon-fill');
    // ":bold" on a hyphenated name splits correctly.
    expect(renderIconSvg('caret-double-left:bold')).toContain('sw-icon-caret-double-left sw-icon-bold');
  });

  it('resolves a Lucide name to its Phosphor twin via the alias', () => {
    expect(aliasToPhosphor('settings')).toBe('gear');
    expect(renderIconSvg('settings')).toContain('sw-icon-gear sw-icon-fill');
    expect(renderIconSvg('chevron-left')).toContain('sw-icon-caret-left');
    expect(renderIconSvg('search')).toContain('sw-icon-magnifying-glass');
  });

  it('falls back to a Lucide OUTLINE for a Lucide-only name (never invisible)', () => {
    const out = renderIconSvg('align-horizontal-space-around');
    expect(out).toContain('viewBox="0 0 24 24"');
    expect(out).toContain('stroke="currentColor"');
    expect(out).toContain('sw-icon-lucide');
  });

  it('empty class → base CSS owns the size (no h-5 w-5); a truly unknown name → empty string', () => {
    expect(renderIconSvg('gear', '')).toContain('class="sw-icon sw-icon-gear sw-icon-fill"');
    expect(renderIconSvg('gear', '')).not.toContain('h-5 w-5');
    expect(renderIconSvg('totally-made-up-xyz')).toBe('');
  });

  it('duotone keeps its secondary path (opacity 0.2) for a single-colour duotone', () => {
    const out = renderIconSvg('heart:duotone');
    expect(out).toContain('sw-icon-heart sw-icon-duotone');
    expect(out).toContain('opacity="0.2"'); // the secondary layer survives
  });

  it('brand:<slug> renders a simple-icons filled logo; brand:linkedin falls back to the FILLED Phosphor logo', () => {
    expect(renderIconSvg('brand:github')).toContain('sw-icon-brand-github');
    expect(renderIconSvg('brand:github')).toContain('viewBox="0 0 24 24"');
    const li = renderIconSvg('brand:linkedin');
    expect(li).toContain('sw-icon-linkedin-logo sw-icon-fill'); // filled Phosphor fallback (simple-icons lacks it)
    expect(li).toContain('fill="currentColor"');
    expect(li).not.toContain('stroke="currentColor"');
  });

  it('the class is attribute-escaped (no breakout)', () => {
    expect(renderIconSvg('gear', 'a"onerror=x')).not.toContain('"onerror=x');
  });

  it('phosphorBody + isPhosphorName agree with the data', () => {
    expect(isPhosphorName('gear')).toBe(true);
    expect(isPhosphorName('settings')).toBe(false); // Lucide name, not a Phosphor name
    expect(phosphorBody('gear', 'fill')).toBeTruthy();
    expect(phosphorBody('nope-xyz', 'fill')).toBeUndefined();
  });
});

describe('searchIcons — multi-term icon search', () => {
  it('splits on commas AND whitespace, returns a group per term', async () => {
    const { searchIcons } = await import('../src/index.js');
    const groups = searchIcons('settings,  trash gear');
    expect(groups.map((g) => g.term)).toEqual(['settings', 'trash', 'gear']);
    expect(groups[0]!.matches[0]).toBe('gear'); // "settings" → gear (alias) ranks first
    expect(groups[1]!.matches).toContain('trash');
  });
  it('finds a Phosphor icon from a Lucide keyword synonym', async () => {
    const { searchIcons } = await import('../src/index.js');
    expect(searchIcons('cog')[0]!.matches).toContain('gear'); // lucide "settings" tag "cog" → gear
    expect(searchIcons('magnify')[0]!.matches.some((m) => m.includes('magnifying-glass'))).toBe(true);
  });
  it('empty/blank query → no groups; caps per term', async () => {
    const { searchIcons } = await import('../src/index.js');
    expect(searchIcons('   ')).toEqual([]);
    expect(searchIcons('arrow', 3)[0]!.matches.length).toBeLessThanOrEqual(3);
  });
});
