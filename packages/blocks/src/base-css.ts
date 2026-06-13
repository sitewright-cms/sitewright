// The platform base stylesheet — shipped inline on every rendered document
// (publish + preview) ahead of the skeleton, brand and utility CSS. Two parts:
//
//   1. modern-normalize (vendored, MIT) — a real cross-browser baseline that
//      PRESERVES sensible UA defaults (heading scale, list markers, paragraph
//      margins) and only fixes inconsistencies. It is wrapped in
//      `@layer sw-normalize` so it is the weakest source in the cascade: the
//      skeleton CSS, author `criticalCss`, and the compiled (intentionally
//      unlayered) Tailwind utilities all override it for free. We deliberately do
//      NOT use Tailwind's preflight — preflight RESETS those defaults, which would
//      flatten the semantic HTML tenants/agents author across every site.
//
//   2. Sitewright platform defaults — the small set of opinionated choices
//      normalize leaves out (the link/box-sizing/media rules and the custom
//      scrollbar). Unlayered so utilities still win, but emitted first in source
//      order so the skeleton + criticalCss win too.
//
// CSP-clean (pure CSS, no runtime dependency); the same on every page so it
// caches well in preview and is a single block on publish.

// modern-normalize v3.0.1 — MIT © Sindre Sorhus
// https://github.com/sindresorhus/modern-normalize
// Vendored verbatim (no runtime dep). To update: replace the block below with the
// contents of the pinned release file and bump the version in this header. The
// `/*!` banner ships in the emitted CSS to satisfy the MIT attribution requirement.
const MODERN_NORMALIZE = `
/*! modern-normalize v3.0.1 | MIT License | https://github.com/sindresorhus/modern-normalize */
*,
::before,
::after {
  box-sizing: border-box;
}
html {
  font-family:
    system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif,
    'Apple Color Emoji', 'Segoe UI Emoji';
  line-height: 1.15;
  -webkit-text-size-adjust: 100%;
  tab-size: 4;
}
body {
  margin: 0;
}
b,
strong {
  font-weight: bolder;
}
code,
kbd,
samp,
pre {
  font-family:
    ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 1em;
}
small {
  font-size: 80%;
}
sub,
sup {
  font-size: 75%;
  line-height: 0;
  position: relative;
  vertical-align: baseline;
}
sub {
  bottom: -0.25em;
}
sup {
  top: -0.5em;
}
table {
  border-color: currentcolor;
}
button,
input,
optgroup,
select,
textarea {
  font-family: inherit;
  font-size: 100%;
  line-height: 1.15;
  margin: 0;
}
button,
select {
  text-transform: none;
}
button,
[type='button'],
[type='reset'],
[type='submit'] {
  -webkit-appearance: button;
}
::-moz-focus-inner {
  border-style: none;
  padding: 0;
}
:-moz-focusring {
  outline: 1px dotted ButtonText;
}
:-moz-ui-invalid {
  box-shadow: none;
}
legend {
  padding: 0;
}
progress {
  vertical-align: baseline;
}
::-webkit-inner-spin-button,
::-webkit-outer-spin-button {
  height: auto;
}
[type='search'] {
  -webkit-appearance: textfield;
  outline-offset: -2px;
}
::-webkit-search-decoration {
  -webkit-appearance: none;
}
::-webkit-file-upload-button {
  -webkit-appearance: button;
  font: inherit;
}
summary {
  display: list-item;
}
`.trim();

