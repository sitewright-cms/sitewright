import { z } from 'zod';
// Agent (MCP) defaults shared across packages: the bridge's fallback instructions, the API's
// effective-instructions resolution, and the admin panel's editor + endpoint list all read from here.
// The CORE agent instructions — always sent in the MCP `instructions` field (kept small). The
// feature-specific how-tos live in {@link AGENT_GUIDES}, fetched on demand via the `get_guide` tool, so
// the up-front prompt stays focused. A generated topic index (below) tells the agent which guides exist.
const AGENT_CORE_INSTRUCTIONS = `
This server exposes ONE project over MCP for building a
CODE-FIRST static website. You'll work with these content kinds (kind, id): settings, page,
dataset, entry, form. Call get_scope first. If it returns authenticated:false, call the \`login\`
tool and relay its URL + code to the user to approve in their browser (ask them to keep that tab
open to watch your changes live), then call get_scope again to confirm before continuing. Use
\`switch_project\` to connect to a different project.

AUTHOR PAGES IN CODE. A page renders from its Handlebars \`source\` (HTML + Tailwind CSS +
DaisyUI v5 component classes) — put the entire design there. A page with no \`source\`/\`template\`
renders an empty body. Before you lay out a page, call \`get_guide("design")\` for the section
patterns, type/spacing rhythm, and colour-depth rules that separate a flagship page from a
skeleton (a real landing page is 6-9 composed sections, not a hero + three cards). The exact
authoring vocabulary — every \`{{sw-*}}\` helper, \`data-sw-*\` directive, binding namespace, and
loop variable — is in the \`get_reference\` tool (don't guess helper names). If a page carries a
\`data.swImport\` marker it was IMPORTED from an external site as a raw scaffold — call
\`get_guide("import")\` and rewrite it into native idioms.

In \`source\`:
- Use DaisyUI components for UI (btn / btn-primary, card, navbar, hero, badge, footer,
  menu, alert…) plus Tailwind utilities for layout. DaisyUI is OPTIONAL — plain Tailwind works too.
- SPACING: the platform ZEROES the default browser margins on block elements (h1–h6, p, ul/ol,
  blockquote, figure, hr, …) for cross-browser consistency, like Tailwind preflight. So bare text
  has NO gaps — set spacing EXPLICITLY with utilities (\`mt-*\`, \`mb-*\`, \`space-y-*\`, \`gap-*\`, \`py-*\`).
  Heading font SIZES and list bullets/numbers are kept. For rich/long-form bodies (an article, a
  legal page) where you can't class each tag, wrap the container in \`class="prose"\` to restore a
  readable rhythm (and \`class="not-prose"\` on any child to opt out).
- COLORS — USE THEME TOKENS, NOT FIXED COLORS (this is what makes light/dark work). The theme exposes
  the standard DaisyUI/Tailwind color roles as utilities: \`primary\`, \`secondary\`, \`accent\`, \`neutral\`,
  \`info\`/\`success\`/\`warning\`/\`error\`, the surfaces \`base-100\` (page bg) / \`base-200\` / \`base-300\`, and
  \`base-content\` (body text) — each with an auto-derived \`*-content\` for legible text on top
  (\`bg-primary text-primary-content\`). Use them as ordinary utilities (\`bg-base-100\`, \`text-base-content\`,
  \`bg-primary\`, \`border-base-300\`); DaisyUI components read the SAME tokens, so they theme automatically.
  AVOID hardcoded hex and fixed Tailwind palette colors for surfaces / text / borders (\`bg-white\`,
  \`bg-slate-900\`, \`text-gray-700\`, \`#fff\`) — they do NOT adapt. (A fixed colour on an always-coloured
  element, e.g. a brand badge or a gradient, is fine.)
- LIGHT / DARK MODE (opt-in — Settings → Website → "Themes (light / dark)"): when ON, the platform
  adds a DARK variant by flipping the \`base-*\` surfaces + \`base-content\` tokens, so ANY UI built from the
  tokens above adapts with zero extra work — which is exactly why token classes beat fixed colours. Add
  \`{{sw-theme-toggle}}\` to the nav to let visitors switch (the chosen default — or each visitor's OS on
  "auto" — applies even without it). For CUSTOM CSS (a \`<style>\` block, Critical CSS, or inline
  \`style="…"\`) read the tokens as CSS VARIABLES: the platform mirrors every theme colour as
  \`--sw-color-<role>\` (e.g. \`var(--sw-color-primary)\`, \`var(--sw-color-base-100)\`,
  \`var(--sw-color-base-content)\`), plus \`--sw-font-<key>\` / \`--sw-space-<key>\` / \`--sw-radius-<key>\` from
  your CI — so custom CSS stays on-brand AND dark-mode-safe. (DaisyUI's own \`--color-<role>\` variables
  resolve to the same values; use either.)
- Bind data: {{ company.* }} exposes the Corporate Identity you set (e.g. {{ company.name }}
  and any contact/address fields on \`identity\`). {{ company.mapUrl }} is a Google Maps embed URL
  for an <iframe src>; {{ company.bookingUrl }} is an external booking/reservation/appointment link
  (e.g. a "Book now" button). {{#each company.social}} yields { link, name, icon } per profile — render a
  social bar with {{#each company.social}}<a href="{{sw-url link}}">{{sw-icon icon}} {{name}}</a>{{/each}}.
  Page bindings: {{ page.title }}, {{ page.path }} (full route),
  {{ page.slug }} (own segment); {{ page.parent.path }} / {{ page.parent.data.<key> }} for the page's
  parent (absent at the tree root); and {{#each page.children}} for its CHILD pages — a section
  index or a blog overview that lists its sub-pages (each child has .title/.slug/.path/.data).
  CROSS-PAGE: read ANOTHER page's data by SLUG path with
  {{ pages.<slug>.<slug>….data.<key> }} — walk the tree from home, e.g. {{ pages.services.seo.data.header_title }}
  (and {{ sw-url pages.services.path }} to link it). Same-locale (German page → German slugs,
  pages.leistungen.seo); each node also has .title/.slug/.path/.locale; an unknown path renders empty.
  {{ website.siteUrl }}; and {{#each dataset.<dataset>}}…{{/each}}
  for collections. Inside the loop an entry's fields are read
  DIRECTLY by name — {{title}}, {{price}} (no \`values.\` prefix) — and each row is click-to-edit
  in the editor. The entry's id/dataset are on {{@entry.id}} / {{@entry.dataset}}. A dataset field
  may itself be a LIST (a repeating group → {{#each <field>}}) or an OBJECT (a nested group →
  {{<field>.<key>}}), so an entry can hold structured/nested data.
- IMAGE GALLERIES / file lists: loop a MEDIA FOLDER with
  {{#sw-folder "folder" [kind="image|file|all"] [recursive=false] [sort="name|name-desc"]}}…{{else}}…{{/sw-folder}}
  (images by default). The folder may be a subfolder ("products/2024") or a variable. Each iteration
  binds {{url}} {{alt}} {{filename}} {{kind}} {{width}} {{height}} (+ {{@index}}/{{@first}}/{{@last}});
  bind the src with {{sw-url url}}. e.g. {{#sw-folder "gallery"}}<img src="{{sw-url url}}" alt="{{alt}}" loading="lazy">{{/sw-folder}}.
- CONTENT-EDITOR-ONLY controls: {{sw-control target="…" as="text|textarea|url|number|color|date|image|file|select|folder|dataset" [options="a,b,c"] label="…"}}
  drops a chip (visible only in the Content Editor, stripped on publish) letting a client set a whitelisted
  page value (target=page.title | page.image | page.description) or a page.data key. \`as\` picks the input:
  text/textarea/url, number/color/date (native typed inputs), image/file (file picker), select (a dropdown
  of your \`options="a,b,c"\` list), folder/dataset (a dropdown of media folders / datasets). An unknown \`as\`
  or a select with no \`options\` is an ERROR (it won't silently become a text box). Use it to expose the
  knobs OTHER helpers read — e.g. {{sw-control target="gallery_folder" as="folder"}} feeds
  {{#sw-folder page.data.gallery_folder}}, and {{sw-control target="list_dataset" as="dataset"}} feeds {{#each}}.
- Mark text a CLIENT may later edit by adding data-sw-text="key" to a real element, e.g.
  <h1 data-sw-text="headline">Default text</h1> (rich text: data-sw-html; image: data-sw-src;
  link: data-sw-href; background: data-sw-bg). The override is stored on the page as page.data.<key>.
- NO JavaScript: no <script>, no on* handlers, no {{{triple-stache}}}. For interactivity use
  DaisyUI's CSS-only patterns (<details>, the popover attribute, checkbox). Put URLs in
  href/src as literal paths or via the {{sw-url …}} helper.
- NO SEMANTIC LANDMARK ELEMENTS: the page SKELETON already wraps every page body in
  <main id="page-content"> and each skeleton slot in its own landmark — <nav id="top-nav">,
  <nav id="mobile-nav">, <footer id="footer">, <aside id="sidebar-left">/<aside id="sidebar-right">.
  So a page \`source\` (and any snippet/template/slot HTML) must NOT use <nav>, <main>, <footer>, or
  <aside> — the validator rejects them to keep each landmark unique. Use neutral <div>/<section>/<ul>
  (DaisyUI's .navbar/.footer/.menu classes style any element).

SET THE BRAND with put_content("settings","settings",{ identity:{ name, colors:{ primary:"#…" } },
settings:{ defaultLocale:"en", locales:["en"] } }).
PAGE SETTINGS live on the page: title, path, status ("draft"|"published"),
description, image (the OG/share image), parent (a parent page's id — makes this a sub-page), nav
{ slots:["header"|"footer"|"mobile"], order, title, dropdown }. \`path\` is the page's OWN
SLUG SEGMENT — one lowercase token, NO slashes (e.g. "about", "web-design"); the full URL
is computed from the parent chain ({root}/{parent slugs}/{slug}). The HOME page is the
page-tree ROOT: its slug is the EMPTY string "" (→ "/"), and every OTHER page sets "parent"
to a page's id (defaulting to "home") — its route is /<…parent slugs>/<slug>. So a German
home is { path:"de", parent:"home" } (→ /de) and a sub-page under it is
{ path:"leistungen", parent:"home-de" } (→ /de/leistungen). With dropdown:true a page's
CHILD pages (parent = its id) nest under its nav item — a nav slot template renders them
via {{#if children}}…{{#each children}}. Prefer a CSS-only hover dropdown whose PARENT stays a
real link: <li class="dropdown dropdown-hover"><a href="{{sw-url path}}">{{sw-label}}</a><ul
class="dropdown-content menu …">{{#each children}}…{{/each}}</ul></li> (avoid <details>/<summary>,
which makes the parent a toggle, not navigable). The platform auto-aligns the submenu under its
trigger and bridges the small gap so hover doesn't drop mid-travel — don't add margin utilities
(\`mt-*\`/\`mx-*\`) to the dropdown-content (set --sw-dropdown-gap on the .dropdown to change the
spacing). Children need no own nav slots. Every new project already has the empty-slug "home" page.

Typical flow: get_scope → set the Corporate Identity → put_page(s) with \`source\` →
preview_page (returns DESKTOP + MOBILE screenshots — LOOK at them and refine the design before moving on;
pass includeHtml:true to also get the HTML source) → publish_project. All writes are validated
server-side (schema + no-JS template safety); you cannot exceed the token's role/capabilities.
DELETING is separate: delete_page / delete_content need the \`content:delete\` capability, which is
often NOT granted (it is opt-in, not implied by \`content:write\`). Check get_scope first — if
\`content:delete\` is absent, don't attempt removals: ask the user to delete the item in the editor,
or to grant the agent \`content:delete\` (e.g. a new API key that includes it). Prefer editing or
replacing over deleting when in doubt.
UNDO: every save is versioned. If an edit went wrong, list_revisions(kind,id) shows the history and
restore_revision(kind,id,revisionId) rolls it back (non-destructive — a deleted entity is recreated).
`;

