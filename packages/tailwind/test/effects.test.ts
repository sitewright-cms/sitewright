import { describe, it, expect } from 'vitest';
import { compileUtilityCss } from '../src/compile.js';
import { EFFECT_UTILITIES } from '../src/effects.js';
import { NAV_EFFECTS, BUTTON_EFFECTS } from '@sitewright/schema';

const theme = { colors: { primary: '#4f46e5', 'base-100': '#ffffff', 'base-content': '#1a1a23' } };
const compile = (html: string) => compileUtilityCss([html], theme, { minify: false });

describe('nav/button effect utilities', () => {
  it('defines a @utility for every schema-listed scheme (no drift)', () => {
    for (const n of NAV_EFFECTS) expect(EFFECT_UTILITIES).toContain(`@utility sw-nav-${n}`);
    for (const n of BUTTON_EFFECTS) expect(EFFECT_UTILITIES).toContain(`@utility sw-btn-${n}`);
  });

  it('emits a nav scheme scoped to the nav landmarks, filled with the brand + derived foreground', async () => {
    const css = await compile('<body class="sw-nav-pill"><nav id="top-nav"><a class="active">x</a></nav></body>');
    expect(css).toContain('.sw-nav-pill');
    expect(css).toMatch(/#top-nav/);
    expect(css).toContain('var(--color-primary)');
    expect(css).toContain('var(--color-primary-content)');
  });

  it('tree-shakes the schemes whose class is absent', async () => {
    const css = await compile('<body class="sw-nav-pill"><nav id="top-nav"><a>x</a></nav></body>');
    expect(css).not.toContain('sw-nav-underline');
    expect(css).not.toContain('sw-btn-lift');
  });

  it('derives a readable primary-content even on a pure-Tailwind (non-daisy) page', async () => {
    // No daisy class → the non-daisy compile branch; the WCAG -content derivation must still run.
    const css = await compile('<body class="sw-nav-pill"><nav id="top-nav"><a class="active">x</a></nav></body>');
    expect(css).toContain('--color-primary-content: #ffffff'); // dark indigo → white
  });

  it('emits a button effect, reading the variant color for a brand-aware glow', async () => {
    const css = await compile('<body class="sw-btn-glow"><button class="btn btn-primary">x</button></body>');
    expect(css).toContain('.sw-btn-glow');
    expect(css).toContain('--btn-color');
  });

  it('ships the pulse @keyframes only when sw-btn-pulse is used', async () => {
    expect(await compile('<button class="btn sw-btn-pulse">x</button>')).toContain('@keyframes sw-pulse');
    expect(await compile('<button class="btn">x</button>')).not.toContain('sw-pulse');
  });

  it('works site-wide (on <body>) AND per-element (on the nav container / the button)', async () => {
    const nav = await compileUtilityCss(
      ['<ul class="menu sw-nav-pill"><li><a class="active">x</a></li></ul>'],
      theme,
      { minify: true },
    );
    expect(nav).toContain('.sw-nav-pill:is(.menu,nav,[role=navigation]) a'); // per-element (class on the <ul>)
    expect(nav).toContain('.sw-nav-pill :is(#top-nav,#mobile-nav) a'); // + the site-wide landmark form
    const btn = await compileUtilityCss(['<button class="btn sw-btn-lift">x</button>'], theme, { minify: true });
    expect(btn).toContain('.sw-btn-lift.btn'); // per-button compound
    expect(btn).toContain('.sw-btn-lift .btn'); // + the site-wide descendant form
  });

  it('scopes the aria-current active rule to the scheme (guards the double-& regression)', async () => {
    const css = await compileUtilityCss(
      ['<body class="sw-nav-pill"><nav id="top-nav"><a aria-current="page">x</a></nav></body>'],
      theme,
      { minify: true },
    );
    expect(css).toContain('.sw-nav-pill :is(#top-nav,#mobile-nav) a[aria-current=page]');
    expect(css).not.toMatch(/\.sw-nav-pill\s+\.sw-nav-pill/); // the old dead doubled selector
  });
});
