// Sitewright nav + button EFFECT schemes — an opt-in, CI-themed, contrast-safe layer of curated
// hover/active treatments. Each scheme is a Tailwind v4 `@utility` (so it tree-shakes per-scheme:
// only the schemes whose class appears in the rendered HTML are emitted). Apply a scheme class on
// `<body>` for a site-wide effect (what the no-code picker does), or on a single element for a
// one-off — full code-first freedom either way.
//
// NAV schemes style the nav links INSIDE A `.menu` — site-wide (class on <body>, scoped to every
// `.menu` descendant's links) OR per-element (class on the `.menu` itself, e.g. <ul class="menu
// sw-nav-box-solid">). Links outside a `.menu` (a brand mark, a CTA button, language flags) are left
// alone. The active item is marked with `.active` (author-applied, e.g.
// `{{#if (sw-active path)}}active{{/if}}`) and/or `[aria-current="page"]`. BUTTON effects layer on any
// daisyUI `.btn` — site-wide (class on <body>) or on the button itself (`<button class="btn sw-btn-fx-lift">`).
//
// CONTRAST + DARK MODE: every scheme reads the dark-mode-aware `--sw-color-*` tokens FIRST (P / PC /
// S1 below) with the static daisyUI `--color-*` palette as fallback, so it stays legible AND flips
// correctly in the built-in dark theme. The fill schemes (box-solid / box-fill-* / dot-to-pill) pair
// the brand surface with its WCAG-derived `--sw-color-primary-content` foreground; the line / bracket /
// outline / pill-outline schemes keep the inherited (base-content) text and use the brand only for
// decoration — readable for ANY brand color. Button effects are orthogonal to the FACE (the daisyUI
// variant that owns the resting look): `motion` effects change motion/shadow only; `reveal` effects
// add an accent overlay and flip the label to the accent foreground ON HOVER (the resting face is the
// author's); `face` effects deliberately paint the face. Brand-aware colours read the button's face via
// the vendored `--sw-btn-face` / the accent via `--sw-btn-fx`, so contrast stays correct on any brand.
//
// RUNTIME: three nav schemes are JS-backed — `line-sliding-bottom` / `sliding-pill` use a shared
// `.sw-nav-indicator` the runtime injects + positions via the `--sw-ind-*` rect vars; `spotlight-sliding`
// reads the `--sw-mx` / `--sw-my` pointer vars. The platform ships nav-effects.js only when one is used
// (JS_NAV_EFFECTS in @sitewright/schema). Every other scheme is pure CSS. No-JS → graceful (no indicator).
//
// MOTION is gated behind `prefers-reduced-motion: no-preference`; the active/hover end-states stay.

// A scheme works whether its class is GLOBAL (on <body> via the picker → scoped to links inside any
// `.menu` / any .btn descendant) OR PER-ELEMENT (on the `.menu` or the button itself). Each helper emits
// BOTH selectors. Every `&` is written explicitly (a comma breaks the `&` association), so call sites
// use `${...} { … }` with no extra leading `&`.
//   nav link, optional `<suffix>` (':hover', '.active', '::after', …). Like the button axes below, the
//   site-wide (descendant) form is GUARDED with `:not([class*="sw-nav-"])` so a `.menu` that carries its
//   OWN scheme class (a custom menu like a scrollspy table of contents) is EXCLUDED from the body default
//   and styled ONLY by its per-element scheme — the two never collide. The per-element form (`&.menu`)
//   is unguarded: the class IS on that menu, so it always applies there.
const navLink = (s = ''): string =>
  `& .menu:not([class*="sw-nav-"]) a${s}, &.menu a${s}`;
const navActive = `${navLink('.active')}, ${navLink('[aria-current="page"]')}`;
//   the "effect-on" states for a link / pseudo — hover preview + BOTH active markers:
const on = (p = ''): string =>
  `${navLink(`:hover${p}`)}, ${navLink(`.active${p}`)}, ${navLink(`[aria-current="page"]${p}`)}`;
//   the `.menu` CONTAINER itself — the positioning context for the JS-backed schemes' injected
//   `.sw-nav-indicator` and the spotlight background (same body-default `:not` guard as navLink):
const navScope = (s = ''): string =>
  `& .menu:not([class*="sw-nav-"])${s}, &.menu${s}`;
//   button AXIS helpers (effect / shape / accent). Each class doubles as a site DEFAULT (on <body>,
//   scoped to descendant .btn that DON'T carry their own override for that axis) OR a per-button
//   override (on the .btn itself). The `:not([class*="sw-btn-<axis>-"])` guard makes the body default
//   and a per-button override mutually exclusive per axis — so one CSS block serves both placements.
const btnFx = (s = ''): string => `& .btn:not([class*="sw-btn-fx-"])${s}, &.btn${s}`;
const btnShape = (s = ''): string => `& .btn:not([class*="sw-btn-shape-"])${s}, &.btn${s}`;
const btnAccent = (s = ''): string => `& .btn:not([class*="sw-btn-accent-"])${s}, &.btn${s}`;

// Dark-mode-aware colour tokens. Every effect reads the tenant `--sw-color-*` namespace FIRST — those
// flip / dark-tune in the built-in dark scheme (blocks/theme-mode.ts) — falling back to the static
// daisyUI `--color-*` palette. So a brand line/fill stays legible and a surface flips in dark with no
// per-effect dark override. Brand decoration = P, on-brand text = PC, muted text = BC, surface = S1.
const P = 'var(--sw-color-primary, var(--color-primary))';
const PC = 'var(--sw-color-primary-content, var(--color-primary-content))';
const S1 = 'var(--sw-color-base-100, var(--color-base-100))';
const RAD = 'var(--radius-field, .375rem)';

// Button colour model. FACE = the button's own face colour, FACEC its contrast-correct foreground —
// both published by the VENDORED .btn (blocks/base-css.ts): a variant sets them, ghost/outline are
// transparent. FX = the ACCENT (hover / fill / glow) the baseline + `sw-btn-accent-*` publish via
// `--sw-btn-fx` (default secondary). `--sw-btn-hover-bg` is the baseline's hover fill (defaults to FX;
// the hollow effects set it to `transparent` so their own pseudo animation fills instead).
// A face-changing effect on a bare .btn (no variant — --sw-btn-face unset) falls back to the brand
// primary + its foreground, so the gradient/two-tone paints a real face instead of transparent.
const FACE = 'var(--sw-btn-face, var(--sw-color-primary, var(--color-primary)))';
const FACEC = 'var(--sw-btn-face-content, var(--sw-color-primary-content, var(--color-primary-content)))';
const FX = 'var(--sw-btn-fx, var(--sw-color-secondary, var(--color-secondary)))';
const FXC = 'var(--sw-btn-fx-content, var(--sw-color-secondary-content, var(--color-secondary-content)))';
// face-CHANGING effects (gradient-move / two-tone / frost) paint a SOLID face, so they skip the
// intentionally-transparent variants — a ghost / outline / link button stays transparent.
const SOLID = ':not(.btn-ghost):not(.btn-outline):not(.btn-link):not(.btn-dash)';
const btnFace = (s = ''): string =>
  `& .btn:not([class*="sw-btn-fx-"])${SOLID}${s}, &.btn${SOLID}${s}`;

