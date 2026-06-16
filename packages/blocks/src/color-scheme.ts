// Opt-in light/dark color schemes for the rendered site (website.enableColorSchemes). When enabled,
// the platform's theme tokens gain a DARK variant; because every layer reads those tokens — DaisyUI
// components + Tailwind utilities (bg-base-100 / text-base-content) via `--color-*`, and base-css +
// the first-party components via `--sw-color-*` — swapping the neutral tokens flips the whole site at
// once. The per-project DEFAULT scheme is server-rendered onto `<html data-sw-scheme>` and 'auto'
// follows the OS via prefers-color-scheme, so the default has no flash and needs no script.
//
// A visitor can override the default with the `{{sw-theme-toggle}}` helper (this file's THEME_TOGGLE_*
// runtime): it persists the choice in localStorage and re-applies it BEFORE first paint via a tiny
// sync `<head>` script (so a returning visitor's choice doesn't flash). The toggle's sun/moon icon is
// CSS-driven (themeToggleCss), so it reflects the active scheme even with JS off. OKLCH dark-tuned
// brand shades remain a follow-up PR.

export type ColorScheme = 'auto' | 'light' | 'dark';

// DaisyUI v5's curated dark-theme NEUTRALS, applied to BOTH token namespaces (--color-* drives
// DaisyUI + utilities; --sw-color-* drives base-css + the first-party components). The brand roles
// (primary / secondary / accent) are intentionally KEPT at the tenant's light values for now — a
// follow-up derives dark-tuned brand shades in OKLCH so a dark brand colour stays legible on dark.
const DARK_TOKENS = [
  '--color-base-100:oklch(25.33% 0.016 252.42)',
  '--color-base-200:oklch(23.26% 0.014 253.1)',
  '--color-base-300:oklch(21.15% 0.012 254.09)',
  '--color-base-content:oklch(97.807% 0.029 256.847)',
  '--sw-color-base-100:oklch(25.33% 0.016 252.42)',
  '--sw-color-base-200:oklch(23.26% 0.014 253.1)',
  '--sw-color-base-300:oklch(21.15% 0.012 254.09)',
  '--sw-color-base-content:oklch(97.807% 0.029 256.847)',
  'color-scheme:dark',
].join(';');

/**
 * The dark-scheme CSS for the rendered document — emitted ONLY when color schemes are enabled. It is
 * emitted UNLAYERED in the inline base <style>, which gives it two cascade advantages so no
 * `!important` is needed: (a) unlayered always beats the compiled utility sheet's layered token
 * declarations (Tailwind's `@layer theme` + DaisyUI's `@layer base`), and (b) at (0,2,0) it beats the
 * unlayered `:root{…}` light tokens from brandToCss (0,1,0) in any source order. Two paths:
 *  - FORCED dark via `:root[data-sw-scheme="dark"]` — the server-set default + the future visitor toggle.
 *  - AUTO dark via `prefers-color-scheme` that YIELDS to an explicit `data-sw-scheme` (so a pinned
 *    light/dark default, or a toggle choice, always wins over the OS).
 * We use our OWN `data-sw-scheme` attribute (not DaisyUI's `data-theme`) to stay fully decoupled from
 * DaisyUI's attribute handling. DaisyUI runs with themes:false so it emits no brand `[data-theme=…]`
 * block anyway — but owning the attribute keeps this independent of that.
 */
export function colorSchemeCss(): string {
  return (
    `:root[data-sw-scheme="dark"]{${DARK_TOKENS}}\n` +
    `@media (prefers-color-scheme: dark){:root:not([data-sw-scheme]){${DARK_TOKENS}}}`
  );
}

/**
 * The `data-sw-scheme` attribute (with a leading space) for the `<html>` tag, given the project's
 * default scheme. A forced 'light'/'dark' is pinned server-side; 'auto' (or unset) emits nothing so
 * the prefers-color-scheme media query governs. The value is a fixed enum literal — never user input.
 */