/**
 * On-demand reference guides for the feature areas that aren't needed for every task. The agent fetches
 * one by name via the `get_guide` tool; their summaries form the topic index appended to the core
 * instructions. Source-of-truth for the guide enum, the index, and the tool — a test asserts coverage.
 */
export const AGENT_GUIDES = {
  design: {
    title: "Design — section patterns & visual craft",
    summary: "what flagship looks like: layout rhythm, type scale, layered surfaces + copy-paste section skeletons (hero, feature rows, stats, testimonials, pricing, FAQ, CTA) — READ before laying out a page",
    body: `
DESIGN — read this BEFORE composing a page's layout. The other guides tell you HOW to wire a feature; this tells you what GOOD looks like. It is what separates a flagship site from a generic skeleton.

THE BAR. Flagship = generous whitespace, a clear type scale, layered surfaces for depth, ONE accent colour used sparingly, real imagery, an alternating section rhythm, one tasteful motion accent per section, and a strong closing CTA. The #1 failure mode is the "hero + 3 cards + stop" skeleton — a real landing page has 6-9 distinct sections with a narrative arc (hook -> proof -> how it works -> depth -> social proof -> objection handling -> call to action).

LAYOUT RHYTHM (use on every section):
- Section shell: <section class="py-20 sm:py-28"><div class="sw-container"> ... </div></section>. Put the platform .sw-container on EVERY section's inner wrapper — it applies the SITE-WIDE content width (the Website "Content width" setting → the --sw-container CSS var, default 1200px) plus centering + a responsive gutter, so every section lines up edge-to-edge AND the owner can retune the whole site from one control. Vary only the vertical py. For a FULL-BLEED band (an edge-to-edge coloured/photo background), put the bg-* on the <section> and keep the .sw-container inside it (the background spans the viewport; the content stays aligned). (.sw-container replaces a hand-rolled mx-auto max-w-* px-* — use it so your pages match imported/nativized pages and respond to the Content width setting.)
- Depth via ALTERNATING surfaces: give consecutive sections bg-base-100 -> bg-base-200 -> bg-base-100 (never all-white/all-one-colour). Use base-300 for card borders on top. This one move reads as "designed".
- Type scale (choose from these, do not freestyle sizes): hero h1 = text-4xl sm:text-5xl xl:text-6xl font-bold tracking-tight; section h2 = text-3xl sm:text-4xl font-semibold tracking-tight; an eyebrow label (one per section, above the h2) = text-sm font-semibold uppercase tracking-wide text-primary; lead paragraph = mt-4 text-lg text-base-content/70 max-w-2xl; long-form body = wrap the container in class="prose".
- In-section spacing: heading->lead mt-4, header->content mt-10 sm:mt-14, grid/list gaps gap-6 sm:gap-8.
- Cards: rounded-2xl border border-base-300 bg-base-100 p-6 sm:p-8 (optional shadow-sm hover:shadow-md transition).

COLOUR & DEPTH (taste). Stay TOKEN-ONLY (base-100/200/300, base-content, primary, primary-content) so light AND dark both work. Reserve primary for CTAs, links, the eyebrow label, and AT MOST one full colour band per page. Secondary text = text-base-content/70. NEVER paint whole content sections in primary. Gradients only on always-coloured elements (a hero accent shape, the CTA band), e.g. bg-gradient-to-br from-primary to-secondary.

THE SECTION TOOLKIT — compose 6-9 of these into a landing page. Skeletons are token-driven and landmark-safe (use <section>/<div>, never <nav>/<main>/<footer>/<aside>); fill in real copy + images.

1) HERO (split — the flagship default):
<section class="py-20 sm:py-28"><div class="sw-container grid lg:grid-cols-2 gap-12 items-center">
  <div data-aos="fade-up">
    <p class="text-sm font-semibold uppercase tracking-wide text-primary">{{ company.name }}</p>
    <h1 class="mt-3 text-4xl sm:text-5xl xl:text-6xl font-bold tracking-tight">Headline that states the value</h1>
    <p class="mt-5 text-lg text-base-content/70">One sentence that earns the next scroll.</p>
    <div class="mt-8 flex flex-wrap gap-3"><a href="#contact" class="btn btn-primary">Primary action</a><a href="#work" class="btn btn-ghost">Secondary</a></div>
  </div>
  <div data-aos="fade-up" data-aos-delay="100" class="aspect-[4/3] rounded-2xl overflow-hidden bg-base-200"><img src="..." alt="..." class="h-full w-full object-cover"></div>
</div></section>

2) PROOF STRIP: a muted row of client logos or 3 trust stats directly under the hero.

3) FEATURE GRID (3-up): eyebrow + h2 + lead, then a grid sm:grid-cols-3 gap-6 of cards; each card leads with {{sw-icon "name" "h-6 w-6"}} in a rounded-xl bg-primary/10 text-primary p-3 tile, then a title + a sentence.

4) ALTERNATING FEATURE ROWS (the workhorse — repeat 2-3x, flipping sides each time): grid lg:grid-cols-2 gap-12 items-center, image on one side (swap with lg:order-last on alternate rows), copy on the other (eyebrow + h3 + paragraph + a checklist of {{sw-icon "check"}} items). This is what makes a page feel substantial rather than thin.

5) STATS BAND: a coloured break — <section> with bg-primary text-primary-content (or bg-base-200), grid grid-cols-2 sm:grid-cols-4, each cell a text-4xl font-bold number + a small label.

6) TESTIMONIALS: one large pull-quote, OR several via data-sw-component="carousel" (call get_guide("components")). Quote + avatar + name/role.

7) PRICING: grid sm:grid-cols-3; highlight the middle card (border-primary ring-1 ring-primary + a "Popular" badge); each has a price, a feature list, and a btn.

8) FAQ: native <details> accordions (no JS), grouped with space-y-3 — each MUST carry the collapse-title + collapse-content children: <details class="collapse collapse-plus border border-base-300 rounded-box"><summary class="collapse-title font-semibold">Question?</summary><div class="collapse-content text-base-content/70">Answer.</div></details>

9) CLOSING CTA BAND (end every landing page with one): a centred section, bg-primary text-primary-content rounded-3xl, h2 + lead + a contrasting button — a solid white button reads best: class="btn border-0 bg-base-100 text-primary hover:bg-base-200".

IMAGERY: use search_stock_images + import_stock_image for REAL photos — empty boxes/placeholder greys read as unfinished. Keep a consistent aspect per group (aspect-[4/3], aspect-video, aspect-square) + object-cover + rounded-2xl; galleries -> data-sw-component="lightbox". Never distort an image.

MOTION (restraint): exactly one data-aos="fade-up" focus per section; stagger a grid's children with increasing data-aos-delay (0/100/200). Animating everything cheapens it.

CHECK BEFORE PUBLISH: 6+ distinct sections? type scale applied (headings are not all the same size)? surfaces alternate? one accent colour, used sparingly? real images, not placeholders? a strong closing CTA? every section's content wrapped in .sw-container (one aligned width throughout)? Call preview_page and LOOK at the desktop + mobile screenshots — fix anything that does not read as flagship-quality before publishing.
`,
  },
  components: {
    title: "Components & forms",
    summary: "interactive widgets (carousel, tabs, lightbox, modal, cookie-consent, datetimepicker, shader-bg) + Forms",
    body: `
INTERACTIVE COMPONENTS: the platform ships audited, first-party runtimes you activate with
data-sw-component="carousel|tabs|lightbox|modal|cookie-consent|datetimepicker" — author semantic HTML with
data-sw-part roles and the runtime wires the behavior (each ships only when used, and degrades
to usable HTML without JS — never add your own script). Call the \`get_components\` tool for the
machine-readable contracts: markers, parts, config attributes, and copy-paste markup skeletons.
Quick rules vs the similar-looking DaisyUI classes:
- Slideshow/slider → data-sw-component="carousel" (Embla-powered): fade (default) or slide
  effect, arrows + dot indicators (Lucide icons via {{sw-icon}}), swipe + keyboard, looping,
  autoplay or continuous auto-scroll, wheel gestures, auto height, and multi-item/peek layouts
  via the --sw-items CSS variable (with data-effect="slide"). DaisyUI's \`carousel\` classes are
  just a CSS scroll-snap strip — fine for a swipeable card row, but they have NO controls (the
  documented #anchor buttons hijack scrolling — avoid them).
- Content TABS → data-sw-component="tabs" (APG tablist; panels stack readable without JS).
  DaisyUI \`tab\` classes are for tab-STYLED NAVIGATION LINKS only; do not build radio-input
  content tabs.
- Image viewer/gallery → data-sw-component="lightbox": a full-screen gallery with a bottom
  thumbnail strip, an enlarge-from-thumbnail open animation, a header image-counter + caption,
  swipe, pinch-zoom, and keyboard nav (viewer DOM is runtime-built — no overlay element). THREE
  forms: (1) one line — a single image: <img data-sw-component="lightbox" src="{{sw-url thumb}}"
  data-full="{{sw-url full}}" data-caption alt> (data-full optional); (2) minimal gallery — a
  <div data-sw-component="lightbox" class="grid grid-cols-4 gap-2"> of bare <img> or
  <a href><img></a> children (you style the container); (3) explicit data-sw-block + data-sw-part
  grid for the batteries-included styled square grid. Every image is an <img> (the open animation
  clones it). Toggle: data-thumbnails/data-arrows/data-animation="false", data-fit="fill", data-tilt
  / data-history="true". data-gallery="name" merges every lightbox sharing that name (across
  sections + forms) into one combined gallery. For no cropping use a masonry
  (class="block columns-2 sm:columns-3" + natural-aspect imgs) or match the tile aspect. No DaisyUI equivalent.
- MODAL → data-sw-component="modal" (native <dialog>: focus trap/Esc/backdrop for free).
  DaisyUI's modal methods need inline JS (rejected) or a checkbox hack (poor a11y) — don't.
- Cookie banner → data-sw-component="cookie-consent", placed ONCE site-wide in the website
  \`bottom\` slot, with the \`hidden\` attribute authored on it.
- DATE / TIME pickers → data-sw-component="datetimepicker" on a TEXT <input> (Vanilla Calendar Pro):
  a CI-themed popup calendar + slider time picker. data-mode="date" (default) | "range" (start–end in
  one field, shown as a DUAL-PANEL two-month view) | "datetime" | "time". Full control via data-*
  (data-months to widen the panel, data-min/-max, data-locale, data-first-day, data-multiple,
  data-time-step, data-time-format 12h/24h, data-position); put the marker on a block element (e.g.
  a <div>) instead of an <input> for an always-open INLINE calendar. It follows the page <html lang>
  for day/month names automatically; give the input a name to submit it. DaisyUI has no date picker
  (it only styles the input box).
- ANIMATED BACKGROUND → data-sw-component="shader-bg" on a section/hero/full-page wrapper: a WebGL
  background themed by the CI colors (30 presets via data-preset; plus data-speed/intensity/angle/
  interactive/colors). Content renders above it; add a data-sw-part="overlay" scrim for legible text.
  Falls back to a CI gradient with no JS. Details + presets: the effects guide and get_components.
- ACCORDIONS are NOT a component: use native <details> with DaisyUI collapse classes, e.g.
  <details class="collapse collapse-plus"><summary class="collapse-title">Q</summary>
  <div class="collapse-content">A</div></details> (group with \`join join-vertical\`).

FORMS (contact/enquiry/etc.): create a \`form\` content entity first (fields, submission mode,
success/error messages), then embed it BY REFERENCE — {{sw-form "<id>" class="…"}} renders the
complete form, or author your own <form data-sw-form="<id>">…custom field markup…</form> and the
platform injects the submission endpoint, honeypot, and captcha at render. NEVER hand-wire an
action/endpoint and never write data-sw-component="form" yourself (it is stamped automatically).
A page in locale "de" auto-resolves "<id>-de" when that form exists. Submissions land in the
project inbox (\`list_submissions\`).
`,
  },
  images: {
    title: "Images & lazy-loading",
    summary: "add images (stock search/import), lazy-load, blur-up, skeletons",
    body: `
LAZY-LOAD (images, backgrounds, iframes): the platform ships its own tiny runtime when it sees
data-src / data-srcset / data-bg (the legacy class="lazyload" still works but is no longer needed)
— never add a lazy-load library. Put the URL in data-* via {{sw-url …}} or as a literal path.
- Plain image — simplest, works without JS: <img src="…" loading="lazy" alt="…" width="…" height="…">
  (the image pipeline adds a blur-up LQIP placeholder).
- Deferred swap with a blur-up fade — put the URL in data-src (+ data-srcset for responsive) INSTEAD
  of src; no class needed. Works on the elements that take a src — <img data-src="…" alt="…" width
  height> and <iframe data-src="…" title="…" width height> both get their real src on scroll-in.
- BACKGROUND image: data-bg="<url>" on any element → set as the background-image on scroll-in.
- IFRAME, no-JS-safe alternative: native <iframe src="…" loading="lazy" title="…" width height>.
- SKELETON while loading (whenever the media has a fixed HEIGHT): wrap it in a DaisyUI .skeleton box
  so an animated shimmer shows until it loads, then the media fades in over it —
  <div class="skeleton h-64 w-full overflow-hidden rounded-box"><img data-src="…" alt="…" width="800"
  height="450" class="h-full w-full object-cover"></div>. (A native loading="lazy" iframe can carry
  class="skeleton" directly, since the runtime doesn't fade it.)

IMAGES — three ways to bring one in, all self-hosted (never hotlink), then reference the returned
media url in \`source\`:
- STOCK: call list_stock_providers to see which are enabled (openverse is always on; unsplash /
  pexels need an instance API key), then search_stock_images on an available one → import_stock_image
  (downloaded, optimized, attributed).
- BY URL: import_image with a public https image URL (downloaded + optimized, follows redirects).
- EXISTING: list_media to find assets already in the project and reuse their url.
`,
  },
  effects: {
    title: "Effects, animations & ripple",
    summary: "nav/button/preloader effect schemes (+ custom code), scroll animations, ripple, WebGL animated backgrounds (shader-bg)",
    body: `
ANIMATIONS (scroll-reveal): use the standard AOS attributes directly on elements —
data-aos="fade-up" plus optional data-aos-delay="200" / data-aos-duration="600" (ms, max 5000),
data-aos-once="false" to replay on every re-entry, data-aos-easing="ease-out"
(linear|ease|ease-in|ease-out|ease-in-out). Effects: fade, fade-up/-down/-left/-right,
zoom-in, zoom-out, slide-up/-down/-left/-right, flip-up/-down/-left/-right. The platform
detects data-aos and ships its own tiny runtime automatically — do NOT add the aos
package, CDN links, or any script (they'd be rejected anyway). Content stays visible
without JS and motion respects prefers-reduced-motion. Stagger lists by increasing
data-aos-delay per item (e.g. 0/100/200).

RIPPLE (Material "waves") click effect: add class="waves-effect" to a button/link, plus
"waves-light" for a white ripple on dark/colored buttons (e.g. class="btn btn-primary
waves-effect waves-light"). The platform ships its own ripple runtime when it sees
waves-effect — never add Waves.js. Respects prefers-reduced-motion.

NAV/BUTTON EFFECTS: curated CI-themed, contrast-safe schemes — add a class for nav active/hover
(\`sw-nav-<name>\` on the nav <ul> or set site-wide in website.effects.navEffect; names:
\`box-solid\`,\`box-fill-left\`,\`box-fill-up\`,\`box-draw\`,\`box-shadow\`,\`line-bottom\`,\`line-sliding-bottom\`,
\`line-top-down\`,\`line-squiggle\`,\`sliding-pill\`,\`glass-pill\`,\`dot-to-pill\`,\`highlighter\`,\`brackets\`,
\`brackets-curly\`,\`blob\`,\`chevron\`,\`corner-ticks\`,\`spotlight-sliding\`) and button hover/press
(\`sw-btn-lift\`|\`-glow\`|\`-sheen\`|\`-press\`|\`-pulse\`|\`-ring\` on any .btn, or website.effects.buttonEffect).
Colors auto-derive from the brand (and stay legible in the built-in dark theme); only \`box-solid\` /
\`box-fill-*\` / \`dot-to-pill\` fill a surface (using the WCAG-derived foreground). The three sliding /
spotlight schemes load a tiny runtime automatically. Prefer these over hand-rolled active/hover CSS.

CUSTOM EFFECT (when no built-in scheme fits): leave the effect 'none' and set
website.effects.navCode / buttonCode / preloaderCode (in the settings entity) — raw HTML (a \`<style>\`
plus an optional \`<script>\`) injected site-wide ONLY while that effect is 'none' (nav/button code at
body-end; a custom preloader becomes the FIRST body child). Target the nav links
(\`:is(#top-nav, #mobile-nav) a\`, \`.menu a\`) or buttons (\`.btn\`) directly, and use the brand custom
properties — \`var(--sw-color-primary)\`, \`var(--sw-color-primary-content)\` (text-on-brand foreground),
\`var(--sw-color-base-100)\` — so it stays on-brand AND legible in the built-in dark theme.

ANIMATED BACKGROUNDS (WebGL): put \`data-sw-component="shader-bg"\` on a section/hero/full-page wrapper to
render a GPU animated background BEHIND its content, themed by the CI colors. Choose a look with
\`data-preset\` (default \`mesh-gradient\`; also e.g. \`silk-flow\`, \`gradient-flow\`, \`plasma\`, \`voronoi-cells\`,
\`mist-layers\` — 30 in all, see get_components). Optional knobs: \`data-speed\` (0–4; \`"0"\` = a single static
frame), \`data-intensity\` (0–1; lower = subtler behind text), \`data-angle\` (degrees), \`data-interactive="true"\`
(the cursor morphs it on hover), and \`data-colors\` to remap the three palette slots (CI token names like
\`accent,primary,base-100\` or literal colors). Give the section a height (min-height/padding); content renders
above it automatically — never author a \`<canvas>\` or add a WebGL/three.js library, the runtime ships when
the marker is seen. For legible text add a \`data-sw-part="overlay"\` scrim (e.g. \`class="bg-black/30"\`) and/or
lower \`data-intensity\`. Falls back to a static CI gradient with no JS, re-themes on a light/dark switch,
respects prefers-reduced-motion, and pauses while offscreen — keep to a few instances per page. Full
contract + every preset: get_components.
`,
  },
  i18n: {
    title: "Multilingual / translations",
    summary: "locale-variant pages, translation groups, share-by-inheritance, localized datasets, the key-first translation catalog",
    body: `
MULTILINGUAL (document-level i18n): each language variant is ITS OWN page, not a field
overlay. First declare the languages in settings: settings:{ defaultLocale:"en",
locales:["en","de"] }. Then for a translated page create a sibling page that:
- sets \`locale\` to its language ("de"); the default-locale page leaves \`locale\` unset.
- shares a \`translationGroup\` (any stable id, e.g. the primary page's id) with all its
  variants — this links them for the <link rel="alternate" hreflang> tags and any
  language switcher, and is what {{#each page.translations}} iterates.
- nests under that locale's HOME so its route is "/<locale>/…": create a locale-home page
  first ({ path:"<locale>", parent:"home" } → /<locale>, the localized home), then parent the
  locale's other pages under it ({ path:"about", parent:"<locale>-home-id" } → /<locale>/about).
  Each locale's nav lists only its own pages.

SHARE STRUCTURE by INHERITANCE: leave a translated variant's \`source\` AND \`template\` UNSET —
it then automatically follows the DEFAULT-LOCALE page's code (edit that one page's layout and
every language updates, no copying). Each variant supplies only its own translated \`data\`
(data-sw-text values) and \`title\`/\`description\`/\`image\`. For a one-off layout difference, give that variant its
own \`source\` (fork) or set its \`template\`; a variant that carries its own code stops following
the main page.

TRANSLATION CATALOG (key-first STRINGS): for short UI strings that aren't page body content —
nav labels, button text, a tagline reused across pages — use the shared catalog rather than
per-page data. It lives at website.translations as { "<key>": { "<locale>": "<text>" } }. Read a
string with {{sw-translate "key" default="…"}} (output is escaped, so safe in text OR an attribute
like alt / aria-label / placeholder); it resolves the page locale, falling back to the default
locale, then to default=. Write cells via put_content("settings", …) under website.translations —
or, to make a string editable IN PLACE in the content editor, put the key on an element with the
data-sw-translate="key" directive. (The catalog is separate from website.data, the global
NON-localized JSON store.)

LOCALIZED DATA: duplicate a dataset per locale as "<name>-<locale>" (lowercased), e.g.
"services" + "services-de". A page with locale "de" auto-resolves {{#each dataset.services}}
to "services-de" when it exists (else it falls back to "services"); address a specific
variant explicitly with {{#each dataset.services-de}}. In source, expose the page's language
as {{page.locale}} and its alternates as {{#each page.translations}} (each has \`locale\`,
\`path\`, \`title\`). The "translation" content kind is legacy — do NOT use it; model
languages as locale-variant pages instead.
`,
  },
  shop: {
    title: "Front-end shop / cart",
    summary: "a localStorage cart over a products dataset + checkout channels",
    body: `
SHOP (a FRONT-END cart for the static site): the catalogue is a dataset (e.g. "products" with
fields name/price/image/description/sku). In a page \`source\` loop it and emit an add-to-cart
button per product, plus ONE cart mount (drop {{sw-cart}} once — e.g. in the footer slot — so it
is site-wide):
  {{#each dataset.products}}<div class="card">…{{sw-add-to-cart sku=sku name=name price=price image=image}}</div>{{/each}}
  {{sw-cart}}
Or set page.template to "global:shop" (a ready-made storefront over the "products" dataset).
{{sw-add-to-cart}} takes sku/name/price (a number)/image/label/class; {{sw-cart}} renders the
floating cart + drawer. website.shop holds only STRUCTURE — the master switch, currency FORMATTING,
and the channels (each with a stable \`key\`); all display TEXT is TRANSLATABLE and lives in the
translation catalog (website.translations):
  shop: { enabled:true, currency:{ position:"before"|"after", decimals:2 },
          channels:[ {kind:"whatsapp", key:"whatsapp", number:"+14155550123",
                       fields:[{key:"name",required:true},{key:"address",type:"textarea"}]},
                     {kind:"mailto", key:"email", email:"orders@acme.com"},
                     {kind:"payment", key:"pay", urlTemplate:"https://paypal.me/acme/{total}"},
                     {kind:"form", key:"order_form", formId:"<an existing Form id>"} ] }
The cart is OFF unless enabled:true. Its wording — the add-to-cart button, drawer title/note/etc.,
currency symbol & code, and each channel/field label — comes from website.translations: the reserved
cart_* keys (cart_add, cart_title, cart_note, cart_currency_symbol, cart_currency_code, …) and each
channel/field's \`shop.<key>\` key (e.g. shop.whatsapp, shop.name). Set those per locale to localize.
The cart builds the order in the browser (localStorage) and hands it to a channel (WhatsApp/mailto/
payment deep link, or a "form" channel that POSTs to that Form's inbox). Prices are NON-AUTHORITATIVE
— an order INQUIRY; the seller confirms price + collects payment. (Runtime ships only on pages that use it.)
A whatsapp/mailto channel may declare \`fields\` (key + type text|textarea|tel|email + optional required):
the cart collects them before opening the link and appends them as "Label: value" lines below the order
(each label from shop.<field-key>). An email order's body also starts with the localized cart_order_lead
prefixed by the Corporate-Identity name ("Hi <name> — …").
`,
  },
  templates: {
    title: "Templates, snippets & reuse",
    summary: "render a page from a template; reusable {{> snippets}} & widgets; ready-made global partials",
    body: `
TEMPLATES: set page.template to "global:landing", "global:text", or a project template id
(kind "template": { id, name, source }) — the page then renders the TEMPLATE's source and
contributes ONLY its editable \`data\` (page.data) overrides; leave page.source unset. Use it when
MANY pages share one layout (e.g. a blog-post template; the pages supply only their content via
page.data).

SNIPPETS — reusable source fragments INCLUDED with the Handlebars partial syntax {{> name}}.
Create one with put_content("snippet", "<name>", { id:"<name>", name:"<name>", source:"<…>" }),
then drop {{> <name>}} in any page / template / other snippet. Factor out anything repeated (a CTA
band, a card, a contact block) so you edit it in ONE place. The include runs in the CURRENT
context, so {{> card}} inside {{#each dataset.x}} sees the item. (\`name\` must be a bare partial
name — letters/digits/-/_ only.)

READY-MADE GLOBAL SNIPPETS — include these as starting points without creating anything, then
restyle: {{> navbar}}, {{> hero}}, {{> features}}, {{> cta}}, {{> pricing}}, {{> footer}}.

WIDGETS — a snippet packaged with auto-provisioning. The built-in {{> hero-slider}} renders a
full-bleed background SLIDESHOW (Ken-Burns drift + rising captions, the standard frontpage hero);
its slides are EDITED AS DATA (a "hero" dataset it sets up), no code. Just include it.
`,
  },
  icons: {
    title: "Icons & flags",
    summary: "{{sw-icon}} (Lucide + brand:) and {{sw-flag}} country flags",
    body: `
ICONS: inline an icon with {{sw-icon "name" "h-5 w-5"}} (the 2nd arg is the CSS class). "name"
is ANY Lucide icon name (the full ~1865-icon set, kebab-case — e.g. menu, x, search,
arrow-right, chevron-down, mail, phone, map-pin, calendar, star, home, user, heart,
shopping-cart, rocket, sparkles). Brand/social logos use the "brand:" prefix — there are ~270
of them (simple-icons): {{sw-icon "brand:github"}}, brand:x, brand:youtube, brand:instagram,
brand:facebook, brand:whatsapp, brand:tiktok, brand:linkedin (falls back to a line glyph),
brand:figma, brand:spotify, brand:discord, brand:telegram, brand:bluesky, etc. Unknown names
render nothing. (Note: bare "x" is the ✕ close glyph; "brand:x" is the X/Twitter logo.)

FLAGS: country flags are FULL-COLOR, so they use a SEPARATE helper — {{sw-flag "de" "h-4"}}.
The code is ISO 3166-1 alpha-2 (de, us, gb, fr, jp, br…); add "-circle" for the round variant
({{sw-flag "de-circle"}}). All ~250 countries are built in. Flags are a poor proxy for
LANGUAGES (Spanish ≠ Spain) — use them for country/region selectors; for a language switcher
prefer text language names, or pass an explicit country code per locale.
`,
  },
  nav: {
    title: "Nav placeholders & active item",
    summary: "link-only menu items (incl. #dialog) + marking the active item",
    body: `
NAV PLACEHOLDERS: a page with kind:"link" is a menu item with NO page of its own (no route/HTML) —
set link.target ("/path", "https://…"/"mailto:"/"tel:", "#section", or "#dialog-id" to open a
<dialog> placed in the website.bottom slot) + optional link.newTab, and nav.slots/nav.dropdown as
usual; its title is the menu name (may include {{sw-icon}}/basic HTML). Output a nav label with
{{sw-label}} (renders that rich name; a plain page title is escaped) and honor {{#if newTab}} +
.external on each item.

ACTIVE NAV ITEM: mark the current page in a menu with the {{sw-active <route>}} helper (a boolean,
no JS; route must be root-relative). By default it matches the active TRAIL (a parent route stays
active on its child pages — except a home route, "/" or a locale home like "/es", which matches only
itself); pass exact=true for the current page only. Inside {{#each nav.header}}
the item route is \`path\`: <a href="{{sw-url path}}" class="{{#if (sw-active path)}}active{{/if}}"
{{#if (sw-active path exact=true)}}aria-current="page"{{/if}}>{{sw-label}}</a> (the .active class is what
the nav EFFECT styles; omit aria-current off the current page). Output the label with {{sw-label}}
(renders a placeholder's rich name; a page title is escaped).
`,
  },
  import: {
    title: "Nativize an imported website — a faithful port to native primitives",
    summary: "re-express a faithfully-imported page (literal HTML, marked data.swImport + draft) in native primitives (theme tokens, components, datasets, bindings) WITHOUT changing its layout — then clean up the foreign CSS/JS",
    body: `
IMPORTED PAGES. When an external site is imported (the OWNER does this in the editor — you don't trigger
it), each page lands as a FAITHFUL replica: literal HTML in \`source\` (no Handlebars), the foreign CSS
folded into the website criticalCss/head slots, the shared header/footer hoisted into the topNav/mobileNav/
footer slots, and images self-hosted. Each page is MARKED \`page.data.swImport = { sourceUrl, rewritten:false }\`
and \`status:"draft"\`.

NATIVIZE = A FAITHFUL PORT, NOT A REDESIGN. Your job is to REPLICATE the existing layout and look using
native primitives — keep the SAME sections, structure, order, and visual design; swap only the
IMPLEMENTATION. Do NOT apply get_guide("design") here — that flagship section toolkit is for NET-NEW pages.
An imported page is "done" when it renders the SAME as the original but is now token-driven, on-brand,
editable, and free of the foreign framework's CSS/JS. Compare your result against the source site, not a
design ideal.

FIND THEM: list_pages, then get_page — an imported page has \`data.swImport\` with rewritten:false.

PORT CHECKLIST (per page — preserve the layout at every step):
1. STRUCTURE: keep the page's existing sections/grid/spacing. Translate the foreign framework's classes
   (e.g. d-flex, row/col, custom utility names) and the folded-in CSS rules into the EQUIVALENT Tailwind/
   DaisyUI utilities — same layout, native classes. Don't invent new sections or drop existing ones. Port
   the foreign content container (a .container / centered max-width wrapper) to the platform .sw-container so
   every section aligns to the site-wide Content width (the --sw-container var); keep full-bleed backgrounds
   on the <section> with the .sw-container inside. Sections are full-width (w-full), not pinned pixel widths.
2. COLORS: replace the foreign palette (fixed hexes, --primary-color vars, named colour classes) with the
   MATCHING theme tokens (primary, secondary, base-100/200/300, base-content) so light AND dark work; set
   the brand from the imported identity (see "SET THE BRAND" in the core instructions) to the source's colours.
3. BINDINGS: swap hardcoded company name/contact/social for {{ company.* }} (use get_reference for exact names).
4. REPEATED MARKUP -> DATA: turn repeated blocks (cards, team, posts, logos) into a dataset + {{#each}}
   (get_guide("components") / the reference) instead of copy-pasted HTML — same rendered output, less markup.
5. INTERACTIVITY: rebuild sliders/carousels/lightboxes/tabs/accordions/modals with the matching platform
   COMPONENT (get_guide("components")) so they keep working — the import stripped their JS.
6. EDIT AFFORDANCES: add data-sw-* directives + {{sw-control}} where the client should edit content.
7. IMAGES: keep the self-hosted images the import found (same src); fill gaps with import_image (from a URL)
   or search_stock_images (SVGs and oversize images may have been dropped).

CHROME (do this too — it isn't done until the slots are ported). The header / mobileNav / footer slots
(in the settings entity, website.topNav/.mobileNav/.footer) still hold literal foreign HTML. Port them the
same way — same layout, native classes + tokens + {{company.*}} — editing the settings entity.

CLEAN UP THE FOREIGN FILES (do this LAST, once the pages + chrome are ported). The folded-in foreign CSS
(website criticalCss / head) and any leftover dropped/self-hosted JS are now dead weight — REMOVE what is
no longer referenced (trim the criticalCss/head to nothing once every section is token-driven; delete unused
self-hosted .js/.css media). Re-render and confirm nothing regressed.

SAFETY: <script> tags were REMOVED and <form>s converted to inert <div>s on import. Do NOT re-add raw
JavaScript — rebuild interactivity with platform components (step 5) and real Forms (create a form entity,
embed with {{sw-form}}).

WHEN A PAGE IS DONE: set page.data.swImport.rewritten:true (or remove the marker) and flip its
status to "published".
`,
  },
} as const;
export type GuideTopic = keyof typeof AGENT_GUIDES;
export const GUIDE_TOPICS = Object.keys(AGENT_GUIDES) as GuideTopic[];