/**
 * The effect `@utility` blocks, appended to the Tailwind compile input. Tree-shaken per scheme.
 * Scheme names are the source-of-truth `NAV_EFFECTS` / `BUTTON_EFFECTS` in @sitewright/schema; a test
 * asserts every name here has a matching `@utility`.
 *
 * NOT emitted directly — {@link effectCss} rewrites the used blocks first: the nav schemes and the box
 * ornaments into `@layer sw-effects`, the `sw-btn-*` axes UNLAYERED (they have to outrank the platform's
 * own unlayered `.btn` baseline). See that function for why.
 *
 * ★ When you write prose here, remember it is parsed: a line that STARTS with `@utility` or
 * `@keyframes` is read as one. Mid-sentence mentions are fine — both scans are line-anchored — but
 * that was learned twice, once per scan, and the second time cost the Blob nav scheme entirely.
 */
export const EFFECT_UTILITIES = `
/* ── nav schemes ─────────────────────────────────────────────────────────── */
/* Box: Solid — opaque brand pill on the active item (the one scheme that fills a surface, so it pairs
   the brand with its WCAG-derived foreground). */
@utility sw-nav-box-solid {
  ${navLink()} { border-radius: ${RAD}; padding-inline: .625rem; }
  @media (prefers-reduced-motion: no-preference) { ${navLink()} { transition: background-color .18s ease, color .18s ease; } }
  ${navLink(':hover')} { background-color: color-mix(in oklab, ${P} 12%, transparent); }
  ${navActive} { background-color: ${P}; color: ${PC}; }
}
/* Line: Bottom — solid brand underline, a touch wider than the label, grown from the centre. */
@utility sw-nav-line-bottom {
  ${navLink()} { position: relative; }
  ${navLink('::after')} { content: ""; position: absolute; left: 50%; right: 50%; bottom: -.125rem; height: 2.5px; border-radius: 3px; background-color: ${P}; }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::after')} { transition: left .3s cubic-bezier(.16,1,.3,1), right .3s cubic-bezier(.16,1,.3,1); } }
  ${on('::after')} { left: -.125rem; right: -.125rem; }
  ${navActive} { color: ${P}; font-weight: 600; }
}
/* Line: Sliding at Bottom — one shared underline that slides to the hovered/active item (JS runtime
   injects .sw-nav-indicator + sets the --sw-ind-* rect vars). */
@utility sw-nav-line-sliding-bottom {
  ${navScope()} { position: relative; }
  ${navLink()} { position: relative; }
  ${navScope(' > .sw-nav-indicator')} { content: ""; position: absolute; left: var(--sw-ind-left, 0); top: calc(var(--sw-ind-top, 0px) + var(--sw-ind-height, 0px) - 4px); width: var(--sw-ind-width, 0); height: 2.5px; border-radius: 3px; background-color: ${P}; pointer-events: none; list-style: none; }
  @media (prefers-reduced-motion: no-preference) { ${navScope(' > .sw-nav-indicator')} { transition: left .34s cubic-bezier(.34,1.4,.5,1), width .34s cubic-bezier(.34,1.4,.5,1), top .34s cubic-bezier(.34,1.4,.5,1); } }
  ${navActive} { color: ${P}; font-weight: 600; }
}
/* Sliding Pill — a translucent brand pill that slides to the hovered/active item (JS runtime). */
@utility sw-nav-sliding-pill {
  ${navScope()} { position: relative; }
  ${navLink()} { position: relative; z-index: 1; }
  ${navScope(' > .sw-nav-indicator')} { content: ""; position: absolute; left: var(--sw-ind-left, 0); top: var(--sw-ind-top, 0); width: var(--sw-ind-width, 0); height: var(--sw-ind-height, 0); z-index: 0; border-radius: ${RAD}; background-color: color-mix(in oklab, ${P} 16%, transparent); pointer-events: none; list-style: none; }
  @media (prefers-reduced-motion: no-preference) { ${navScope(' > .sw-nav-indicator')} { transition: left .38s cubic-bezier(.34,1.3,.5,1), top .38s cubic-bezier(.34,1.3,.5,1), width .38s cubic-bezier(.34,1.3,.5,1), height .38s cubic-bezier(.34,1.3,.5,1); } }
  ${navActive} { color: ${P}; font-weight: 600; }
}
/* Highlighter — a skewed translucent marker swipes in behind the label. */
@utility sw-nav-highlighter {
  ${navLink()} { position: relative; isolation: isolate; }
  ${navLink('::before')} { content: ""; position: absolute; inset: .1em -.1rem; z-index: -1; border-radius: 3px; background-color: color-mix(in oklab, ${P} 26%, transparent); transform: scaleX(0) skewX(-12deg); transform-origin: left; }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::before')} { transition: transform .28s cubic-bezier(.16,1,.3,1); } }
  ${on('::before')} { transform: scaleX(1) skewX(-12deg); }
  ${navActive} { font-weight: 600; }
}
/* Brackets — large regular-weight [ ] swing in to frame the (centred) label. */
@utility sw-nav-brackets {
  ${navLink()} { position: relative; padding-inline: .85rem; }
  ${navLink('::before')}, ${navLink('::after')} { position: absolute; top: 50%; font-size: 1.5em; line-height: 1; font-weight: 400; color: ${P}; opacity: 0; }
  ${navLink('::before')} { content: "["; left: .1rem; transform: translate(.375rem, calc(-50% - 2px)); }
  ${navLink('::after')} { content: "]"; right: .1rem; transform: translate(-.375rem, calc(-50% - 2px)); }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::before')}, ${navLink('::after')} { transition: opacity .22s ease, transform .26s cubic-bezier(.34,1.4,.5,1); } }
  ${on('::before')}, ${on('::after')} { opacity: 1; transform: translate(0, calc(-50% - 2px)); }
  ${on('')} { color: ${P}; }
}
/* Brackets: Curly — same, with braces. */
@utility sw-nav-brackets-curly {
  ${navLink()} { position: relative; padding-inline: .85rem; }
  ${navLink('::before')}, ${navLink('::after')} { position: absolute; top: 50%; font-size: 1.5em; line-height: 1; font-weight: 400; color: ${P}; opacity: 0; }
  ${navLink('::before')} { content: "{"; left: .1rem; transform: translate(.375rem, calc(-50% - 2px)); }
  ${navLink('::after')} { content: "}"; right: .1rem; transform: translate(-.375rem, calc(-50% - 2px)); }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::before')}, ${navLink('::after')} { transition: opacity .22s ease, transform .26s cubic-bezier(.34,1.4,.5,1); } }
  ${on('::before')}, ${on('::after')} { opacity: 1; transform: translate(0, calc(-50% - 2px)); }
  ${on('')} { color: ${P}; }
}
/* Box: Fill Left — brand fill wipes in from the left; the text inverts to the brand foreground. */
@utility sw-nav-box-fill-left {
  ${navLink()} { position: relative; isolation: isolate; border-radius: ${RAD}; padding-inline: .625rem; }
  ${navLink('::before')} { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; background-color: ${P}; transform: scaleX(0); transform-origin: left; }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::before')} { transition: transform .3s cubic-bezier(.16,1,.3,1); } ${navLink()} { transition: color .25s ease; } }
  ${on('::before')} { transform: scaleX(1); }
  ${on('')} { color: ${PC}; }
}
/* Box: Draw — a hairline border draws itself around the item (two clip-path strokes). */
@utility sw-nav-box-draw {
  ${navLink()} { position: relative; padding-inline: .625rem; }
  ${navLink('::before')}, ${navLink('::after')} { content: ""; position: absolute; inset: 0; border-radius: ${RAD}; pointer-events: none; }
  ${navLink('::before')} { border-top: 2px solid ${P}; border-right: 2px solid ${P}; clip-path: inset(0 0 100% 100%); }
  ${navLink('::after')} { border-bottom: 2px solid ${P}; border-left: 2px solid ${P}; clip-path: inset(100% 100% 0 0); }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::before')} { transition: clip-path .26s ease .04s; } ${navLink('::after')} { transition: clip-path .26s ease; } }
  ${on('::before')}, ${on('::after')} { clip-path: inset(0 0 0 0); }
  ${on('')} { color: ${P}; }
}
/* Glass Pill — a frosted, blurred active pill with a hairline edge. */
@utility sw-nav-glass-pill {
  ${navLink()} { position: relative; isolation: isolate; padding-inline: .625rem; }
  ${navLink('::before')} { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: ${RAD}; background-color: color-mix(in oklab, ${P} 16%, transparent); box-shadow: inset 0 0 0 1px color-mix(in oklab, ${P} 35%, transparent); backdrop-filter: blur(6px); opacity: 0; transform: scale(.86); }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::before')} { transition: opacity .25s ease, transform .3s cubic-bezier(.34,1.4,.5,1); } }
  ${on('::before')} { opacity: 1; transform: scale(1); }
  ${navActive} { color: ${P}; font-weight: 600; }
}
/* Spotlight: Sliding — a radial brand glow follows the cursor across the bar (JS runtime sets
   --sw-mx / --sw-my). */
@utility sw-nav-spotlight-sliding {
  ${navScope()} { position: relative; border-radius: ${RAD}; background-image: radial-gradient(7rem 7rem at var(--sw-mx, -9999px) var(--sw-my, 50%), color-mix(in oklab, ${P} 18%, transparent), transparent 70%); }
  ${navLink()} { position: relative; }
  ${on('')} { color: ${P}; font-weight: 600; }
}
/* Blob — a morphing organic blob settles behind the item. (Its @keyframes live at the top level
   below — nested inside the @utility they get pruned; top-level, Lightning still drops them when the
   scheme is unused, so they tree-shake.) */
@utility sw-nav-blob {
  ${navLink()} { position: relative; isolation: isolate; padding-inline: .625rem; }
  ${navLink('::before')} { content: ""; position: absolute; inset: 0; z-index: -1; background-color: color-mix(in oklab, ${P} 20%, transparent); border-radius: 42% 58% 63% 37% / 41% 44% 56% 59%; transform: scale(0); }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::before')} { transition: transform .4s cubic-bezier(.34,1.4,.5,1); animation: sw-nav-blob 8s ease-in-out infinite; } }
  ${on('::before')} { transform: scale(1); }
  ${navActive} { color: ${P}; font-weight: 600; }
}
/* Line: Top-Down — a long line starts over the words, then drops to an underline. */
@utility sw-nav-line-top-down {
  ${navLink()} { position: relative; }
  ${navLink('::after')} { content: ""; position: absolute; inset-inline: -.125rem; top: .35em; height: 3px; border-radius: 2px; background-color: ${P}; transform: scaleX(0); transform-origin: left; }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::after')} { transition: transform .28s cubic-bezier(.16,1,.3,1), top .34s cubic-bezier(.16,1,.3,1) .16s; } }
  ${on('::after')} { transform: scaleX(1); top: calc(100% - 5px); }
  ${on('')} { color: ${P}; }
}
/* Line: Squiggle — a hand-drawn wavy underline rises in (SVG mask). */
@utility sw-nav-line-squiggle {
  ${navLink()} { position: relative; }
  ${navLink('::after')} { content: ""; position: absolute; inset-inline: 0; bottom: -.1rem; height: 6px; background-color: ${P}; -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='6' viewBox='0 0 20 6'%3E%3Cpath d='M0 3 Q5 0 10 3 T20 3' fill='none' stroke='black' stroke-width='1.6'/%3E%3C/svg%3E") repeat-x left bottom / 20px 6px; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='6' viewBox='0 0 20 6'%3E%3Cpath d='M0 3 Q5 0 10 3 T20 3' fill='none' stroke='black' stroke-width='1.6'/%3E%3C/svg%3E") repeat-x left bottom / 20px 6px; opacity: 0; transform: translateY(3px); }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::after')} { transition: opacity .22s ease, transform .26s cubic-bezier(.16,1,.3,1); } }
  ${on('::after')} { opacity: 1; transform: translateY(0); }
  ${on('')} { color: ${P}; }
}
/* Box: Fill Up — the background fills upward; the text inverts. */
@utility sw-nav-box-fill-up {
  ${navLink()} { position: relative; isolation: isolate; border-radius: ${RAD}; padding-inline: .625rem; }
  ${navLink('::before')} { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; background-color: ${P}; transform: scaleY(0); transform-origin: bottom; }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::before')} { transition: transform .3s cubic-bezier(.16,1,.3,1); } ${navLink()} { transition: color .25s ease; } }
  ${on('::before')} { transform: scaleY(1); }
  ${on('')} { color: ${PC}; }
}
/* Dot-To-Pill — a dot at the bottom morphs into a full brand pill; the text inverts. */
@utility sw-nav-dot-to-pill {
  ${navLink()} { position: relative; isolation: isolate; padding-inline: .625rem; }
  ${navLink('::before')} { content: ""; position: absolute; left: 50%; bottom: .15rem; width: 6px; height: 6px; z-index: -1; background-color: ${P}; border-radius: 99px; transform: translateX(-50%); }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::before')} { transition: width .36s cubic-bezier(.34,1.25,.4,1), height .36s cubic-bezier(.34,1.25,.4,1), bottom .36s ease, border-radius .36s ease; } ${navLink()} { transition: color .25s ease; } }
  ${on('::before')} { width: 100%; height: 100%; bottom: 0; border-radius: ${RAD}; }
  ${on('')} { color: ${PC}; }
}
/* Chevron — a "›" slides in ahead of the label, which nudges over. */
@utility sw-nav-chevron {
  ${navLink()} { position: relative; }
  ${navLink('::before')} { content: "›"; position: absolute; left: .25rem; top: 50%; transform: translateY(-50%); color: ${P}; font-weight: 700; opacity: 0; }
  @media (prefers-reduced-motion: no-preference) { ${navLink()} { transition: color .22s ease, padding-left .22s ease; } ${navLink('::before')} { transition: opacity .22s ease, left .22s ease; } }
  ${on('')} { color: ${P}; padding-left: 1.4rem; }
  ${on('::before')} { opacity: 1; left: .6rem; }
}
/* Corner Ticks — viewfinder brackets swing into two opposite corners. */
@utility sw-nav-corner-ticks {
  ${navLink()} { position: relative; }
  ${navLink('::before')}, ${navLink('::after')} { content: ""; position: absolute; width: 9px; height: 9px; border: 2px solid ${P}; opacity: 0; }
  ${navLink('::before')} { top: .15rem; left: .15rem; border-right: 0; border-bottom: 0; translate: 4px 4px; }
  ${navLink('::after')} { bottom: .15rem; right: .15rem; border-left: 0; border-top: 0; translate: -4px -4px; }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::before')}, ${navLink('::after')} { transition: opacity .2s ease, translate .26s cubic-bezier(.16,1,.3,1); } }
  ${on('::before')}, ${on('::after')} { opacity: 1; translate: 0 0; }
  ${on('')} { color: ${P}; }
}
/* Box: Shadow — an elevated soft-shadow pill lifts the item. */
@utility sw-nav-box-shadow {
  ${navLink()} { position: relative; isolation: isolate; padding-inline: .625rem; }
  ${navLink('::before')} { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: ${RAD}; background-color: ${S1}; box-shadow: 0 8px 18px -7px rgb(0 0 0 / .3); opacity: 0; transform: scale(.9); }
  @media (prefers-reduced-motion: no-preference) { ${navLink('::before')} { transition: opacity .25s ease, transform .3s cubic-bezier(.34,1.3,.5,1); } ${navLink()} { transition: color .25s ease, transform .25s ease; } }
  ${on('::before')} { opacity: 1; transform: scale(1); }
  ${on('')} { color: ${P}; transform: translateY(-1px); }
}

/* ── @keyframes — ALL of them live HERE, at the TOP LEVEL, never inside an @utility ───────────────
   A @utility body becomes the body of a STYLE RULE, and CSS nesting does not allow @keyframes inside
   a style rule: the browser drops it, and Lightning CSS strips it from the minified build entirely.
   Either way the effect's \`animation:\` then names keyframes that do not exist and simply does not run
   — silently, with the utility's other declarations still applying, so it looks styled-but-static.
   (Measured: sw-btn-pulse / -jelly / -shine / -sparkle shipped nested and none of them ever animated.)
   A test asserts every \`animation:\` name in this file resolves to a top-level @keyframes AND survives
   the production (minified) compile.
   The cost of top level is that these ship on every page — ~0.5KB total, unlike the \`@utility\` rules
   they belong to, which do tree-shake. That is the price of them working at all; keep them small. */
@keyframes sw-nav-blob { 0%, 100% { border-radius: 42% 58% 63% 37% / 41% 44% 56% 59%; } 50% { border-radius: 58% 42% 38% 62% / 56% 51% 49% 44%; } }
@keyframes sw-btn-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in oklab, ${FX} 55%, transparent); } 70%, 100% { box-shadow: 0 0 0 14px color-mix(in oklab, ${FX} 0%, transparent); } }
@keyframes sw-btn-jelly { 0% { transform: scale(1,1); } 25% { transform: scale(1.12,.88); } 50% { transform: scale(.9,1.1); } 70% { transform: scale(1.05,.95); } 100% { transform: scale(1,1); } }
@keyframes sw-btn-shine { 0% { background-position: 200% 0; } 100% { background-position: -60% 0; } }
@keyframes sw-btn-sparkle { 0%, 100% { opacity: 0; transform: scale(.4) rotate(0); } 50% { opacity: 1; transform: scale(1) rotate(90deg); } }
@keyframes sw-beam-spin { to { --sw-beam-angle: 360deg; } }

/* ── button EFFECTS (sw-btn-fx-<name>) — the HOVER/MOTION axis, orthogonal to the FACE (the daisyUI
   variant btn-primary / btn-ghost / btn-outline / … that owns the RESTING look). Effects layer on the
   always-on .btn baseline (ripple + hover lift/shadow + fill-to-accent, in blocks/base-css.ts). Each
   class works as a site DEFAULT on <body> or a per-button override on the .btn; the :not() guard keeps
   them mutually exclusive. Three kinds (BUTTON_EFFECT_KIND in @sitewright/schema):
     • motion — pure hover/motion/glint; never touches the resting face → composes on ANY face.
     • reveal — an accent overlay animates in on hover; rests as the author's face (below).
     • face   — DEFINES the resting face (gradient / two-tone / frost / clipped-text); the variant is a
                colour input. frost/gradient-move/two-tone use btnFace() to skip the transparent
                ghost/outline/link variants; ghost-gradient uses btnFx() (gradient text on any face).
   Only the face kind is allowed to paint a resting background/colour — a test enforces this. ─────── */
/* motion family — lean on the baseline fill, add a flourish; face-agnostic */
@utility sw-btn-fx-lift {
  @media (prefers-reduced-motion: no-preference) { ${btnFx()} { transition: transform .2s cubic-bezier(.16,1,.3,1), box-shadow .2s ease; } }
  ${btnFx(':hover')} { transform: translateY(-3px); box-shadow: 0 16px 32px -10px color-mix(in oklab, ${FX} 65%, transparent); }
  ${btnFx(':active')} { transform: translateY(-1px); }
}
@utility sw-btn-fx-glow {
  @media (prefers-reduced-motion: no-preference) { ${btnFx()} { transition: box-shadow .25s ease; } }
  ${btnFx(':hover')}, ${btnFx(':focus-visible')} { box-shadow: 0 0 0 1px color-mix(in oklab, ${FX} 50%, transparent), 0 0 22px color-mix(in oklab, ${FX} 60%, transparent), 0 0 44px color-mix(in oklab, ${FX} 35%, transparent); }
}
@utility sw-btn-fx-pulse {
  ${btnFx(':hover')} { box-shadow: 0 0 0 5px color-mix(in oklab, ${FX} 22%, transparent); }
  @media (prefers-reduced-motion: no-preference) {
    ${btnFx(':not(:hover)')} { animation: sw-btn-pulse 2.2s ease-out infinite; }
  }
}
@utility sw-btn-fx-ring {
  @media (prefers-reduced-motion: no-preference) { ${btnFx()} { transition: box-shadow .3s cubic-bezier(.16,1,.3,1); } }
  ${btnFx(':hover')}, ${btnFx(':focus-visible')} { box-shadow: 0 10px 24px -11px color-mix(in oklab, ${FX} 55%, transparent), 0 0 0 8px color-mix(in oklab, ${FX} 30%, transparent); }
}
@utility sw-btn-fx-magnetic {
  ${btnFx()} { will-change: transform; }
  /* the JS drives transform via inline style; cancel the baseline hover scale so they don't fight. */
  ${btnFx(':hover')} { transform: none; box-shadow: 0 12px 28px -10px color-mix(in oklab, ${FX} 60%, transparent); }
}
@utility sw-btn-fx-arrow {
  ${btnFx('::after')} { content: "\\2192"; width: 0; opacity: 0; overflow: hidden; }
  @media (prefers-reduced-motion: no-preference) { ${btnFx('::after')} { transition: width .25s ease, opacity .25s ease, margin .25s ease; } }
  ${btnFx(':hover::after')} { width: 1.1em; opacity: 1; margin-inline-start: .35em; }
}
@utility sw-btn-fx-bounce {
  @media (prefers-reduced-motion: no-preference) { ${btnFx()} { transition: transform .45s cubic-bezier(.34,1.7,.4,1); } }
  ${btnFx(':hover')} { transform: scale(1.08); }
  ${btnFx(':active')} { transform: scale(.96); }
}
@utility sw-btn-fx-jelly {
  @media (prefers-reduced-motion: no-preference) {
    ${btnFx(':hover')} { animation: sw-btn-jelly .55s; }
  }
}
@utility sw-btn-fx-icon-spin {
  @media (prefers-reduced-motion: no-preference) { ${btnFx(' svg')} { transition: transform .45s cubic-bezier(.34,1.4,.5,1); } }
  ${btnFx(':hover svg')} { transform: rotate(360deg); }
}
@utility sw-btn-fx-long-shadow {
  @media (prefers-reduced-motion: no-preference) { ${btnFx()} { transition: box-shadow .22s ease, transform .22s ease; } }
  ${btnFx(':hover')} { transform: translate(-2px,-2px); box-shadow: 4px 4px 0 color-mix(in oklab, ${FX} 55%, #000), 8px 8px 0 color-mix(in oklab, ${FX} 32%, #000); }
  ${btnFx(':active')} { transform: translate(0,0); box-shadow: 1px 1px 0 color-mix(in oklab, ${FX} 55%, #000); }
}
@utility sw-btn-fx-width-expand {
  @media (prefers-reduced-motion: no-preference) { ${btnFx()} { transition: padding .28s cubic-bezier(.16,1,.3,1), letter-spacing .28s ease, box-shadow .25s ease; } }
  ${btnFx(':hover')} { transform: none; padding-inline: 2.25rem; letter-spacing: .04em; box-shadow: 0 12px 26px -12px color-mix(in oklab, ${FX} 55%, transparent); }
}
/* motion family (glint) — a white light effect over the baseline; face-agnostic */
@utility sw-btn-fx-sheen {
  ${btnFx('::after')} { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; background: linear-gradient(105deg, transparent 35%, rgb(255 255 255 / .4) 50%, transparent 65%); translate: -130% 0; }
  @media (prefers-reduced-motion: no-preference) { ${btnFx('::after')} { transition: translate .65s cubic-bezier(.16,1,.3,1); } ${btnFx(':hover::after')} { translate: 130% 0; } }
}
@utility sw-btn-fx-spotlight {
  ${btnFx('::after')} { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; opacity: 0; background: radial-gradient(80px 80px at var(--sw-btn-mx, 50%) var(--sw-btn-my, 50%), rgb(255 255 255 / .35), transparent 70%); }
  @media (prefers-reduced-motion: no-preference) { ${btnFx('::after')} { transition: opacity .25s ease; } }
  ${btnFx(':hover::after')} { opacity: 1; }
}
@utility sw-btn-fx-shine {
  @media (prefers-reduced-motion: no-preference) {
    ${btnFx('::after')} { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; background: linear-gradient(105deg, transparent 35%, rgb(255 255 255 / .4) 50%, transparent 65%); background-size: 250% 100%; animation: sw-btn-shine 2.6s linear infinite; }
  }
}
@utility sw-btn-fx-sparkle {
  ${btnFx('::before')}, ${btnFx('::after')} { content: "\\2726"; position: absolute; color: #fff; opacity: 0; pointer-events: none; z-index: 1; }
  ${btnFx('::before')} { top: 2px; right: 10px; font-size: .7rem; }
  ${btnFx('::after')} { bottom: 3px; left: 12px; font-size: .55rem; }
  @media (prefers-reduced-motion: no-preference) {
    ${btnFx(':hover::before')} { animation: sw-btn-sparkle .8s ease infinite; }
    ${btnFx(':hover::after')} { animation: sw-btn-sparkle .8s ease .28s infinite; }
  }
}
/* reveal family — an accent animation reveals on HOVER. Unlike the old "hollow" family these NEVER paint
   the resting FACE: the button rests as the author's daisyUI variant (btn-primary solid, btn-outline
   hollow, btn-ghost / bare .btn transparent) and the effect only animates. They hold the resting face
   THROUGH the hover (--sw-btn-hover-bg: var(--sw-btn-face, transparent)) so the baseline instant-fill
   doesn't fight the ::before AND a solid button never blanks to transparent mid-wipe; the ::before paints
   the accent over it (isolated stacking context -> above the face, below the label). Best on a hollow face
   (outline / ghost) — but composes over ANY face. The label flips to the accent foreground on hover. */
@utility sw-btn-fx-fill-center {
  ${btnFx()} { --sw-btn-hover-bg: var(--sw-btn-face, transparent); }
  ${btnFx('::before')} { content: ""; position: absolute; inset: 0; z-index: -1; background: ${FX}; border-radius: 50%; transform: scale(0); }
  @media (prefers-reduced-motion: no-preference) { ${btnFx('::before')} { transition: transform .4s cubic-bezier(.16,1,.3,1); } }
  ${btnFx(':hover::before')} { transform: scale(2.2); }
  ${btnFx(':hover')} { color: ${FXC}; }
}
@utility sw-btn-fx-fill-slide {
  ${btnFx()} { --sw-btn-hover-bg: var(--sw-btn-face, transparent); }
  ${btnFx('::before')} { content: ""; position: absolute; inset: 0; z-index: -1; background: ${FX}; transform: scaleX(0); transform-origin: left; }
  @media (prefers-reduced-motion: no-preference) { ${btnFx('::before')} { transition: transform .35s cubic-bezier(.16,1,.3,1); } }
  ${btnFx(':hover::before')} { transform: scaleX(1); }
  ${btnFx(':hover')} { color: ${FXC}; }
}
@utility sw-btn-fx-fill-up {
  ${btnFx()} { --sw-btn-hover-bg: var(--sw-btn-face, transparent); }
  ${btnFx('::before')} { content: ""; position: absolute; inset: 0; z-index: -1; background: ${FX}; transform: scaleY(0); transform-origin: bottom; }
  @media (prefers-reduced-motion: no-preference) { ${btnFx('::before')} { transition: transform .35s cubic-bezier(.16,1,.3,1); } }
  ${btnFx(':hover::before')} { transform: scaleY(1); }
  ${btnFx(':hover')} { color: ${FXC}; }
}
@utility sw-btn-fx-fill-down {
  ${btnFx()} { --sw-btn-hover-bg: var(--sw-btn-face, transparent); }
  ${btnFx('::before')} { content: ""; position: absolute; inset: 0; z-index: -1; background: ${FX}; transform: scaleY(0); transform-origin: top; }
  @media (prefers-reduced-motion: no-preference) { ${btnFx('::before')} { transition: transform .35s cubic-bezier(.16,1,.3,1); } }
  ${btnFx(':hover::before')} { transform: scaleY(1); }
  ${btnFx(':hover')} { color: ${FXC}; }
}
@utility sw-btn-fx-skew-sweep {
  ${btnFx()} { --sw-btn-hover-bg: var(--sw-btn-face, transparent); }
  ${btnFx('::before')} { content: ""; position: absolute; top: 0; bottom: 0; left: -10%; width: 120%; z-index: -1; background: ${FX}; transform: scaleX(0) skewX(-18deg); transform-origin: left; }
  @media (prefers-reduced-motion: no-preference) { ${btnFx('::before')} { transition: transform .4s cubic-bezier(.16,1,.3,1); } }
  ${btnFx(':hover::before')} { transform: scaleX(1) skewX(-18deg); }
  ${btnFx(':hover')} { color: ${FXC}; }
}
@utility sw-btn-fx-bubble {
  ${btnFx()} { --sw-btn-hover-bg: var(--sw-btn-face, transparent); }
  ${btnFx('::before')} { content: ""; position: absolute; left: 12px; bottom: 8px; width: 8px; height: 8px; z-index: -1; background: ${FX}; border-radius: 50%; transform: scale(0); }
  @media (prefers-reduced-motion: no-preference) { ${btnFx('::before')} { transition: transform .5s cubic-bezier(.16,1,.3,1); } }
  ${btnFx(':hover::before')} { transform: scale(28); }
  ${btnFx(':hover')} { color: ${FXC}; }
}
@utility sw-btn-fx-border-draw {
  ${btnFx()} { --sw-btn-hover-bg: var(--sw-btn-face, transparent); }
  ${btnFx(':hover')} { box-shadow: none; }
  ${btnFx('::before')}, ${btnFx('::after')} { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
  ${btnFx('::before')} { border-top: 2px solid ${FX}; border-right: 2px solid ${FX}; clip-path: inset(0 0 100% 100%); }
  ${btnFx('::after')} { border-bottom: 2px solid ${FX}; border-left: 2px solid ${FX}; clip-path: inset(100% 100% 0 0); }
  @media (prefers-reduced-motion: no-preference) { ${btnFx('::before')} { transition: clip-path .3s ease .05s; } ${btnFx('::after')} { transition: clip-path .3s ease; } }
  ${btnFx(':hover::before')}, ${btnFx(':hover::after')} { clip-path: inset(0 0 0 0); }
}
/* outline-fill — rests as the author's face (pair with btn-outline for the classic hollow look) and
   fills to the accent on hover via the baseline hover-bg, adding an inset ring on hover. */
@utility sw-btn-fx-outline-fill {
  ${btnFx(':hover')} { color: ${FXC}; box-shadow: inset 0 0 0 2px ${FX}, 0 10px 24px -10px color-mix(in oklab, ${FX} 60%, transparent); }
}
@utility sw-btn-fx-text-link {
  ${btnFx()} { --sw-btn-hover-bg: var(--sw-btn-face, transparent); padding-inline: .25rem; }
  ${btnFx(':hover')} { transform: none; box-shadow: none; }
  ${btnFx('::after')} { content: ""; position: absolute; left: .25rem; right: .25rem; bottom: .15rem; height: 2px; background: ${FX}; transform: scaleX(0); transform-origin: left; }
  @media (prefers-reduced-motion: no-preference) { ${btnFx('::after')} { transition: transform .3s cubic-bezier(.16,1,.3,1); } }
  ${btnFx(':hover::after')} { transform: scaleX(1); }
}
/* face family — the effect DEFINES the resting look, so it paints the face. frost / gradient-move /
   two-tone use btnFace() (they skip the intentionally-transparent ghost/outline/link variants);
   ghost-gradient uses btnFx() to clip a gradient into the label on ANY face. */
@utility sw-btn-fx-frost {
  ${btnFace()} { background: color-mix(in oklab, ${FACE} 22%, transparent); color: ${FACE}; backdrop-filter: blur(8px); box-shadow: inset 0 0 0 1px color-mix(in oklab, ${FACE} 35%, transparent); --sw-btn-hover-bg: color-mix(in oklab, ${FACE} 32%, transparent); --sw-btn-hover-fg: ${FACE}; }
  ${btnFace(':hover')} { box-shadow: inset 0 0 0 1px color-mix(in oklab, ${FACE} 55%, transparent), 0 10px 26px -12px color-mix(in oklab, ${FX} 55%, transparent); }
}
@utility sw-btn-fx-gradient-move {
  ${btnFace()} { background: linear-gradient(120deg, ${FACE}, ${FX}, ${FACE}); background-size: 200% 100%; color: ${FACEC}; --sw-btn-hover-fg: ${FACEC}; }
  @media (prefers-reduced-motion: no-preference) { ${btnFace()} { transition: background-position .5s ease; } }
  ${btnFace(':hover')} { background-position: 100% 0; }
}
@utility sw-btn-fx-two-tone {
  ${btnFace()} { background: linear-gradient(90deg, ${FACE} 50%, ${FX} 50%); background-size: 200% 100%; background-position: 0 0; color: ${FACEC}; --sw-btn-hover-fg: ${FXC}; }
  @media (prefers-reduced-motion: no-preference) { ${btnFace()} { transition: background-position .42s ease; } }
  ${btnFace(':hover')} { background-position: -100% 0; }
}
@utility sw-btn-fx-ghost-gradient {
  ${btnFx()} { background: linear-gradient(120deg, ${FACE}, ${FX}); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; box-shadow: inset 0 0 0 1.5px color-mix(in oklab, ${FX} 45%, transparent); --sw-btn-hover-bg: transparent; --sw-btn-hover-fg: transparent; }
  @media (prefers-reduced-motion: no-preference) { ${btnFx()} { transition: box-shadow .25s ease; } }
  ${btnFx(':hover')} { box-shadow: inset 0 0 0 1.5px ${FX}, 0 10px 24px -13px color-mix(in oklab, ${FX} 55%, transparent); }
  /* a disabled button: drop the text-clip so the label colour shows (else the label is invisible). */
  ${btnFx(':disabled')}, ${btnFx('.btn-disabled')} { -webkit-text-fill-color: currentColor; background: none; }
}

/* ── button SHAPES (sw-btn-shape-<name>) — radius / clip-path / icon silhouette ──────────────────── */
@utility sw-btn-shape-rounded { ${btnShape()} { --sw-btn-radius: .7rem; clip-path: none; } }
@utility sw-btn-shape-soft { ${btnShape()} { --sw-btn-radius: .35rem; clip-path: none; } }
@utility sw-btn-shape-sharp { ${btnShape()} { --sw-btn-radius: 0; clip-path: none; } }
@utility sw-btn-shape-pill { ${btnShape()} { --sw-btn-radius: 999px; clip-path: none; } }
@utility sw-btn-shape-cut {
  ${btnShape()} { --sw-btn-radius: 0; clip-path: polygon(9px 0, calc(100% - 9px) 0, 100% 9px, 100% calc(100% - 9px), calc(100% - 9px) 100%, 9px 100%, 0 calc(100% - 9px), 0 9px); }
  ${btnShape(':hover')} { box-shadow: none; filter: drop-shadow(0 7px 12px color-mix(in oklab, ${FX} 45%, transparent)); }
}
@utility sw-btn-shape-skewed {
  ${btnShape()} { --sw-btn-radius: 0; padding-inline: 1.5rem; clip-path: polygon(12px 0, 100% 0, calc(100% - 12px) 100%, 0 100%); }
  ${btnShape(':hover')} { box-shadow: none; filter: drop-shadow(0 7px 12px color-mix(in oklab, ${FX} 45%, transparent)); }
}
@utility sw-btn-shape-square { ${btnShape()} { --sw-btn-radius: .5rem; clip-path: none; aspect-ratio: 1; padding-inline: 0; } }
@utility sw-btn-shape-circle { ${btnShape()} { --sw-btn-radius: 999px; clip-path: none; aspect-ratio: 1; padding-inline: 0; } }

/* ── button ACCENTS (sw-btn-accent-<role>) — the hover/fill/glow colour role (default secondary) ──── */
@utility sw-btn-accent-primary { ${btnAccent()} { --sw-btn-fx: ${P}; --sw-btn-fx-content: ${PC}; } }
@utility sw-btn-accent-secondary { ${btnAccent()} { --sw-btn-fx: var(--sw-color-secondary, var(--color-secondary)); --sw-btn-fx-content: var(--sw-color-secondary-content, var(--color-secondary-content)); } }
@utility sw-btn-accent-accent { ${btnAccent()} { --sw-btn-fx: var(--sw-color-accent, var(--color-accent)); --sw-btn-fx-content: var(--sw-color-accent-content, var(--color-accent-content)); } }
@utility sw-btn-accent-neutral { ${btnAccent()} { --sw-btn-fx: var(--sw-color-neutral, var(--color-neutral)); --sw-btn-fx-content: var(--sw-color-neutral-content, var(--color-neutral-content)); } }

/* ── BOX ornaments (sw-border-*) — decoration for ANY box, tied to neither a .menu nor a .btn ─────
   Unlike the axes above, these carry no site-wide/per-element duality: the class goes on the ONE
   element it decorates (a slider .sw-caption, a pricing card, a featured image, a badge).

   Border Beam — a light travels around the element's edge (the "lighthouse" look), by DEFAULT with no
   static track at all: only the moving light is lit, the rest of the edge is bare. The ring is ONE
   pseudo-element the size of the box, painted with a conic-gradient and then
   MASKED so only a \`--sw-beam-width\` frame survives: two mask layers (one clipped to the content-box,
   one to the border-box) composited with \`exclude\` punch the middle out. That keeps the interior fully
   TRANSPARENT — the beam sits over a frosted/backdrop-blurred caption or a photo without covering it,
   which a border-image or a second opaque layer could not do.
   The travel is the registered \`--sw-beam-angle\` animating 0→360deg (a custom property must be
   @property-registered to be interpolatable; unregistered it would jump discretely once per cycle).

   KNOBS — set them with Tailwind arbitrary properties on the same element, e.g.
   \`class="sw-border-beam [--sw-beam-width:3px] [--sw-beam-speed:6s]"\`:
     --sw-beam-color  the beam (default: the brand primary, dark-mode aware)
     --sw-beam-track  the always-on ring UNDER the beam (default \`transparent\` — beam only). Give it a
                      semi-transparent brand tint to also draw the rest of the edge, e.g.
                      \`[--sw-beam-track:color-mix(in_oklab,var(--sw-color-primary)_25%,transparent)]\`
                      (Tailwind turns the underscores back into spaces).
     --sw-beam-width  ring thickness (default 8px — the bold hero look; 2-3px for a fine card edge)
     --sw-beam-speed  one lap (default 4s)
     --sw-beam-arc    comet length in degrees (default 90deg — a quarter of the perimeter)
   \`border-radius: inherit\` makes the ring follow the element's own rounding, so pair it with rounded-*.
   REDUCED MOTION: the lap is dropped and the beam rests at its 0deg position — still a gradient-lit
   border, no travel. NO @property support (Firefox <128 / Safari <16.4): same static resting state.
   Costs a repaint per frame (a gradient, not a transform), so it is opt-in per element by design —
   decorate the hero caption, not every card in a grid. */
@property --sw-beam-angle { syntax: "<angle>"; initial-value: 0deg; inherits: false; }
@utility sw-border-beam {
  position: relative;
  &::before {
    content: "";
    position: absolute;
    inset: 0;
    /* purely decorative: never intercept a click meant for the caption's link/button underneath */
    pointer-events: none;
    /* Lift the ring above POSITIONED children. Both this pseudo-element and any 'position:relative'
       descendant sit in the positioned-painting layer at 'z-index:auto', where DOM order decides — and
       the pseudo-element comes first, so the descendant wins and the ring vanishes behind it. The
       everyday trigger is '.waves-effect', which the ripple sheet gives 'position:relative': a beamed
       card whose image is a rippling link lost the whole top edge of its ring. (Only outside
       prefers-reduced-motion, since that sheet is gated on it — which is exactly why the bug survives
       a reduced-motion screenshot.) Safe to raise: the ring is masked to the border band and already
       pointer-events:none, so it covers no content and swallows no clicks. */
    z-index: 1;
    padding: var(--sw-beam-width, 8px);
    border-radius: inherit;
    background:
      conic-gradient(from var(--sw-beam-angle), transparent 0deg,
        var(--sw-beam-color, ${P}) calc(var(--sw-beam-arc, 90deg) * .4),
        var(--sw-beam-color, ${P}) calc(var(--sw-beam-arc, 90deg) * .6),
        transparent var(--sw-beam-arc, 90deg)),
      linear-gradient(var(--sw-beam-track, transparent) 0 0);
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
  }
  @media (prefers-reduced-motion: no-preference) {
    &::before { animation: sw-beam-spin var(--sw-beam-speed, 4s) linear infinite; }
  }
}
`;