export function colorSchemeHtmlAttr(defaultScheme: ColorScheme | undefined): string {
  return defaultScheme === 'light' || defaultScheme === 'dark' ? ` data-sw-scheme="${defaultScheme}"` : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Visitor toggle ({{sw-theme-toggle}}). The helper emits a <button data-sw-theme-toggle> carrying
// both a sun + a moon icon; the marker drives the only-used-ships of the CSS + JS below.

/**
 * Whether an authored string uses the toggle — drives only-used-ships of THEME_TOGGLE_CSS/JS. Matches
 * the single substring `sw-theme-toggle`, which covers the code-first SOURCE helper call
 * (`{{sw-theme-toggle}}`) AND the rendered output (`data-sw-theme-toggle` / `class="sw-theme-toggle"`),
 * so detection works whether the scan sees source (publish) or rendered HTML (preview). A stray text
 * match only over-ships a tiny inert asset. The publish gate ALSO requires color schemes to be enabled,
 * so a disabled site whose source still contains the helper never ships the runtime.
 */
export function usesThemeToggle(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.includes('sw-theme-toggle');
}

/**
 * The toggle's styles — a round, currentColor icon button + a CSS-DRIVEN icon picker. The picker
 * shows the moon in light and the sun in dark using the SAME two paths as {@link colorSchemeCss}
 * (forced `[data-sw-scheme]` + an `auto` `prefers-color-scheme` path that yields to an explicit
 * attribute), so the correct icon shows even before — or without — the JS. Shipped only when a toggle
 * is present. Unlayered like the rest of the inline base styles.
 */
export const THEME_TOGGLE_CSS = [
  '.sw-theme-toggle{display:inline-flex;align-items:center;justify-content:center;width:2.25rem;height:2.25rem;padding:0;border:0;border-radius:9999px;background:transparent;color:inherit;cursor:pointer;line-height:0;-webkit-tap-highlight-color:transparent;transition:background-color .2s ease,transform .15s ease}',
  '.sw-theme-toggle:hover{background:color-mix(in oklab,currentColor 12%,transparent)}',
  '.sw-theme-toggle:active{transform:scale(.92)}',
  '.sw-theme-toggle:focus-visible{outline:2px solid var(--sw-color-primary,currentColor);outline-offset:2px}',
  '.sw-theme-toggle svg{width:1.25rem;height:1.25rem;display:block}',
  // icon picker — moon by default (light), sun in dark; forced + auto(OS) paths mirror colorSchemeCss
  '.sw-theme-toggle .sw-tt-sun{display:none}',
  ':root[data-sw-scheme="dark"] .sw-theme-toggle .sw-tt-sun{display:block}',
  ':root[data-sw-scheme="dark"] .sw-theme-toggle .sw-tt-moon{display:none}',
  ':root[data-sw-scheme="light"] .sw-theme-toggle .sw-tt-sun{display:none}',
  ':root[data-sw-scheme="light"] .sw-theme-toggle .sw-tt-moon{display:block}',
  '@media (prefers-color-scheme: dark){:root:not([data-sw-scheme]) .sw-theme-toggle .sw-tt-sun{display:block}:root:not([data-sw-scheme]) .sw-theme-toggle .sw-tt-moon{display:none}}',
].join('');

/**
 * The toggle runtime — served as a tiny SYNC `<head>` script (no `defer`) so its no-flash step runs
 * before first paint. ES5-style (var/function), served raw and never transpiled (like the other
 * component bundles), and built to be a no-op when the page has no toggle button.
 *
 * Two jobs: (1) NO-FLASH — re-apply the visitor's stored `sw-scheme` choice onto `<html
 * data-sw-scheme>` immediately, before the body renders, so a returning visitor never sees the server
 * default flash to their choice. (2) On DOM-ready, wire every `[data-sw-theme-toggle]` button to flip
 * light⇄dark, persist to localStorage, and keep `aria-pressed` in sync (the icon itself is CSS-driven).
 * The flip uses the View Transitions API for a smooth cross-fade where supported (and reduced-motion
 * is honoured); it degrades to an instant swap. It only ever sets an attribute + a localStorage key —
 * no eval/network — so it runs cleanly under the published site's `default-src 'self'` CSP.
 *
 * NOTE: this is a template literal — keep it free of backticks and `${...}` (they would terminate it).
 */
export const THEME_TOGGLE_JS = `(function(){
  'use strict';
  var KEY='sw-scheme', root=document.documentElement;
  // (1) No-flash: re-apply a stored visitor choice before first paint (this runs sync in <head>).
  try{var s=localStorage.getItem(KEY);
    if(s==='light'||s==='dark'){root.setAttribute('data-sw-scheme',s);}
    else if(s==='auto'){root.removeAttribute('data-sw-scheme');}
  }catch(e){}
  // The scheme in effect right now: an explicit attribute, else the OS preference.
  function effective(){
    var a=root.getAttribute('data-sw-scheme');
    if(a==='light'||a==='dark'){return a;}
    return (window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';
  }
  function reduced(){return window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;}
  // Set the scheme + run `done` AFTER the attribute lands (inside the View-Transition callback, which
  // may run async) so aria-pressed never reflects the pre-click state. Persist the choice immediately.
  function apply(next,done){
    var set=function(){root.setAttribute('data-sw-scheme',next);if(done){done();}};
    if(document.startViewTransition&&!reduced()){document.startViewTransition(set);}else{set();}
    try{localStorage.setItem(KEY,next);}catch(e){}
  }
  function wire(){
    var btns=document.querySelectorAll('[data-sw-theme-toggle]');
    function reflect(){var p=effective()==='dark'?'true':'false';
      for(var i=0;i<btns.length;i++){btns[i].setAttribute('aria-pressed',p);}}
    for(var j=0;j<btns.length;j++){
      btns[j].addEventListener('click',function(){apply(effective()==='dark'?'light':'dark',reflect);});
    }
    reflect();
    // Track OS changes while on 'auto' (no explicit choice) so the button state stays correct.
    if(window.matchMedia){var mq=window.matchMedia('(prefers-color-scheme: dark)');
      var onmq=function(){if(!root.getAttribute('data-sw-scheme')){reflect();}};
      if(mq.addEventListener){mq.addEventListener('change',onmq);}else if(mq.addListener){mq.addListener(onmq);}}
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',wire);}else{wire();}
})();`;
