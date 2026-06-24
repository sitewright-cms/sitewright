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

  it('emits font-heading / font-body / font-<name> utilities resolving to the --sw-font-* vars', async () => {
    const brand = {
      colors: {},
      typography: { named: { boombox: { source: 'local', family: 'Boombox', weight: 800, fontId: 'up-x' } } },
    } as unknown as Brand;
    const css = await compileUtilityCss(
      ['<h1 class="font-heading">t</h1><p class="font-body">b</p><span class="font-boombox">x</span>'],
      brandToTailwindTheme(brand),
      { minify: true },
    );
    // The built-in slot utilities + the custom named slot utility all generate, each pointing at its
    // --sw-font-* var (defined at runtime by typographyCss) via Tailwind's --font-<name> theme token.
    expect(css).toContain('var(--sw-font-heading)');
    expect(css).toContain('var(--sw-font-body)');
    expect(css).toContain('var(--sw-font-boombox)');
    expect(css).toMatch(/\.font-heading\{/);
    expect(css).toMatch(/\.font-boombox\{/);
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

  it('emits DaisyUI component CSS when a daisyUI class is used, themed by the brand', async () => {
    const css = await compileUtilityCss(
      ['<div class="card bg-base-100"><div class="card-body"><span class="badge badge-primary text-primary">x</span></div></div>'],
      { colors: { primary: '#e11d48' } },
      { minify: false },
    );
    // DaisyUI's components are present…
    expect(css).toContain('.card-body');
    // …EXCEPT the button component, which we exclude + vendor ourselves (blocks/base-css.ts) so we own
    // the .btn cascade/contrast — so the compile must NOT emit daisyUI's .btn.
    expect(css).not.toMatch(/\.btn(\s|\{|,)/);
    // …the brand color themes `--color-primary` (and NOT DaisyUI's default indigo)…
    expect(css).toContain('#e11d48');
    expect(css).not.toContain('oklch(45% 0.24 277.023)');
    // …and DaisyUI's required base palette is supplied so components look right.
    expect(css).toContain('--color-base-100');
  });

  it('pulls in DaisyUI when only its surface colors are used (e.g. bg-base-200)', async () => {
    const css = await compileUtilityCss(['<div class="bg-base-200 text-base-content">x</div>'], {}, { minify: false });
    // The DaisyUI palette is supplied, so the surface-color utilities actually resolve.
    expect(css).toContain('--color-base-200');
    expect(css).toContain('--color-base-content');
  });

  it('does NOT pull in DaisyUI for a pure-Tailwind page (keeps minimal output)', async () => {
    const css = await compileUtilityCss(['<div class="flex gap-4 px-6">x</div>'], { colors: { primary: '#e11d48' } });
    expect(css).not.toContain('--color-base-100'); // no DaisyUI base layer
    expect(css).not.toMatch(/\.btn\b/);
    // Plain utilities still compile as before.
    expect(css).toContain('display:flex');
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
