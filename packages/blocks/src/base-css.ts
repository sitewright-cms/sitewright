// The platform base stylesheet — shipped inline on every rendered document
// (publish + preview) ahead of the skeleton, brand and utility CSS. Two parts:
//
//   1. modern-normalize (vendored, MIT) — a real cross-browser baseline that
//      fixes UA inconsistencies (and KEEPS the heading font-size scale + list
//      markers). It is wrapped in `@layer sw-normalize` so it is the weakest
//      source in the cascade: the skeleton CSS, author `criticalCss`, and the
//      compiled (intentionally unlayered) Tailwind utilities all override it for
//      free. We do NOT use Tailwind's full preflight (which also flattens the
//      heading scale + list markers).
//
//   2. Sitewright platform defaults — the small set of opinionated choices
//      normalize leaves out (the link/box-sizing/media rules and the custom
//      scrollbar), PLUS a deterministic block-margin reset: UA margins on flow
//      elements (h1–h6, p, ul/ol, blockquote, figure, hr, pre, dl/dd) are zeroed
//      so vertical spacing is set EXPLICITLY (utilities / `.prose`), identical
//      across browsers — the one Tailwind-preflight-style reset we adopt. A
//      lightweight `.prose` restores rhythm for rich/markdown bodies. All in the
//      weak sw-normalize layer (utilities still win). Unlayered platform copy is
//      emitted first in source order so the skeleton + criticalCss win too.
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
   every layered rule in the cascade — it would silently override any layered colour on a
   link (e.g. a themed anchor button). Layered author rules still beat the UA's link blue. */
@layer sw-normalize {
  a { color: inherit; }
  :is(nav, [role="navigation"]) a, .menu a, .btn { text-decoration: inherit; }
}

/* Site-wide CONTENT CONTAINER — one knob (\`--sw-container\`, from the Website "Content width" setting)
   aligns + retunes every section's content. \`width:100%\` keeps it fluid; \`max-width\` caps it; auto
   inline margins centre it; a responsive gutter keeps content off the viewport edges. \`--sw-container:
   none\` → full-bleed (no cap). In the weak sw-normalize layer so author utilities/CSS override it. */
@layer sw-normalize {
  .sw-container { width: 100%; max-width: var(--sw-container, 1200px); margin-inline: auto; padding-inline: clamp(1rem, 5vw, 5rem); }
}

/* Inline code / keyboard / sample / preformatted text get a light "chip" treatment
   (monospace font is already set verbatim by normalize above). MUST live in the weak
   sw-normalize layer: an UNLAYERED bare \`kbd\`/\`code\` rule would outrank daisyUI's
   LAYERED \`.kbd\` / \`.mockup-code\` components (unlayered beats any layer regardless of
   specificity — see the link-rule note above), clobbering them on every site. Layered
   here, daisyUI components + author utilities (\`bg-*\`, \`.kbd\`) + criticalCss all win.
   A <code>/<kbd>/<samp> nested in a <pre> is reset so the block doesn't draw a second
   chip-on-a-chip (the <pre> is the box; its inner text inherits). */