/**
 * The effect schemes, tree-shaken to what the page uses and moved into `@layer sw-effects`.
 *
 * WHY A LAYER. A scheme selector like `.sw-nav-line-bottom .menu:not([class*="sw-nav-"]) a.active`
 * sits at (0,4,1). No sensible author selector beats that — and three clones out of eight shipped an
 * accent-coloured current nav item against a plain-white original because of it. On one, the agent had
 * authored exactly the right rule (`.nt-navlist > li > a.active`, (0,2,2)) and still lost. The author
 * was not wrong; the platform was simply unanswerable.
 *
 * A cascade layer fixes that at the right level: layered declarations lose to ANY unlayered rule
 * whatever its specificity, so the author's own CSS always wins — while the scheme keeps its full
 * INTERNAL specificity, so its own base → :hover → .active → ::after relationships still resolve
 * exactly as written. `:where()` would have flattened all of those to (0,0,0) and left source order
 * deciding whether the active item beats the resting one. The layer is declared last, so it still
 * outranks daisyUI's own layered `.menu a` rules.
 *
 * ★ WHY THE BUTTON AXES ARE **NOT** IN IT. The nav schemes compete only with daisyUI's own layered
 * `.menu a` rules, so a layer costs them nothing. The button axes compete with the platform's OWN
 * `.btn` baseline (blocks/base-css.ts), which ships UNLAYERED in the page's inline `<style>` — and
 * "layered loses to unlayered whatever its specificity" cuts both ways: it made every effect that
 * touches a property the baseline also sets simply not apply. base-css.ts sizes its selectors for
 * exactly this — `.btn:where(:not(…)):hover` is held at (0,2,0) so a per-button effect's (0,3,0)
 * rule wins — and moving the effects into a layer silently voided that whole calculation.
 *
 * MEASURED before this split (computed styles, real browser, against a no-effect control): 13 of 28
 * effects changed NOTHING at all — lift/glow/ring/bounce/long-shadow/width-expand (transform +
 * box-shadow), frost/gradient-move/two-tone/ghost-gradient (background + colour), outline-fill,
 * magnetic. ALL FOUR hover accents left `--sw-btn-fx` at the baseline's secondary, and ALL EIGHT
 * shapes left `--sw-btn-radius` at the baseline's `.7rem` (only cut/skewed showed anything, via the
 * one property the baseline does not set — `clip-path`). The survivors were exactly the effects that
 * animate a `::before`/`::after` or a `@keyframes`, i.e. the ones with nothing unlayered to lose to.
 *
 * So `sw-btn-*` ships unlayered, restoring the specificity contract base-css.ts documents. The cost
 * is that an author beats a button effect by specificity/order rather than automatically — the same
 * terms on which they already beat the `.btn` baseline itself, and no worse than the status quo,
 * since a dead rule was never something they had to beat.
 *
 * WHY THE REWRITE. `@utility` gives per-scheme tree-shaking (only what the HTML uses is emitted) but
 * Tailwind puts utilities in the UNLAYERED utilities sheet — the thing we are moving away from. So we
 * keep authoring them as `@utility` (one source of truth, and the shape the tests assert) and do the
 * selection here instead: `@utility x { … }` becomes `.x { … }`, which is what Tailwind would have
 * emitted anyway. `&` nesting means the same thing in both forms.
 *
 * Top-level `@keyframes` / `@property` / comments are passed through UNCHANGED and unlayered — a
 * `@property` is a registration, not a declaration, and layering it would be meaningless.
 *
 * @param isUsed answers whether a scheme class appears in the rendered HTML.
 */
