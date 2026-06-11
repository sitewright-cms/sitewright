// Sitewright nav + button EFFECT schemes — an opt-in, CI-themed, contrast-safe layer of curated
// hover/active treatments. Each scheme is a Tailwind v4 `@utility` (so it tree-shakes per-scheme:
// only the schemes whose class appears in the rendered HTML are emitted). Apply a scheme class on
// `<body>` for a site-wide effect (what the no-code picker does), or on a single element for a
// one-off — full code-first freedom either way.
//
// NAV schemes style the main nav links — site-wide (class on <body>, scoped to the #top-nav /
// #mobile-nav landmarks) OR per-element (class on the nav container, e.g. <ul class="menu
// sw-nav-pill">). The active item is marked with `.active` (author-applied, e.g.
// `{{#if (sw-active path)}}active{{/if}}`) and/or `[aria-current="page"]`. BUTTON effects layer on any
// daisyUI `.btn` — site-wide (class on <body>) or on the button itself (`<button class="btn sw-btn-lift">`).
//
// CONTRAST: colors come from the brand theme vars. `pill` fills a surface — and pairs
// `var(--color-primary)` with the WCAG-derived `var(--color-primary-content)` (see tokens.ts) — while
// underline / soft / bar keep the inherited (base-content) text and use the brand color only for
// decoration (underline / tint / bar). All four stay readable for ANY brand color. `ghost` is the one
// exception: it colors the ACTIVE TEXT in the brand primary (a deliberate "brand accent" look), so it
// assumes a sufficiently dark primary — the docs flag it. Button effects change motion/shadow only,
// never the button's own colors, so they can't break a button's contrast; brand-aware glows read the
// button's variant color via daisyUI's `--btn-color` (falls back to primary).
//
// MOTION is gated behind `prefers-reduced-motion: no-preference`; the active/hover end-states stay.

// A scheme works whether its class is GLOBAL (on <body> via the picker → scoped to the nav landmarks
// / any .btn descendant) OR PER-ELEMENT (on the nav container or the button itself). Each helper emits
// BOTH selectors. Every `&` is written explicitly (a comma breaks the `&` association), so call sites
// use `${...} { … }` with no extra leading `&`.
//   nav link, optional `<suffix>` (':hover', '.active', '::after', …):
const navLink = (s = ''): string =>
  `& :is(#top-nav, #mobile-nav) a${s}, &:is(.menu, nav, [role="navigation"]) a${s}`;
const navActive = `${navLink('.active')}, ${navLink('[aria-current="page"]')}`;
//   button, optional `<suffix>` — descendant (class on an ancestor) AND compound (class on the .btn):
const btn = (s = ''): string => `& .btn${s}, &.btn${s}`;

/**
 * The effect `@utility` blocks, appended to the Tailwind compile input. Tree-shaken per scheme.
 * Scheme names are the source-of-truth `NAV_EFFECTS` / `BUTTON_EFFECTS` in @sitewright/schema; a test
 * asserts every name here has a matching `@utility`.
 */