/** The topic index appended to the core instructions, COMPUTED from {@link AGENT_GUIDES} so a guide's
 *  summary and its index line can never drift apart. */
const GUIDE_INDEX = `\nGUIDES — these feature areas have a detailed how-to. Call the \`get_guide\` tool with a topic name (below) ONLY when the task needs it, to keep this prompt focused:\n${GUIDE_TOPICS.map((t) => `- ${t} — ${AGENT_GUIDES[t].summary}`).join('\n')}`;

/** The default MCP `instructions` payload: the core + the generated guide index. */
export const DEFAULT_AGENT_INSTRUCTIONS = `${AGENT_CORE_INSTRUCTIONS.trim()}\n${GUIDE_INDEX}`;

/** Max length of an admin-overridden agent-instructions string. */
export const AGENT_INSTRUCTIONS_MAX = 32_000;

/**
 * Bounded agent-instructions override string (the admin-editable system prompt). `.min(1)` so a
 * stored override is never empty — clearing the override is done with `null` (revert to default),
 * not an empty string, which would otherwise serve agents a blank prompt.
 */
export const AgentInstructionsSchema = z.string().min(1).max(AGENT_INSTRUCTIONS_MAX);

/** Capability a tool requires (absent = always available, even for a read-only token). */
export type McpToolCapability = 'content:read' | 'content:write' | 'content:delete' | 'publish';

