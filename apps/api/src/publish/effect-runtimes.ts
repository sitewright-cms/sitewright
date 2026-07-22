// Single source of truth for the MARKER-GATED body-effect runtimes (CSS + JS the platform injects when
// an authored surface uses the effect's data-attribute). BOTH delivery paths consume this table so they
// can never drift:
//   - PUBLISH / whole-site draft preview (build.ts): inline the CSS per page + write the JS as an external
//     `<script src>` at the site root (only-used-ships).
//   - SINGLE-PAGE editor preview (app.ts): inline BOTH the CSS and the JS (the sandboxed preview CSP
//     allows inline script), so the effect runs live for WYSIWYG parity.
//
// Historically the single-page preview kept a hand-maintained copy of this list, which silently drifted
// (a new engine shipped on deploy but not in the preview). Deriving both paths from THIS array — and the
// `runtime-parity.test.ts` guard — makes that regression class structural-impossible for these runtimes.
//
// NOT covered here (each has a path-specific policy, documented at its call site + asserted by the parity
// test's allowlist): whole-site CHROME injected only in the full build (back-to-top button, preloader
// overlay), body-class / shell-gated effects (nav-effects, button-effects, sticky-header, scrollspy),
// the head-inline theme toggle, the component bundle, and the editor↔preview bridges.
import {
  usesAnimations,
  ANIMATION_CSS,
  ANIMATION_JS,
  ANIMATION_NOSCRIPT,
  usesParallax,
  PARALLAX_CSS,
  PARALLAX_JS,
  usesSvgAnim,
  SVG_ANIM_CSS,
  SVG_ANIM_JS,
  SVG_ANIM_NOSCRIPT,
  usesMarquee,
  MARQUEE_CSS,
  usesLazyload,
  LAZYLOAD_CSS,
  LAZYLOAD_JS,
  usesRipple,
  RIPPLE_CSS,
  RIPPLE_JS,
  usesCart,
  CART_CSS,
  CART_JS,
  usesConsent,
  CONSENT_CSS,
  CONSENT_JS,
  usesSvgAnimMorph,
  SVG_ANIM_MORPH_JS,
} from '@sitewright/blocks';

/** How a runtime behaves in the SINGLE-PAGE editor preview:
 *  - 'run'        → inline its CSS + JS (the effect runs live for WYSIWYG parity).
 *  - 'style-only' → inline its CSS but DELIBERATELY not its JS. cart/consent drive floating overlays +
 *                   click handlers that would fight the click-to-edit bridge, so they render styled but
 *                   inert; the live behaviour runs on the published /sites/<slug>/ site. */
export type PreviewMode = 'run' | 'style-only';

export interface BodyEffectRuntime {
  /** Stable key (also the parity-test id). */
  key: string;
  /** Marker detection over the scanned body/slots/snippets HTML. */
  uses: (html: string | null | undefined) => boolean;
  /** Inline stylesheet (both paths inline CSS). */
  css?: string;
  /** Runtime JS — inlined in the single-page preview, written as `script` for publish. Omit for CSS-only. */
  js?: string;
  /** Published filename at the site root (external `<script src>`). Omit for CSS-only runtimes. */
  script?: string;
  /** Single-page-preview behaviour (default 'run'). */
  preview?: PreviewMode;
  /** Optional CSS emitted inside a `<noscript><style>` — for a runtime that hides content from first paint
   *  (svg-anim's no-FOUC rule): when scripting is off the runtime can't reveal, so this cancels the hide. */
  noscript?: string;
}

/** The registry. Order is the CSS-cascade order both paths emit (platform runtime CSS before the utility
 *  sheet). Add a new marker-gated body-effect runtime HERE and it lights up in preview AND publish at once. */