export const EFFECT_UTILITIES = `
/* ── nav schemes ─────────────────────────────────────────────────────────── */
@utility sw-nav-pill {
  ${navLink()} { border-radius: var(--radius-field, .375rem); padding-inline: .625rem; transition: background-color .18s ease, color .18s ease; }
  ${navLink(':hover')} { background-color: color-mix(in oklab, var(--color-primary) 12%, transparent); }
  ${navActive} { background-color: var(--color-primary); color: var(--color-primary-content); }
}
@utility sw-nav-underline {
  ${navLink()} { position: relative; }
  ${navLink('::after')} { content: ""; position: absolute; inset-inline: 0; bottom: -.125rem; height: 2px; border-radius: 2px; background-color: var(--color-primary); transform: scaleX(0); transform-origin: left; }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::after')} { transition: transform .2s ease; } }
  ${navLink(':hover::after')}, ${navLink('.active::after')}, ${navLink('[aria-current="page"]::after')} { transform: scaleX(1); }
  ${navActive} { font-weight: 600; }
}
@utility sw-nav-soft {
  ${navLink()} { border-radius: var(--radius-field, .375rem); padding-inline: .625rem; transition: background-color .18s ease; }
  ${navLink(':hover')} { background-color: color-mix(in oklab, var(--color-primary) 8%, transparent); }
  ${navActive} { background-color: color-mix(in oklab, var(--color-primary) 15%, transparent); font-weight: 600; }
}
@utility sw-nav-bar {
  ${navLink()} { position: relative; }
  ${navLink('::after')} { content: ""; position: absolute; inset-inline: .25rem; bottom: -.125rem; height: 3px; border-radius: 3px; background-color: var(--color-primary); opacity: 0; }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::after')} { transition: opacity .18s ease; } }
  ${navLink('.active::after')}, ${navLink('[aria-current="page"]::after')} { opacity: 1; }
  ${navActive} { font-weight: 600; }
}
@utility sw-nav-ghost {
  ${navLink()} { border-radius: var(--radius-field, .375rem); padding-inline: .5rem; transition: background-color .18s ease, color .18s ease; }
  ${navLink(':hover')} { background-color: color-mix(in oklab, var(--color-base-content) 6%, transparent); }
  ${navActive} { color: var(--color-primary); font-weight: 700; }
}

/* ── button effects (on any .btn — site-wide via <body>, or per-button) ──── */
@utility sw-btn-lift {
  ${btn()} { transition: box-shadow .18s ease, transform .18s ease; }
  @media (prefers-reduced-motion: no-preference) {
    ${btn(':hover')} { transform: translateY(-2px); box-shadow: 0 10px 24px -8px rgb(0 0 0 / .28); }
    ${btn(':active')} { transform: translateY(0); box-shadow: 0 4px 10px -6px rgb(0 0 0 / .25); }
  }
  @media (prefers-reduced-motion: reduce) { ${btn(':hover')} { box-shadow: 0 10px 24px -8px rgb(0 0 0 / .28); } }
}
@utility sw-btn-glow {
  ${btn()} { transition: box-shadow .2s ease; }
  ${btn(':hover')}, ${btn(':focus-visible')} { box-shadow: 0 0 0 1px color-mix(in oklab, var(--btn-color, var(--color-primary)) 40%, transparent), 0 8px 26px -6px color-mix(in oklab, var(--btn-color, var(--color-primary)) 60%, transparent); }
}
@utility sw-btn-sheen {
  ${btn()} { position: relative; overflow: hidden; isolation: isolate; }
  ${btn('::after')} { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(105deg, transparent 35%, rgb(255 255 255 / .35) 50%, transparent 65%); translate: -120% 0; }
  @media (prefers-reduced-motion: no-preference) {
    ${btn('::after')} { transition: translate .6s ease; }
    ${btn(':hover::after')} { translate: 120% 0; }
  }
}
@utility sw-btn-press {
  ${btn()} { transition: transform .08s ease; }
  @media (prefers-reduced-motion: no-preference) {
    ${btn(':hover')} { transform: scale(1.02); }
    ${btn(':active')} { transform: scale(.96); }
  }
}
@utility sw-btn-pulse {
  @media (prefers-reduced-motion: no-preference) {
    ${btn(':not(:hover)')} { animation: sw-pulse 2.4s ease-in-out infinite; }
    @keyframes sw-pulse {
      0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--btn-color, var(--color-primary)) 45%, transparent); }
      50% { box-shadow: 0 0 0 6px color-mix(in oklab, var(--btn-color, var(--color-primary)) 0%, transparent); }
    }
  }
}
@utility sw-btn-ring {
  ${btn()} { position: relative; }
  ${btn('::after')} { content: ""; position: absolute; inset: 0; border-radius: inherit; box-shadow: 0 0 0 0 color-mix(in oklab, var(--btn-color, var(--color-primary)) 55%, transparent); }
  @media (prefers-reduced-motion: no-preference) { ${btn('::after')} { transition: box-shadow .25s ease; } }
  ${btn(':hover::after')}, ${btn(':focus-visible::after')} { box-shadow: 0 0 0 4px color-mix(in oklab, var(--btn-color, var(--color-primary)) 30%, transparent); }
}
`;
