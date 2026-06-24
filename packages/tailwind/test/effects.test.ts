import { describe, it, expect } from 'vitest';
import { compileUtilityCss } from '../src/compile.js';
import { EFFECT_UTILITIES } from '../src/effects.js';
import { NAV_EFFECTS, BUTTON_EFFECTS, BUTTON_SHAPES, BUTTON_ACCENTS } from '@sitewright/schema';

const theme = { colors: { primary: '#4f46e5', 'base-100': '#ffffff', 'base-content': '#1a1a23' } };
const compile = (html: string) => compileUtilityCss([html], theme, { minify: false });

describe('nav/button effect utilities', () => {
  it('defines a @utility for every schema-listed scheme (no drift)', () => {
    for (const n of NAV_EFFECTS) expect(EFFECT_UTILITIES).toContain(`@utility sw-nav-${n}`);
    for (const n of BUTTON_EFFECTS) expect(EFFECT_UTILITIES).toContain(`@utility sw-btn-fx-${n}`);
    for (const s of BUTTON_SHAPES) expect(EFFECT_UTILITIES).toContain(`@utility sw-btn-shape-${s}`);
    for (const a of BUTTON_ACCENTS) expect(EFFECT_UTILITIES).toContain(`@utility sw-btn-accent-${a}`);
  });

  it('emits a nav scheme scoped to the nav landmarks, filled with the brand + derived foreground', async () => {
    const css = await compile('<body class="sw-nav-box-solid"><nav id="top-nav"><a class="active">x</a></nav></body>');
    expect(css).toContain('.sw-nav-box-solid');
    expect(css).toMatch(/#top-nav/);
    expect(css).toContain('var(--color-primary)');
    expect(css).toContain('var(--color-primary-content)');
  });

  it('tree-shakes the schemes whose class is absent', async () => {
    const css = await compile('<body class="sw-nav-box-solid"><nav id="top-nav"><a>x</a></nav></body>');
    expect(css).not.toContain('sw-nav-line-bottom');
    expect(css).not.toContain('sw-btn-fx-lift');
  });

  it('nav schemes read the dark-mode-aware --sw-color-* tokens (legible in the built-in dark theme)', async () => {
    const css = await compile('<body class="sw-nav-line-bottom"><nav id="top-nav"><a class="active">x</a></nav></body>');
    expect(css).toContain('--sw-color-primary');
  });

  it('a JS-backed scheme emits the injected-indicator selector + rect vars; a CSS scheme does not', async () => {
    const slide = await compileUtilityCss(
      ['<body class="sw-nav-sliding-pill"><nav id="top-nav"><a class="active">x</a></nav></body>'],
      theme,
      { minify: true },
    );
    expect(slide).toContain('.sw-nav-indicator');
    expect(slide).toContain('--sw-ind-left');
    const css = await compileUtilityCss(
      ['<body class="sw-nav-line-bottom"><nav id="top-nav"><a class="active">x</a></nav></body>'],
      theme,
      { minify: true },
    );
    expect(css).not.toContain('sw-nav-indicator');
  });

  it('derives a readable primary-content even on a pure-Tailwind (non-daisy) page', async () => {
    // No daisy class → the non-daisy compile branch; the WCAG -content derivation must still run.
    const css = await compile('<body class="sw-nav-box-solid"><nav id="top-nav"><a class="active">x</a></nav></body>');
    expect(css).toContain('--color-primary-content: #ffffff'); // dark indigo → white
  });

  it('emits a button effect reading the --sw-btn-fx accent for a brand-aware glow', async () => {
    const css = await compile('<body class="sw-btn-fx-glow"><button class="btn btn-primary">x</button></body>');
    expect(css).toContain('.sw-btn-fx-glow');
    expect(css).toContain('--sw-btn-fx');
  });

  it('the body-default effect form guards against per-button overrides (mutually exclusive)', async () => {
    const css = await compileUtilityCss(
      ['<body class="sw-btn-fx-fill-slide"><button class="btn">x</button></body>'],
      theme,
      { minify: true },
    );
    expect(css).toContain('.sw-btn-fx-fill-slide .btn:not([class*=sw-btn-fx-])'); // guarded descendant (site default)
    expect(css).toContain('.sw-btn-fx-fill-slide.btn'); // + the per-button compound form
  });

  it('emits the shape + accent utilities (radius var / clip-path / accent role)', async () => {
    const pill = await compile('<button class="btn sw-btn-shape-pill">x</button>');
    expect(pill).toContain('--sw-btn-radius: 999px');
    const cut = await compile('<button class="btn sw-btn-shape-cut">x</button>');
    expect(cut).toContain('clip-path');
    const accent = await compile('<button class="btn sw-btn-accent-primary">x</button>');
    expect(accent).toContain('--sw-btn-fx: var(--sw-color-primary');
  });

  it('ships the pulse @keyframes only when sw-btn-fx-pulse is used', async () => {
    expect(await compile('<button class="btn sw-btn-fx-pulse">x</button>')).toContain('@keyframes sw-btn-pulse');
    expect(await compile('<button class="btn">x</button>')).not.toContain('sw-btn-pulse');
  });

  it('works site-wide (on <body>) AND per-element (on the nav container / the button)', async () => {
    const nav = await compileUtilityCss(
      ['<ul class="menu sw-nav-box-solid"><li><a class="active">x</a></li></ul>'],
      theme,
      { minify: true },
    );
    expect(nav).toContain('.sw-nav-box-solid:is(.menu,nav,[role=navigation]) a'); // per-element (class on the <ul>)
    expect(nav).toContain('.sw-nav-box-solid :is(#top-nav,#mobile-nav) a'); // + the site-wide landmark form
    const btn = await compileUtilityCss(['<button class="btn sw-btn-fx-lift">x</button>'], theme, { minify: true });
    expect(btn).toContain('.sw-btn-fx-lift.btn'); // per-button compound
    expect(btn).toContain('.sw-btn-fx-lift .btn'); // + the site-wide descendant form
  });

  it('scopes the aria-current active rule to the scheme (guards the double-& regression)', async () => {
    const css = await compileUtilityCss(
      ['<body class="sw-nav-box-solid"><nav id="top-nav"><a aria-current="page">x</a></nav></body>'],
      theme,
      { minify: true },
    );
    expect(css).toContain('.sw-nav-box-solid :is(#top-nav,#mobile-nav) a[aria-current=page]');
    expect(css).not.toMatch(/\.sw-nav-box-solid\s+\.sw-nav-box-solid/); // the old dead doubled selector
  });
});
