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

  it('ships the schemes in @layer sw-effects, so the AUTHOR always outranks them', async () => {
    const css = await compile('<body class="sw-nav-line-bottom"><ul class="menu"><a class="active">x</a></ul></body>');
    // A scheme selector reaches (0,4,1). No sensible author selector beats that on specificity, and
    // three clones shipped an accent-coloured nav item they had explicitly styled white because of it.
    // Layered declarations lose to ANY unlayered rule, whatever its specificity — that is the fix.
    expect(css).toContain('@layer sw-effects');
    const layerAt = css.indexOf('@layer sw-effects');
    expect(css.indexOf('.sw-nav-line-bottom')).toBeGreaterThan(layerAt);
    // …while keeping their INTERNAL specificity, so base → :hover → .active still resolve as written
    // (`:where()` would have flattened all three and left source order to decide).
    expect(css).toContain('a.active');
    expect(css).not.toContain(':where(.sw-nav-line-bottom');
  });

  it('still tree-shakes per scheme (an unused scheme is not emitted at all)', async () => {
    const css = await compile('<body class="sw-nav-line-bottom"><ul class="menu"><a class="active">x</a></ul></body>');
    expect(css).toContain('sw-nav-line-bottom');
    expect(css).not.toContain('sw-nav-blob');
    expect(css).not.toContain('sw-btn-fx-jelly');
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

  // REGRESSION (measured): a @utility body is a STYLE RULE body, and CSS nesting forbids @keyframes
  // there — the browser ignores it and Lightning CSS strips it from the minified build. sw-btn-pulse /
  // -jelly / -shine / -sparkle all shipped that way and NONE of them animated in production, while the
  // old unminified-only assertion here still passed. Both halves below are needed: the structural check
  // catches the mistake at authoring time, the compile check proves it survives the shipped pipeline.
  it('every animation an effect references resolves to a TOP-LEVEL @keyframes', () => {
    const names = new Set([...EFFECT_UTILITIES.matchAll(/animation:\s*([a-z][\w-]*)/g)].map((m) => m[1]!));
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) {
      const at = EFFECT_UTILITIES.indexOf(`@keyframes ${name} `);
      expect(at, `no @keyframes for "${name}"`).toBeGreaterThanOrEqual(0);
      const before = EFFECT_UTILITIES.slice(0, at);
      const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
      expect(depth, `@keyframes ${name} is nested ${depth} level(s) deep — it will be dropped`).toBe(0);
    }
  });

  it('the keyframes survive the PRODUCTION (minified) compile', async () => {
    const css = await compileUtilityCss(
      ['<button class="btn sw-btn-fx-pulse">x</button><div class="sw-border-beam">c</div>'],
      theme,
      { minify: true },
    );
    expect(css).toContain('@keyframes sw-btn-pulse');
    expect(css).toContain('@keyframes sw-beam-spin');
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

describe('sw-border-beam (box ornament)', () => {
  const beam = (extra = '') => compile(`<div class="sw-border-beam ${extra}">caption</div>`);

  it('paints a conic beam on ::before and MASKS it to a frame (interior stays transparent)', async () => {
    const css = await beam();
    expect(css).toContain('.sw-border-beam');
    expect(css).toContain('&::before');
    expect(css).toContain('conic-gradient(from var(--sw-beam-angle)');
    // the two-layer mask + `exclude` is what punches the middle out — without it the pseudo would
    // cover the caption's content instead of ringing it.
    expect(css).toContain('mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)');
    expect(css).toContain('mask-composite: exclude');
    expect(css).toContain('-webkit-mask-composite: xor'); // Safari's spelling of the same op
    expect(css).toContain('border-radius: inherit'); // follows the host's rounding
    expect(css).toContain('pointer-events: none'); // never eats a click meant for the caption
  });

  it('defaults the beam to the dark-mode-aware brand primary, over NO track', async () => {
    const css = await beam();
    expect(css).toContain('var(--sw-beam-color, var(--sw-color-primary');
    // track off by default — only the travelling light is lit, the rest of the edge is bare
    expect(css).toContain('var(--sw-beam-track, transparent)');
  });

  it('a semi-transparent track can be set as an arbitrary property (the documented recipe)', async () => {
    // The library/guide ship this exact underscore form as copy-paste — Tailwind turns the underscores
    // back into spaces, so it must survive the compile as real color-mix, not a mangled literal.
    const css = await beam('[--sw-beam-track:color-mix(in_oklab,var(--sw-color-primary)_25%,transparent)]');
    // only the UNDERSCORES become spaces; the commas the author typed stay tight
    expect(css).toContain('--sw-beam-track: color-mix(in oklab,var(--sw-color-primary) 25%,transparent)');
  });

  it('exposes the width / speed / arc knobs as overridable vars', async () => {
    const css = await beam();
    expect(css).toContain('var(--sw-beam-width, 8px)');
    expect(css).toContain('var(--sw-beam-speed, 4s)');
    expect(css).toContain('var(--sw-beam-arc, 90deg)');
    // and an arbitrary-property override on the same element compiles to a real declaration
    expect(await beam('[--sw-beam-width:3px]')).toContain('--sw-beam-width: 3px');
  });

  // The utility sets `position: relative` to become the ring's containing block — but slider captions
  // and hero overlays are routinely `absolute`. Tailwind emits the custom utility BEFORE the core
  // layout utilities, so the author's position wins (and an absolute host is a containing block
  // anyway, so the ring still draws). Pin the order: a Tailwind upgrade that flipped it would silently
  // yank every beamed caption back into the flow.
  it('an author position utility still wins over the ring’s position: relative', async () => {
    const css = await compileUtilityCss(
      ['<div class="sw-border-beam absolute bottom-4 rounded-xl">c</div>'],
      theme,
      { minify: true },
    );
    expect(css).toContain('.sw-border-beam{position:relative}');
    // The ring's `position:relative` now lives in `@layer sw-effects`, so the author's `.absolute`
    // wins by LAYER rather than by coming later in the file — a guarantee that survives a Tailwind
    // upgrade reordering its output, which is what the old source-order assertion was guarding.
    const layerAt = css.indexOf('@layer sw-effects');
    expect(layerAt).toBeGreaterThan(-1);
    expect(css.indexOf('.sw-border-beam{')).toBeGreaterThan(layerAt);
    expect(css).toContain('.absolute{');
  });

  it('registers the angle so it INTERPOLATES (an unregistered custom property would jump)', async () => {
    const css = await beam();
    expect(css).toMatch(/@property --sw-beam-angle\s*\{[^}]*syntax: "<angle>"/);
    expect(css).toMatch(/@property --sw-beam-angle\s*\{[^}]*inherits: false/); // never leaks to children
  });

  it('gates the lap behind prefers-reduced-motion, and the RULE tree-shakes when unused', async () => {
    const css = await beam();
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*&::before \{\s*animation: sw-beam-spin/,
    );
    // the ring itself is NOT inside the media query — reduced motion parks the beam, it does not
    // remove the border.
    expect(css.indexOf('conic-gradient')).toBeLessThan(css.indexOf('prefers-reduced-motion'));
    // a page that doesn't use the class gets no rule (the @keyframes + @property registration are
    // unconditional by necessity — see the keyframes note in effects.ts)
    expect(await compile('<div class="rounded-xl">x</div>')).not.toContain('.sw-border-beam');
  });
});
