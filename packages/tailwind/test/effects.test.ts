import { describe, it, expect } from 'vitest';
import { compileUtilityCss } from '../src/compile.js';
import { EFFECT_UTILITIES } from '../src/effects.js';
import { NAV_EFFECTS, BUTTON_EFFECTS, BUTTON_SHAPES, BUTTON_ACCENTS, BUTTON_EFFECT_KIND } from '@sitewright/schema';

const theme = { colors: { primary: '#4f46e5', 'base-100': '#ffffff', 'base-content': '#1a1a23' } };
const compile = (html: string) => compileUtilityCss([html], theme, { minify: false });

describe('nav/button effect utilities', () => {
  it('defines a @utility for every schema-listed scheme (no drift)', () => {
    for (const n of NAV_EFFECTS) expect(EFFECT_UTILITIES).toContain(`@utility sw-nav-${n}`);
    for (const n of BUTTON_EFFECTS) expect(EFFECT_UTILITIES).toContain(`@utility sw-btn-fx-${n}`);
    for (const s of BUTTON_SHAPES) expect(EFFECT_UTILITIES).toContain(`@utility sw-btn-shape-${s}`);
    for (const a of BUTTON_ACCENTS) expect(EFFECT_UTILITIES).toContain(`@utility sw-btn-accent-${a}`);
  });

  it('emits a nav scheme scoped to the .menu links, filled with the brand + derived foreground', async () => {
    const css = await compile('<body class="sw-nav-box-solid"><ul class="menu"><a class="active">x</a></ul></body>');
    expect(css).toContain('.sw-nav-box-solid');
    expect(css).toMatch(/\.menu/);
    expect(css).toContain('var(--color-primary)');
    expect(css).toContain('var(--color-primary-content)');
  });

  it('tree-shakes the schemes whose class is absent', async () => {
    const css = await compile('<body class="sw-nav-box-solid"><ul class="menu"><a>x</a></ul></body>');
    expect(css).not.toContain('sw-nav-line-bottom');
    expect(css).not.toContain('sw-btn-fx-lift');
  });

  it('nav schemes read the dark-mode-aware --sw-color-* tokens (legible in the built-in dark theme)', async () => {
    const css = await compile('<body class="sw-nav-line-bottom"><ul class="menu"><a class="active">x</a></ul></body>');
    expect(css).toContain('--sw-color-primary');
  });

  it('a JS-backed scheme emits the injected-indicator selector + rect vars; a CSS scheme does not', async () => {
    const slide = await compileUtilityCss(
      ['<body class="sw-nav-sliding-pill"><ul class="menu"><a class="active">x</a></ul></body>'],
      theme,
      { minify: true },
    );
    expect(slide).toContain('.sw-nav-indicator');
    expect(slide).toContain('--sw-ind-left');
    const css = await compileUtilityCss(
      ['<body class="sw-nav-line-bottom"><ul class="menu"><a class="active">x</a></ul></body>'],
      theme,
      { minify: true },
    );
    expect(css).not.toContain('sw-nav-indicator');
  });

  it('derives a readable primary-content even on a pure-Tailwind (non-daisy) page', async () => {
    // No daisy class → the non-daisy compile branch; the WCAG -content derivation must still run.
    const css = await compile('<body class="sw-nav-box-solid"><ul class="menu"><a class="active">x</a></ul></body>');
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

  // The FACE-vs-EFFECT contract: a `motion` / `reveal` effect must NOT paint the RESTING face
  // (background / colour / border) — that belongs to the daisyUI variant the author picks, so the two
  // axes compose. Only a `face` effect may. This guards the whole re-architecture from silent drift.
  it('no motion/reveal effect paints the resting face (only `face` effects may)', () => {
    const RESTING_RULE = /& \.btn:not\(\[class\*="sw-btn-fx-"\]\), &\.btn \{([^}]*)\}/g;
    const FORBIDDEN = new Set(['background', 'background-color', 'color', 'box-shadow']);
    for (const effect of BUTTON_EFFECTS) {
      if (BUTTON_EFFECT_KIND[effect] === 'face') continue; // gradient/two-tone/frost/ghost-gradient own the face
      const start = EFFECT_UTILITIES.indexOf(`@utility sw-btn-fx-${effect} {`);
      expect(start, `missing @utility for ${effect}`).toBeGreaterThanOrEqual(0);
      const next = EFFECT_UTILITIES.indexOf('@utility ', start + 1);
      const block = EFFECT_UTILITIES.slice(start, next === -1 ? undefined : next);
      // a motion/reveal effect must NOT use the face-changing helper btnFace() (which paints a solid
      // face on the non-transparent variants) — only `face` effects may. Its selector carries the
      // `:not(.btn-ghost)` guard that btnFx() lacks, so match on that.
      expect(
        block.includes(':not([class*="sw-btn-fx-"]):not(.btn-ghost)'),
        `${effect}: uses btnFace() — only face-kind effects may paint the face`,
      ).toBe(false);
      // and no UNSUFFIXED btnFx() rest rule (`&.btn { … }`, incl. the transition media query) may set a
      // face property either.
      for (const m of block.matchAll(RESTING_RULE)) {
        const props = m[1]!
          .split(';')
          .map((d) => d.split(':')[0]!.trim().toLowerCase())
          .filter(Boolean);
        for (const p of props) {
          expect(FORBIDDEN.has(p), `${effect}: resting rule sets "${p}" — that forces a face`).toBe(false);
        }
      }
    }
  });

  it('a reveal effect composes over a SOLID face — no forced hollow outline, holds the face through hover', async () => {
    // Previously fill-center hard-set `background:transparent; box-shadow: inset 0 0 0 2px` so btn-primary
    // was ignored. Now the rest rule only re-points the hover fill at the face, so the variant wins.
    const css = await compileUtilityCss(
      ['<button class="btn btn-primary sw-btn-fx-fill-center">x</button>'],
      theme,
      { minify: true },
    );
    expect(css).toMatch(/--sw-btn-hover-bg:\s*var\(--sw-btn-face/); // holds the resting face on hover
    expect(css).not.toContain('inset 0 0 0 2px'); // no forced outline ring at rest
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

  it('works site-wide (on <body>) AND per-element (on the .menu / the button)', async () => {
    const nav = await compileUtilityCss(
      ['<ul class="menu sw-nav-box-solid"><li><a class="active">x</a></li></ul>'],
      theme,
      { minify: true },
    );
    expect(nav).toContain('.sw-nav-box-solid.menu a'); // per-element (class on the <ul class="menu">)
    expect(nav).toContain('.sw-nav-box-solid .menu:not([class*=sw-nav-]) a'); // + the GUARDED site-wide descendant form
    const btn = await compileUtilityCss(['<button class="btn sw-btn-fx-lift">x</button>'], theme, { minify: true });
    expect(btn).toContain('.sw-btn-fx-lift.btn'); // per-button compound
    expect(btn).toContain('.sw-btn-fx-lift .btn'); // + the site-wide descendant form
  });

  it('scopes the aria-current active rule to the scheme (guards the double-& regression)', async () => {
    const css = await compileUtilityCss(
      ['<body class="sw-nav-box-solid"><ul class="menu"><a aria-current="page">x</a></ul></body>'],
      theme,
      { minify: true },
    );
    expect(css).toContain('.sw-nav-box-solid .menu:not([class*=sw-nav-]) a[aria-current=page]');
    expect(css).not.toMatch(/\.sw-nav-box-solid\s+\.sw-nav-box-solid/); // the old dead doubled selector
  });

  it('a per-element scheme on a .menu OVERRIDES the site-wide one for that menu (no collision)', async () => {
    // A site-wide box-solid (on <body>) + a custom menu carrying its own line-bottom: the site-wide
    // descendant rule is guarded so it does NOT reach the custom menu — only line-bottom styles it.
    const css = await compileUtilityCss(
      ['<body class="sw-nav-box-solid"><ul class="menu sw-nav-line-bottom"><li><a class="active">x</a></li></ul></body>'],
      theme,
      { minify: true },
    );
    // both schemes compile (both classes are present in the scanned markup)
    expect(css).toContain('.sw-nav-box-solid');
    expect(css).toContain('.sw-nav-line-bottom');
    // the site-wide box-solid descendant form is GUARDED (won't match a .menu with its own sw-nav-* class)
    expect(css).toContain('.sw-nav-box-solid .menu:not([class*=sw-nav-]) a');
    // line-bottom applies per-element to the custom menu (class on the <ul class="menu">)
    expect(css).toContain('.sw-nav-line-bottom.menu a');
    // the UNGUARDED descendant form that used to leak box-solid into the custom menu is gone
    // (only `.sw-nav-box-solid .menu:not(...) a` and the per-element `.sw-nav-box-solid.menu a` remain)
    expect(css).not.toMatch(/\.sw-nav-box-solid \.menu a/);
  });
});
