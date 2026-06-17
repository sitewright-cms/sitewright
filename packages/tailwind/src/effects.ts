// Sitewright nav + button EFFECT schemes — an opt-in, CI-themed, contrast-safe layer of curated
// hover/active treatments. Each scheme is a Tailwind v4 `@utility` (so it tree-shakes per-scheme:
// only the schemes whose class appears in the rendered HTML are emitted). Apply a scheme class on
// `<body>` for a site-wide effect (what the no-code picker does), or on a single element for a
// one-off — full code-first freedom either way.
//
// NAV schemes style the main nav links — site-wide (class on <body>, scoped to the #top-nav /
// #mobile-nav landmarks) OR per-element (class on the nav container, e.g. <ul class="menu
// sw-nav-box-solid">). The active item is marked with `.active` (author-applied, e.g.
// `{{#if (sw-active path)}}active{{/if}}`) and/or `[aria-current="page"]`. BUTTON effects layer on any
// daisyUI `.btn` — site-wide (class on <body>) or on the button itself (`<button class="btn sw-btn-lift">`).
//
// CONTRAST + DARK MODE: every scheme reads the dark-mode-aware `--sw-color-*` tokens FIRST (P / PC /
// S1 below) with the static daisyUI `--color-*` palette as fallback, so it stays legible AND flips
// correctly in the built-in dark theme. The fill schemes (box-solid / box-fill-* / dot-to-pill) pair
// the brand surface with its WCAG-derived `--sw-color-primary-content` foreground; the line / bracket /
// outline / pill-outline schemes keep the inherited (base-content) text and use the brand only for
// decoration — readable for ANY brand color. Button effects change motion/shadow only, never the
// button's own colors, so they can't break a button's contrast; brand-aware glows read the button's
// variant color via daisyUI's `--btn-color` (falls back to primary).
//
// RUNTIME: three nav schemes are JS-backed — `line-sliding-bottom` / `sliding-pill` use a shared
// `.sw-nav-indicator` the runtime injects + positions via the `--sw-ind-*` rect vars; `spotlight-sliding`
// reads the `--sw-mx` / `--sw-my` pointer vars. The platform ships nav-effects.js only when one is used
// (JS_NAV_EFFECTS in @sitewright/schema). Every other scheme is pure CSS. No-JS → graceful (no indicator).
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
//   the "effect-on" states for a link / pseudo — hover preview + BOTH active markers:
const on = (p = ''): string =>
  `${navLink(`:hover${p}`)}, ${navLink(`.active${p}`)}, ${navLink(`[aria-current="page"]${p}`)}`;
//   the nav CONTAINER itself (landmark or per-element nav) — the positioning context for the
//   JS-backed schemes' injected `.sw-nav-indicator` and the spotlight background:
const navScope = (s = ''): string =>
  `& :is(#top-nav, #mobile-nav)${s}, &:is(.menu, nav, [role="navigation"])${s}`;
//   button, optional `<suffix>` — descendant (class on an ancestor) AND compound (class on the .btn):
const btn = (s = ''): string => `& .btn${s}, &.btn${s}`;

// Dark-mode-aware colour tokens. Every effect reads the tenant `--sw-color-*` namespace FIRST — those
// flip / dark-tune in the built-in dark scheme (blocks/theme-mode.ts) — falling back to the static
// daisyUI `--color-*` palette. So a brand line/fill stays legible and a surface flips in dark with no
// per-effect dark override. Brand decoration = P, on-brand text = PC, muted text = BC, surface = S1.
const P = 'var(--sw-color-primary, var(--color-primary))';
const PC = 'var(--sw-color-primary-content, var(--color-primary-content))';
const S1 = 'var(--sw-color-base-100, var(--color-base-100))';
const RAD = 'var(--radius-field, .375rem)';

/**
 * The effect `@utility` blocks, appended to the Tailwind compile input. Tree-shaken per scheme.
 * Scheme names are the source-of-truth `NAV_EFFECTS` / `BUTTON_EFFECTS` in @sitewright/schema; a test
 * asserts every name here has a matching `@utility`.
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

/* Blob morph keyframes — top-level (referenced only by @utility sw-nav-blob's animation, so Lightning
   CSS keeps them iff that scheme ships and prunes them otherwise → they still tree-shake). */
@keyframes sw-nav-blob { 0%, 100% { border-radius: 42% 58% 63% 37% / 41% 44% 56% 59%; } 50% { border-radius: 58% 42% 38% 62% / 56% 51% 49% 44%; } }

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