export function effectCss(isUsed: (className: string) => boolean): string {
  const src = EFFECT_UTILITIES;
  const passthrough: string[] = [];
  const layered: string[] = [];
  // the button axes (fx / shape / accent) — unlayered, so they can beat the unlayered `.btn` baseline
  const unlayered: string[] = [];
  let i = 0;

  // ★ LINE-ANCHORED, exactly like the `@keyframes` scan below and for exactly the same reason: the
  // PROSE in this file talks ABOUT `@utility`, and a bare `indexOf('@utility ')` happily matched the
  // sentence "nested inside the @utility they get pruned". It then read the scheme name as the rest of
  // that comment and swallowed the block the comment introduces — so `.sw-nav-blob` was NEVER emitted,
  // for any page that asked for it, since the day that comment was written. (A second prose match,
  // "never inside an @utility", ate `@keyframes sw-nav-blob` on its way past.) The keyframes scan was
  // already hardened against this after a comment got spliced into the stylesheet; the utility scan was
  // not, and its failure is quieter — a missing rule looks like a scheme that just does nothing.
  // An at-rule always starts its own line here; a sentence about one never does.
  const UTILITY_AT = /(?:^|\n)[ \t]*@utility[ \t]+([\w-]+)[ \t]*\{/g;
  for (;;) {
    UTILITY_AT.lastIndex = i;
    const m = UTILITY_AT.exec(src);
    if (!m) {
      passthrough.push(src.slice(i));
      break;
    }
    const at = m.index + m[0].indexOf('@utility');
    const name = m[1]!;
    const braceAt = m.index + m[0].length - 1;
    passthrough.push(src.slice(i, at));
    // Walk to the matching close brace — bodies nest (`&`, @media), so counting is required.
    let depth = 0;
    let end = braceAt;
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++;
      else if (src[end] === '}' && --depth === 0) break;
    }
    const body = src.slice(braceAt + 1, end);
    if (isUsed(name)) (name.startsWith('sw-btn-') ? unlayered : layered).push(`.${name} {${body}}`);
    i = end + 1;
  }

  // Keyframes ride INSIDE the layer, with (most of) the rules that animate them. Lightning CSS drops
  // a top-level `@keyframes` whose only reference sits inside `@media` inside `@layer` — it keeps the
  // `animation:` and deletes the animation, which is a dead effect and no warning. Verified: the same
  // block keeps its keyframes when they are declared in the layer and loses them when they are not.
  // A layered `@keyframes` still drives the now-UNLAYERED button rules: layers only arbitrate between
  // two definitions of the SAME name, they do not scope which rules may reference one. (Measured:
  // pulse / jelly / shine / sparkle all still interpolate after the split.) The layer block is
  // therefore emitted whenever ANY scheme is used, even if only button ones are.
  // `@property` and the comments stay outside: a registration is not a declaration to lose a cascade.
  let rest = passthrough.join('');
  const keyframes: string[] = [];
  // Line-anchored: the prose above these blocks TALKS about `@keyframes`, and matching that sentence
  // spliced a comment into the stylesheet. An at-rule here always starts its own line.
  const KEYFRAMES_AT = /(?:^|\n)[ \t]*@keyframes\s+[\w-]+\s*\{/;
  for (;;) {
    const m = KEYFRAMES_AT.exec(rest);
    if (!m) break;
    const at = m.index + m[0].indexOf('@keyframes');
    let depth = 0;
    let end = rest.indexOf('{', at);
    for (; end < rest.length; end++) {
      if (rest[end] === '{') depth++;
      else if (rest[end] === '}' && --depth === 0) break;
    }
    keyframes.push(rest.slice(at, end + 1));
    rest = rest.slice(0, at) + rest.slice(end + 1);
  }

  // No scheme on the page → emit NOTHING. The passthrough is prose and registrations that only mean
  // something next to a scheme, and its comments name `.btn`, which a page using no effects should
  // not carry (a test asserts a pure-Tailwind page never mentions daisyUI's classes).
  if (!layered.length && !unlayered.length) return '';
  return (
    `${rest}\n@layer sw-effects {\n${keyframes.join('\n')}\n${layered.join('\n')}\n}\n` +
    (unlayered.length ? `${unlayered.join('\n')}\n` : '')
  );
}