/** Display metadata for one MCP tool the bridge exposes. */
export interface McpToolMeta {
  name: string;
  description: string;
  capability?: McpToolCapability;
}

/**
 * The catalog of MCP tools the bridge registers, capability-gated. This is the source of truth for
 * the admin panel's endpoint list; packages/mcp registers EXACTLY these names (asserted by a test
 * in that package, so the list can't drift from what the server actually exposes).
 */
export const MCP_TOOL_CATALOG: readonly McpToolMeta[] = [
  { name: 'get_scope', description: "Show whether the agent is connected and, if so, the project, role, and capabilities." },
  { name: 'login', description: "Connect the agent to a project — returns a URL + code for the user to approve in their browser." },
  { name: 'switch_project', description: "Re-authenticate to connect to a DIFFERENT project (scope is fixed per connection)." },
  { name: 'get_components', description: "The machine-readable authoring contracts of the first-party interactive components (markers, parts, attributes, markup skeletons)." },
  { name: 'get_reference', description: "The authoring reference for writing a page source: the {{sw-*}} helpers, the data-sw-* directives, the binding namespaces, and the loop variables (derived from the engine, can't drift)." },
  { name: 'get_guide', description: `Fetch the full how-to for one feature area on demand (${GUIDE_TOPICS.join(', ')}) — the core instructions list the topics.` },
  { name: 'list_pages', description: "List the project's pages." },
  { name: 'get_page', description: "Get one page by id (code-first design is in the `source` field)." },
  { name: 'list_content', description: "List all entities of a content kind." },
  { name: 'get_content', description: "Get one content entity by kind + id." },
  { name: 'preview_page', description: "Render a (possibly unsaved) page and return desktop + mobile SCREENSHOTS (+ HTML on request), without saving — so you can SEE your work." },
  { name: 'get_publish_status', description: "Read the project's latest published release (or null)." },
  { name: 'list_submissions', description: "List form submissions (newest first; optional formId + pagination).", capability: 'content:read' },
  { name: 'list_stock_providers', description: "List configured stock-image providers and whether each is available.", capability: 'content:read' },
  { name: 'search_stock_images', description: "Search a stock-image provider for photos.", capability: 'content:read' },
  { name: 'list_media', description: "List the project's self-hosted media assets (URLs to reference, kind, dimensions, alt).", capability: 'content:read' },
  { name: 'put_page', description: "Create or replace a page (id taken from page.id).", capability: 'content:write' },
  { name: 'delete_page', description: "Delete a page by id.", capability: 'content:delete' },
  { name: 'put_content', description: "Create or replace a content entity of the given kind.", capability: 'content:write' },
  { name: 'delete_content', description: "Delete a content entity by kind + id.", capability: 'content:delete' },
  { name: 'list_revisions', description: "List a content entity's revision history (newest first: id, op, who, when).", capability: 'content:read' },
  { name: 'restore_revision', description: "Restore a content entity to an earlier revision (non-destructive; recreates a deleted entity).", capability: 'content:write' },
  { name: 'import_stock_image', description: "Import a stock photo into the project (downloaded, optimized, self-hosted with attribution).", capability: 'content:write' },
  { name: 'import_image', description: "Import an image into the project from a public https URL (downloaded, optimized, self-hosted).", capability: 'content:write' },
  { name: 'publish_project', description: "Build the project's static site from current saved content.", capability: 'publish' },
];