@layer sw-normalize {
  code, kbd, samp, pre {
    /* Theme-aware chip: a faint base-content tint over the surface, so it INVERTS automatically on a
       dark palette (subtle light chip on dark) instead of staying a light-grey block. Fallback #EEE
       for engines without color-mix. */
    background: #EEE;
    background: color-mix(in srgb, var(--sw-color-base-content, #0f172a) 8%, var(--sw-color-base-100, #fff));
    padding: .25rem;
    color: var(--sw-color-base-content, #4a4a4a);
    border-radius: 5px;
  }
  pre code, pre kbd, pre samp { background: none; padding: 0; border-radius: 0; color: inherit; }
}

/* Text inputs / textarea / select get an attractive, THEME-AWARE default (surface + content + a soft
   base-content border, all from the brand vars so they invert on a dark palette) with a clean focus:
   the UA/double outline is dropped for a primary-coloured border + a soft primary ring. Lives in the
   weak sw-normalize layer, so daisyUI's .input/.select/.textarea and author utilities (bg-*, border-*,
   focus:*, rounded-*) still win when used — this only styles OTHERWISE-bare controls (e.g. the
   platform Form component's fields). Scoped to text-like types so checkboxes / radios / range / color
   / file / buttons keep their native appearance. */
@layer sw-normalize {
  input[type="text"], input[type="email"], input[type="password"], input[type="search"],
  input[type="url"], input[type="tel"], input[type="number"], input[type="date"], input[type="time"],
  input[type="datetime-local"], input[type="month"], input[type="week"], input:not([type]),
  textarea, select {
    background: var(--sw-color-base-100, #ffffff);
    color: var(--sw-color-base-content, #0f172a);
    border: 1px solid color-mix(in srgb, var(--sw-color-base-content, #0f172a) 22%, transparent);
    border-radius: .5rem;
    padding: .5rem .75rem;
    transition: border-color .15s ease, box-shadow .15s ease;
  }
  /* :focus (not :focus-visible) is deliberate: the active-field ring is useful to ALL users for a
     form control, not only keyboard users. outline:none is safe because the primary border + ring
     is a clearly visible replacement indicator (and forced-colors mode remaps the border colour). */
  input[type="text"]:focus, input[type="email"]:focus, input[type="password"]:focus,
  input[type="search"]:focus, input[type="url"]:focus, input[type="tel"]:focus,
  input[type="number"]:focus, input[type="date"]:focus, input[type="time"]:focus,
  input[type="datetime-local"]:focus, input[type="month"]:focus, input[type="week"]:focus,
  input:not([type]):focus, textarea:focus, select:focus {
    outline: none;
    border-color: var(--sw-color-primary, #4f46e5);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--sw-color-primary, #4f46e5) 22%, transparent);
  }
  /* A bare <select> (e.g. the Form component's dropdown fields): drop the native arrow for a custom
     chevron with room for it, so the arrow is not clipped in Firefox and looks consistent. The
     chevron is a neutral slate (legible on a light OR dark surface); background-color stays the field
     surface from the rule above (this only sets the image layer). */
  select {
    -webkit-appearance: none;
    appearance: none;
    padding-right: 2.25rem;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right .7rem center;
    background-size: .8rem;
  }
}

/* Deterministic block spacing: ZERO the UA margins on flow elements so vertical spacing is set
   EXPLICITLY (spacing utilities such as mt-N, space-y-N, gap-N, or \`.prose\`), identical across
   browsers — the one Tailwind-preflight-style reset we adopt. We still KEEP the heading font-size
   SCALE and list MARKERS (font-size + list-style/padding untouched). Weak layer → any author utility
   / criticalCss / \`.prose\` wins. (\`body\` margin is already zeroed by normalize.)
   NB: do NOT write Tailwind globs like "mt-(asterisk)" in THIS comment — a literal asterisk-slash
   would close the CSS comment early and drop the rule below (the original bug this fixes). */
@layer sw-normalize {
  h1, h2, h3, h4, h5, h6, p, blockquote, figure, dl, dd, pre, hr, ul, ol, fieldset { margin: 0; }
}

/* Rich/markdown content opt-in: class="prose" restores a readable vertical rhythm to authored
   long-form bodies (article / legal / FAQ) AFTER the reset above; escape any child with
   class="not-prose". A LIGHTWEIGHT stand-in for @tailwindcss/typography (margins only — fonts come
   from typographyCss). Specificity (the \`.prose\` class) beats the bare-element reset within the
   layer; utilities + criticalCss still override (weak layer). \`:where()\` keeps the selectors at
   class-level specificity and scopes out \`.not-prose\` subtrees. */
@layer sw-normalize {
  .prose :where(p, ul, ol, blockquote, figure, pre, table, hr, h1, h2, h3, h4, h5, h6):not(:where(.not-prose, .not-prose *)) { margin: 1em 0; }
  .prose :where(h2, h3, h4, h5, h6):not(:where(.not-prose, .not-prose *)) { margin-top: 1.5em; }
  .prose > :where(:first-child):not(:where(.not-prose, .not-prose *)) { margin-top: 0; }
  .prose > :where(:last-child):not(:where(.not-prose, .not-prose *)) { margin-bottom: 0; }
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

/* ── BUTTONS — VENDORED (daisyUI's button component is EXCLUDED in the Tailwind compile; we own the
   whole .btn here so we control the cascade, contrast and behaviour — no fighting daisy's var system).
   Model: every .btn has a FACE colour (--sw-btn-face / --sw-btn-face-content) and an ACCENT
   (--sw-btn-fx / --sw-btn-fx-content — the hover-fill / effect colour, default secondary). Variants set
   the face with its WCAG-derived foreground; ghost/outline are transparent; on hover the face fills to
   the accent. The EFFECT / SHAPE / ACCENT utilities (@sitewright/tailwind effects.ts) read these vars;
   the ripple needs button-effects.ts (only-when-used). Same class vocabulary as daisyUI. */
.btn {
  /* --sw-btn-face / --sw-btn-face-content are intentionally LEFT UNSET on the base, so a bare .btn is
     transparent (via the property defaults below) BUT a face-CHANGING effect can default to the brand
     primary rather than paint transparent. Variants set them; ghost/outline/soft set them explicitly. */
  --sw-btn-fx: var(--sw-color-secondary, var(--color-secondary, #0ea5e9));
  --sw-btn-fx-content: var(--sw-color-secondary-content, var(--color-secondary-content, #ffffff));
  --sw-btn-hover-bg: var(--sw-btn-fx);
  --sw-btn-hover-fg: var(--sw-btn-fx-content);
  --sw-btn-radius: .7rem;
  --sw-btn-py: .8rem;
  --sw-btn-px: 1.15rem;
  --sw-btn-fs: .95rem;
  display: inline-flex; align-items: center; justify-content: center; gap: .5rem;
  /* PADDING-based sizing (no fixed height) so a button grows with its content — multi-line labels, an
     icon + text, larger glyphs — instead of clipping. Sizes set --sw-btn-py / --sw-btn-px. */
  padding: var(--sw-btn-py) var(--sw-btn-px);
  font: inherit; font-weight: 600; font-size: var(--sw-btn-fs); line-height: 1.25;
  text-align: center; text-decoration: none; white-space: nowrap; vertical-align: middle;
  cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
  border: 0; border-radius: var(--sw-btn-radius);
  /* logical corners so a daisyUI .join group can round only its outer corners (it sets --join-*) */
  border-start-start-radius: var(--join-ss, var(--sw-btn-radius));
  border-start-end-radius: var(--join-se, var(--sw-btn-radius));
  border-end-end-radius: var(--join-ee, var(--sw-btn-radius));
  border-end-start-radius: var(--join-es, var(--sw-btn-radius));
  background: var(--sw-btn-face, transparent);
  color: var(--sw-btn-face-content, var(--sw-color-base-content, var(--color-base-content, #1a1a23)));
  position: relative; isolation: isolate; overflow: hidden;
}
/* a checkbox/radio styled as a button (daisyUI's join toggle pattern) must lose its native control */
.btn:is(input[type="checkbox"], input[type="radio"]) { appearance: none; -webkit-appearance: none; }
@media (prefers-reduced-motion: no-preference) {
  .btn { transition: transform .22s cubic-bezier(.16, 1, .3, 1), box-shadow .22s ease, background-color .25s ease, color .25s ease; }
}
.btn:focus-visible { outline: 2px solid var(--sw-btn-fx); outline-offset: 2px; }
/* hover: the face fills to the accent + a small lift + shadow (text-link + disabled stay flat). The
   exclusions ride inside :where() so this stays (0,2,0) — a per-button effect's own
   sw-btn-fx hover rule (0,3,0) OVERRIDES the baseline transform/shadow/fill, while a plain .btn still
   gets this default. (Without :where() the :not() chain would be (0,4,0) and suppress effects.) */
.btn:where(:not(.btn-link):not(.btn-disabled):not(:disabled)):hover {
  background-color: var(--sw-btn-hover-bg);
  color: var(--sw-btn-hover-fg);
  transform: scale(1.03);
  box-shadow: 0 10px 24px -11px color-mix(in oklab, var(--sw-btn-fx) 60%, transparent);
}
.btn:where(:not(.btn-link):not(.btn-disabled):not(:disabled)):active { transform: scale(.97); }
.btn:disabled, .btn[disabled], .btn-disabled { cursor: not-allowed; pointer-events: none; opacity: .45; }
/* active / selected (a toggle, or the current item in a join group): the accent-filled state */
.btn-active { background-color: var(--sw-btn-fx); color: var(--sw-btn-fx-content); box-shadow: none; transform: none; }
/* solid variants — face + its WCAG-derived foreground (always contrast-correct) */
.btn-primary   { --sw-btn-face: var(--sw-color-primary,   var(--color-primary,   #4f46e5)); --sw-btn-face-content: var(--sw-color-primary-content,   var(--color-primary-content,   #ffffff)); }
.btn-secondary { --sw-btn-face: var(--sw-color-secondary, var(--color-secondary, #0ea5e9)); --sw-btn-face-content: var(--sw-color-secondary-content, var(--color-secondary-content, #06283a)); }
.btn-accent    { --sw-btn-face: var(--sw-color-accent,    var(--color-accent,    #f59e0b)); --sw-btn-face-content: var(--sw-color-accent-content,    var(--color-accent-content,    #3a2406)); }
.btn-neutral   { --sw-btn-face: var(--sw-color-neutral,   var(--color-neutral,   #171627)); --sw-btn-face-content: var(--sw-color-neutral-content,   var(--color-neutral-content,   #ffffff)); }
.btn-info      { --sw-btn-face: var(--color-info,    #0ea5e9); --sw-btn-face-content: var(--color-info-content,    #ffffff); }
.btn-success   { --sw-btn-face: var(--color-success, #16a34a); --sw-btn-face-content: var(--color-success-content, #ffffff); }
.btn-warning   { --sw-btn-face: var(--color-warning, #f59e0b); --sw-btn-face-content: var(--color-warning-content, #3a2406); }
.btn-error     { --sw-btn-face: var(--color-error,   #dc2626); --sw-btn-face-content: var(--color-error-content,   #ffffff); }
/* ghost: transparent, page-text colour (fills the accent on hover like every button) */
.btn-ghost { --sw-btn-face: transparent; --sw-btn-face-content: var(--sw-color-base-content, var(--color-base-content, #1a1a23)); }
/* soft: a translucent tint of the face (defaults to primary so a bare btn-soft stays visible) */
.btn-soft { --sw-btn-face: var(--sw-color-primary, var(--color-primary, #4f46e5)); background: color-mix(in oklab, var(--sw-btn-face) 16%, transparent); color: var(--sw-btn-face); }
/* outline: transparent face, the face colour as text + a hairline border (inherits the variant; default primary) */
.btn-outline { --sw-btn-face: var(--sw-color-primary, var(--color-primary, #4f46e5)); background: transparent; color: var(--sw-btn-face); box-shadow: inset 0 0 0 1.5px var(--sw-btn-face); }
/* outline / dash inherit the semantic variant colour */
.btn-outline.btn-secondary, .btn-dash.btn-secondary { --sw-btn-face: var(--sw-color-secondary, var(--color-secondary, #0ea5e9)); }
.btn-outline.btn-accent,    .btn-dash.btn-accent    { --sw-btn-face: var(--sw-color-accent,    var(--color-accent,    #f59e0b)); }
.btn-outline.btn-neutral,   .btn-dash.btn-neutral   { --sw-btn-face: var(--sw-color-neutral,   var(--color-neutral,   #171627)); }
.btn-outline.btn-info,      .btn-dash.btn-info      { --sw-btn-face: var(--color-info,    #0ea5e9); }
.btn-outline.btn-success,   .btn-dash.btn-success   { --sw-btn-face: var(--color-success, #16a34a); }
.btn-outline.btn-warning,   .btn-dash.btn-warning   { --sw-btn-face: var(--color-warning, #f59e0b); }
.btn-outline.btn-error,     .btn-dash.btn-error     { --sw-btn-face: var(--color-error,   #dc2626); }
/* outline keeps its inset border on hover (matches the generic hover's specificity, declared later so
   it wins — else the generic hover box-shadow would drop the border) */
.btn-outline:not(.btn-link):not(.btn-disabled):not(:disabled):hover { box-shadow: inset 0 0 0 1.5px var(--sw-btn-face), 0 10px 24px -11px color-mix(in oklab, var(--sw-btn-fx) 60%, transparent); }
/* dash: an outline with a dashed border */
.btn-dash { --sw-btn-face: var(--sw-color-primary, var(--color-primary, #4f46e5)); background: transparent; color: var(--sw-btn-face); border: 1.5px dashed var(--sw-btn-face); box-shadow: none; }
/* link: a bare text button (no fill / lift / vertical padding) */
.btn-link { background: transparent; color: var(--sw-color-primary, var(--color-primary, #4f46e5)); padding: 0 .25rem; text-decoration: underline; text-underline-offset: 3px; }
/* sizes — only the vertical/horizontal padding + font scale (no fixed height) */
.btn-xs { --sw-btn-py: .4rem;  --sw-btn-px: .6rem;  --sw-btn-fs: .75rem; gap: .3rem; }
.btn-sm { --sw-btn-py: .6rem;  --sw-btn-px: .85rem; --sw-btn-fs: .85rem; }
.btn-md { --sw-btn-py: .8rem;  --sw-btn-px: 1.15rem; --sw-btn-fs: .95rem; }
.btn-lg { --sw-btn-py: 1rem;   --sw-btn-px: 1.6rem; --sw-btn-fs: 1.05rem; }
.btn-xl { --sw-btn-py: 1.2rem; --sw-btn-px: 2rem;   --sw-btn-fs: 1.15rem; }
/* width / icon shapes — square/circle stay 1:1 via aspect-ratio (equal padding, no fixed height) */
.btn-block { width: 100%; }
.btn-wide { width: 100%; max-width: 16rem; }
.btn-square { padding-inline: var(--sw-btn-py); aspect-ratio: 1; }
.btn-circle { padding-inline: var(--sw-btn-py); aspect-ratio: 1; --sw-btn-radius: 999px; }
/* daisyUI's file-input styles ::file-selector-button via the daisy --btn-* vars we no longer define;
   restyle it with our tokens so it still reads as a button. */
.file-input::file-selector-button { background: var(--sw-color-neutral, var(--color-neutral, #171627)); color: var(--sw-color-neutral-content, var(--color-neutral-content, #ffffff)); border: 0; border-inline-end: 1px solid color-mix(in oklab, currentColor 12%, transparent); border-radius: 0; padding-inline: 1rem; margin-inline-end: .75rem; font-weight: 600; cursor: pointer; }
/* the injected ripple span (the runtime appends one per pointerdown; clipped by the .btn overflow). The
   white tint is the intentional light-on-coloured-button ripple — see the dark-readiness allowlist. */
.btn .sw-btn-ripple { position: absolute; border-radius: 50%; background: rgb(255 255 255 / .45); transform: translate(-50%, -50%) scale(0); pointer-events: none; z-index: 1; }
@media (prefers-reduced-motion: no-preference) { .btn .sw-btn-ripple { animation: sw-btn-ripple .6s ease-out forwards; } }
@keyframes sw-btn-ripple { to { transform: translate(-50%, -50%) scale(1); opacity: 0; } }

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
  *::-webkit-scrollbar { width: 8px; height: 8px; background: var(--sw-color-base-100, #ffffff); }
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
