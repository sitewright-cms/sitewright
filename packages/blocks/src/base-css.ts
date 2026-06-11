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

/* Links take the surrounding text colour (no UA blue). Body-copy links keep the
   default underline, but links inside navigation landmarks and buttons follow
   their context (no underline) — authors opt back in per element with an
   \`underline\` utility. */
a { color: inherit; }
:is(nav, [role="navigation"]) a, .btn { text-decoration: inherit; }

/* Responsive media (icons are <svg>, sized by classes — intentionally untouched). */
img, video { max-width: 100%; height: auto; }

/* Thin, overlay-style scrollbars: transparent track, brand-primary thumb, no
   stepper arrows. The thumb thickens and solidifies on hover / focus / drag; the
   track width is held constant so the thumb widens WITHOUT reflowing content.
   Firefox gets the thin + brand-coloured treatment (it has no steppers and cannot
   widen on hover). */
* {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--sw-color-primary, #4f46e5) 55%, transparent) transparent;
}
*::-webkit-scrollbar { width: 11px; height: 11px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-button { width: 0; height: 0; display: none; }
*::-webkit-scrollbar-corner { background: transparent; }
*::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--sw-color-primary, #4f46e5) 55%, transparent);
  border: 3.5px solid transparent;
  background-clip: padding-box;
  border-radius: 9999px;
}
*:hover::-webkit-scrollbar-thumb,
*:focus::-webkit-scrollbar-thumb,
*::-webkit-scrollbar-thumb:active {
  background-color: var(--sw-color-primary, #4f46e5);
  border-width: 2px;
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
