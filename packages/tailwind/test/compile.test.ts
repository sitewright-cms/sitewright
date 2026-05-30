import { describe, it, expect } from 'vitest';
import { compileUtilityCss } from '../src/compile.js';
import { brandToTailwindTheme } from '../src/theme.js';
import type { Brand } from '@sitewright/schema';

describe('compileUtilityCss', () => {
  it('emits only the utilities actually used in the HTML', async () => {
    const css = await compileUtilityCss(
      ['<div class="flex gap-4"><span class="underline">hi</span></div>'],
      {},
      { minify: false },
    );
    expect(css).toContain('display: flex');
    expect(css).toMatch(/\.underline/);
    // A utility NOT present in the HTML must not be generated (minimal output).
    expect(css).not.toMatch(/\.grid\s*\{/);
    expect(css).not.toContain('display: grid');
  });

  it('maps brand colors + fonts into the theme as utilities', async () => {
    const brand = {
      colors: { primary: '#0ea5e9', accent: '#f43f5e' },
      typography: { fontFamilies: { display: 'Inter, sans-serif' } },
    } as unknown as Brand;
    const css = await compileUtilityCss(
      ['<a class="bg-primary text-accent font-display">x</a>'],
      brandToTailwindTheme(brand),
      { minify: false },
    );
    expect(css).toContain('#0ea5e9'); // bg-primary resolves to the brand color
    expect(css).toContain('#f43f5e'); // text-accent
    expect(css).toContain('Inter'); // font-display
  });

  it('minifies when asked (smaller output, collapsed declarations)', async () => {
    const html = '<div class="flex p-4 m-2 rounded-lg">x</div>';
    const raw = await compileUtilityCss([html], {}, { minify: false });
    const min = await compileUtilityCss([html], {}, { minify: true });
    expect(min.length).toBeLessThan(raw.length);
    expect(min).toContain('display:flex');
  });

  it('does not emit a preflight reset (additive utility layer only)', async () => {
    const css = await compileUtilityCss(['<div class="flex">x</div>'], {});
    // Preflight zeroes margins on body and sets box-sizing on the universal selector.
    expect(css).not.toMatch(/\*,\s*::before/);
    expect(css).not.toMatch(/body\s*\{[^}]*margin:\s*0/);
  });

  it('ignores theme tokens with unsafe names (no @theme breakout)', async () => {
    const css = await compileUtilityCss(
      ['<div class="p-2">x</div>'],
      { colors: { 'evil}html{color:red': '#fff' } },
      { minify: false },
    );
    expect(css).not.toContain('evil');
    expect(css).not.toContain('color:red');
  });

  it('keeps safe-but-underscored token names as a CSS var (aligned with KeyNameSchema)', async () => {
    // `nav_bg` is a valid brand key; it must not be silently dropped. It emits the
    // var (usable via bg-[var(--color-nav_bg)]) even though `bg-nav_bg` itself is
    // not a Tailwind utility (Tailwind treats `_` as a space in candidates).
    const css = await compileUtilityCss(
      ['<div class="bg-[var(--color-nav_bg)]">x</div>'],
      { colors: { nav_bg: '#123456' } },
      { minify: false },
    );
    expect(css).toContain('--color-nav_bg');
    expect(css).toContain('#123456');
  });
});