export const BODY_EFFECT_RUNTIMES: readonly BodyEffectRuntime[] = [
  { key: 'animation', uses: usesAnimations, css: ANIMATION_CSS, js: ANIMATION_JS, script: 'animations.js', noscript: ANIMATION_NOSCRIPT },
  { key: 'parallax', uses: usesParallax, css: PARALLAX_CSS, js: PARALLAX_JS, script: 'parallax.js' },
  { key: 'svg-anim', uses: usesSvgAnim, css: SVG_ANIM_CSS, js: SVG_ANIM_JS, script: 'svg-anim.js', noscript: SVG_ANIM_NOSCRIPT },
  // JS-only, SEPARATE chunk: the path-morph interpolator ships only on pages that morph (the core
  // svg-anim runtime skips data-sw-svg="morph"). A morph-only page also loads svg-anim.js (it no-ops).
  { key: 'svg-morph', uses: usesSvgAnimMorph, js: SVG_ANIM_MORPH_JS, script: 'svg-anim-morph.js' },
  { key: 'marquee', uses: usesMarquee, css: MARQUEE_CSS }, // CSS-only (pure CSS animation)
  { key: 'lazyload', uses: usesLazyload, css: LAZYLOAD_CSS, js: LAZYLOAD_JS, script: 'lazyload.js' },
  { key: 'ripple', uses: usesRipple, css: RIPPLE_CSS, js: RIPPLE_JS, script: 'ripple.js' },
  // cart RUNS in the single-page preview: its ENTIRE visible UI (the fixed toggle tab + the drawer) is
  // built by cart.js and gated `display:none` until `data-sw-enhanced`, so 'style-only' rendered NOTHING
  // (the author saw no cart at all). cart.js is preview-safe by construction (localStorage in try/catch,
  // showModal() fallback for the sandboxed iframe) and its overlay is benign in the canvas — the drawer
  // opens only on an explicit toggle click, and an add-to-cart click just writes localStorage.
  { key: 'cart', uses: usesCart, css: CART_CSS, js: CART_JS, script: 'cart.js', preview: 'run' },
  // consent stays style-only: its runtime hydrates HELD cross-origin iframes and drives a page-covering
  // consent GATE, which would be disruptive/incorrect in the editor canvas (single-page preview doesn't
  // grant consent — only the whole-site draft preview does, via build.ts grantAll). KNOWN LIMITATION: the
  // consent banner therefore isn't shown in the single-page preview either (its mount is also empty +
  // display:none-until-enhanced, like the cart was) — a separate follow-up, not fixed here.
  { key: 'consent', uses: usesConsent, css: CONSENT_CSS, js: CONSENT_JS, script: 'consent.js', preview: 'style-only' },
];

/** The inline CSS blocks for every registry runtime a page uses (both paths). */
export function bodyEffectStyles(scanHtml: string): string[] {
  return BODY_EFFECT_RUNTIMES.filter((r) => r.css && r.uses(scanHtml)).map((r) => r.css as string);
}

/** A single `<noscript><style>…</style></noscript>` un-hide for every used runtime that hides content from
 *  first paint (svg-anim + entrance animation), or '' when none apply. Emitted at body-end so a no-JS
 *  visitor — who the runtime can never reveal — still sees the content (PE-first). Empty for a page with no
 *  such runtime. (The publish path in build.ts assembles the equivalent inline; both derive from this
 *  registry's `noscript` fields so they can't drift.) */
export function bodyEffectNoscript(scanHtml: string): string {
  const css = BODY_EFFECT_RUNTIMES.filter((r) => r.noscript && r.uses(scanHtml))
    .map((r) => r.noscript as string)
    .join('');
  return css ? `<noscript><style>${css}</style></noscript>` : '';
}

/** The inline JS blocks for the SINGLE-PAGE preview — every 'run' runtime the page uses (style-only ones
 *  like consent are excluded: inert in the editor canvas). */
export function previewBodyEffectScripts(scanHtml: string): string[] {
  return BODY_EFFECT_RUNTIMES.filter((r) => r.js && (r.preview ?? 'run') === 'run' && r.uses(scanHtml)).map((r) => r.js as string);
}

/** The external site-root scripts to LINK for a publish/whole-site build (every runtime with a `script`
 *  the page uses). Returned as {script, js} so the caller links + writes them. */
export function publishBodyEffectFiles(scanHtml: string): Array<{ script: string; js: string }> {
  return BODY_EFFECT_RUNTIMES.filter((r) => r.script && r.js && r.uses(scanHtml)).map((r) => ({ script: r.script as string, js: r.js as string }));
}