// Sitewright platform defaults — opinionated choices layered on top of normalize.
// The brand primary is read from `--sw-color-primary` (injected per-project by
// brandToCss); the fallback is the default brand indigo.
const PLATFORM_DEFAULTS = `
/* Foundational box model (kept unlayered so it always wins). */
*, *::before, *::after { box-sizing: border-box; }

/* Links inherit their surrounding text colour (never the unbranded UA blue) — a
   universal default for a code-first/agent CMS: opt into a colour per element with
   a utility class (\`text-primary\`, daisyUI \`.link-primary\`) or CSS. (Colour is not
   a safe link affordance anyway — the underline is.) Separately, links inside
   navigation landmarks, daisyUI menus and buttons drop the underline (their shape
   already signals interactivity); body-copy links keep the default underline,
   removable per element with a no-underline utility.
   MUST live in the weak sw-normalize layer: an UNLAYERED \`a{color:inherit}\` outranks
   every layered rule in the cascade — it was silently overriding daisyUI's layered
   \`.btn{color:var(--btn-fg)}\` (black-on-primary anchor buttons) and any other
   layered colour on links. Layered author rules still beat the UA's link blue. */
@layer sw-normalize {
  a { color: inherit; }
  :is(nav, [role="navigation"]) a, .menu a, .btn { text-decoration: inherit; }
}

/* Responsive media (icons are <svg>, sized by classes — intentionally untouched). */
img, video { max-width: 100%; height: auto; }

/* Hover dropdowns (the documented \`.dropdown.dropdown-hover\` nav-submenu pattern).
   Two fixes so the recommended markup behaves without per-site CSS:
   1. ALIGNMENT — daisyUI's \`.menu\` adds a nested-submenu indent
      (\`margin-inline-start\`) that leaks onto the absolutely-positioned
      \`.dropdown-content\` (which is also a \`.menu\`), pushing the submenu ~16px to the
      side of its trigger. Reset the inline margin so the submenu lines up under its
      parent item. (Unlayered → wins over daisyUI's layered \`.menu\` rule.)
   2. HOVER BRIDGE — the small visual gap between the trigger and the submenu is a
      dead zone: moving the pointer across it drops \`:hover\` and the menu closes
      before you reach it. An always-present \`::after\` on the \`.dropdown\` li fills the
      gap so the hover region is continuous. (A pseudo on \`.dropdown-content\` can't do
      this — daisyUI only renders that element while \`:hover\`, so it's gone in the
      exact instant the pointer is in the gap.)
   One \`--sw-dropdown-gap\` drives BOTH the submenu offset and the bridge height so
   they can't desync; set it on the \`.dropdown\` to change the spacing. Excludes the
   non-downward placements (\`.dropdown-top/-left/-right\`) where a bottom bridge + top
   margin would be wrong; \`.dropdown-bottom\`/\`.dropdown-center\` ARE downward and keep
   the bridge (center positions via inset + translate, so \`margin-inline:0\` is a no-op
   for it). The bridge MUST stay hit-testable — do NOT add \`pointer-events:none\`: it
   is the hover surface that keeps \`:hover\` alive across the gap; making it pass
   pointer events through reopens the dead zone (the menu closes mid-travel again).
   It carries no behavior/href and spans only the trigger's inline box inside the nav
   strip, so it isn't a meaningful click target. */
.dropdown-hover:not(.dropdown-top):not(.dropdown-left):not(.dropdown-right) > .dropdown-content {
  margin-block-start: var(--sw-dropdown-gap, 0.4rem);
  margin-inline: 0;
}
.dropdown-hover:not(.dropdown-top):not(.dropdown-left):not(.dropdown-right)::after {
  content: ""; position: absolute; inset-inline: 0; top: 100%;
  height: var(--sw-dropdown-gap, 0.4rem);
}

/* Solid scrollbars (NO transparency anywhere): a solid track in the page
   background colour (so it blends with the page) and a solid brand-primary thumb
   that darkens while grabbed; no stepper arrows. WebKit/Blink (Chrome/Safari/Edge)
   use the ::-webkit-scrollbar pseudo-elements; Firefox has no pseudos so it uses
   the standard scrollbar-* props (no per-state colour there). The two are mutually
   exclusive — a non-auto standard scrollbar-color/width DISABLES the pseudos in
   Chrome 121+ — so the standard props are confined to browsers WITHOUT the pseudos,
   and the root is reset to \`auto\` where the pseudos exist (daisyUI sets
   scrollbar-color on :root, which would otherwise keep the page bar in standard
   mode and tint it grey). NOTE: a document scrollbar has ONE track colour, so over
   a differently-coloured section the track keeps the page background colour — a
   colour-fill (non-overlay) scrollbar cannot be per-section transparent. */
@supports selector(::-webkit-scrollbar) {
  html:root { scrollbar-color: auto; scrollbar-width: auto; }
  /* solid track = page background (blends in) */
  *::-webkit-scrollbar { width: 12px; height: 12px; background: var(--sw-color-base-100, #ffffff); }
  *::-webkit-scrollbar-track,
  *::-webkit-scrollbar-track-piece,
  *::-webkit-scrollbar-corner { background: var(--sw-color-base-100, #ffffff); }
  *::-webkit-scrollbar-button { width: 0; height: 0; display: none; }
  /* solid full-width primary thumb */
  *::-webkit-scrollbar-thumb { background-color: var(--sw-color-primary, #4f46e5); border-radius: 9999px; }
  *::-webkit-scrollbar-thumb:active { background-color: var(--sw-color-primary, #4f46e5); background-color: color-mix(in srgb, var(--sw-color-primary, #4f46e5) 82%, #000); }
}
@supports not selector(::-webkit-scrollbar) {
  * { scrollbar-width: thin; scrollbar-color: var(--sw-color-primary, #4f46e5) var(--sw-color-base-100, #ffffff); }
  /* beat daisyUI's :root{scrollbar-color} so the page bar is brand-coloured too */
  html:root { scrollbar-color: var(--sw-color-primary, #4f46e5) var(--sw-color-base-100, #ffffff); }
}
`.trim();

/**
 * The platform base stylesheet: the vendored modern-normalize baseline (in its own
 * weakest cascade layer) followed by the unlayered Sitewright platform defaults.
 * Prepended to the per-document base `<style>` so it applies under the skeleton,
 * brand, author critical CSS and Tailwind utilities.
 */
export function baseStyles(): string {
  return `@layer sw-normalize {\n${MODERN_NORMALIZE}\n}\n${PLATFORM_DEFAULTS}`;
}
