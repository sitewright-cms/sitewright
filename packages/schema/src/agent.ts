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
- CONDITIONALS / COMPARISON: {{#if x}}/{{#unless x}} are built in; for value comparison use {{#if (eq a b)}}
  / {{#if (ne a b)}} (=== / !==). Handlebars has NO other built-in comparison, and calling a helper that
  is NOT registered HARD-FAILS the whole render (HTTP 400) — so DON'T invent gt/lt/and/or/contains; stick
  to eq/ne (+ the {{sw-*}} helpers in get_reference). For "is this the current page?" use {{#if (sw-active
  path)}} (route-aware), not eq.
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
  <main id="page-content"> and each skeleton slot in its own landmark — <nav id="main-nav">,
  <footer id="footer">, <aside id="sidebar-left">/<aside id="sidebar-right">.
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
    summary: "interactive widgets (carousel, tabs, lightbox, modal, banner, datetimepicker, shader-bg) + Forms",
    body: `
INTERACTIVE COMPONENTS: the platform ships audited, first-party runtimes you activate with
data-sw-component="carousel|tabs|lightbox|modal|banner|datetimepicker" — author semantic HTML with
data-sw-part roles and the runtime wires the behavior (each ships only when used, and degrades
to usable HTML without JS — never add your own script). Call the \`get_components\` tool for the
machine-readable contracts: markers, parts, config attributes, and copy-paste markup skeletons.
Quick rules vs the similar-looking DaisyUI classes:
- Slideshow/slider → data-sw-component="carousel" (Embla-powered): fade (default) or slide
  effect, arrows + dot indicators (Lucide icons via {{sw-icon}}), swipe + keyboard, looping,
  autoplay or continuous auto-scroll, wheel gestures, auto height, and multi-item/peek layouts
  via the --sw-items CSS variable (with data-effect="slide"). DaisyUI's \`carousel\` classes are
  just a CSS scroll-snap strip — fine for a swipeable card row, but they have NO controls (the
  documented #anchor buttons hijack scrolling — avoid them). Worked variants to copy: the slider-*
  reference snippets (get_content "snippet") — slider-fullscreen / slider-cards / slider-multi /
  slider-logowall / slider-dataset; get_components("Carousel") carries short examples of each.
- Content TABS → data-sw-component="tabs" (APG tablist; panels stack readable without JS).
  DaisyUI \`tab\` classes are for tab-STYLED NAVIGATION LINKS only; do not build radio-input
  content tabs. Recipes to copy: tabs-mixed (rich + plain labels) / tabs-dataset (one tab per entry).
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
  Recipes to copy: gallery-grid (styled folder grid) / gallery-masonry (no-crop) / gallery-dataset.
- MODAL → data-sw-component="modal" (native <dialog>: focus trap/Esc/backdrop for free).
  DaisyUI's modal methods need inline JS (rejected) or a checkbox hack (poor a11y) — don't.
  Recipes to copy: modal-basic (link trigger + editable body) / modal-confirm (forced-choice).
- Cookie / consent banner → DON'T author one. Enable the Consent Manager (website.consent.enabled)
  and the banner AUTO-INJECTS on every page (it also gates third-party scripts/iframes + derives CSP).
  See the consent guide.
- Banner / announcement / promo → data-sw-component="banner" (a free-content dismissible banner —
  NOT the consent banner): YOU author the body + action buttons; the runtime reveals it and remembers
  the dismissal. data-sw-part="dismiss" (frequency-bound) / "dismiss-forever" ("don't show again") /
  "remind" (snooze data-remind-days). data-frequency="once|session|days:N|always", data-position
  (bottom/top/corners/center/inline), data-delay (ms or "scroll"); give each a UNIQUE
  data-sw-banner-id. Place ONCE per banner (a chrome slot OR a single page body). ENTRANCE: a fade+rise
  by default, or add data-aos="fade-up|zoom-in|flip-left|…" (+ data-aos-delay/-duration/-easing) — the
  dismiss reverses it. RICH BACKGROUND (photo / gradient / nested data-sw-component="shader-bg"): an
  inline banner is position:static, so put the absolute media + scrim in an INNER relative wrapper (else
  they escape the box), give the root overflow-hidden + a light text colour. Recipes to copy:
  banner-bar / banner-card / banner-modal.
- DATE / TIME pickers → data-sw-component="datetimepicker" on a TEXT <input> (Vanilla Calendar Pro):
  a CI-themed popup calendar + slider time picker. data-mode="date" (default) | "range" (start–end in
  one field, shown as a DUAL-PANEL two-month view) | "datetime" | "time". Full control via data-*
  (data-months to widen the panel, data-min/-max, data-locale, data-first-day, data-multiple,
  data-time-step, data-time-format 12h/24h, data-position); put the marker on a block element (e.g.
  a <div>) instead of an <input> for an always-open INLINE calendar. It follows the page <html lang>
  for day/month names automatically; give the input a name to submit it. DaisyUI has no date picker
  (it only styles the input box). Recipe to copy: datetimepicker-field.
- ANIMATED BACKGROUND → data-sw-component="shader-bg" on a section/hero/full-page wrapper: a WebGL
  background themed by the CI colors (30 presets via data-preset; plus data-speed/intensity/angle/
  interactive/colors). Content renders above it; add a data-sw-part="overlay" scrim for legible text.
  Falls back to a CI gradient with no JS. Details + presets: the effects guide and get_components.
  Recipe to copy: shader-hero.
- ACCORDIONS are NOT a component: use native <details> with DaisyUI collapse classes, e.g.
  <details class="collapse collapse-plus"><summary class="collapse-title">Q</summary>
  <div class="collapse-content">A</div></details> (group with \`join join-vertical\`).

FORMS (contact/enquiry/etc.): create a \`form\` content entity first (fields, submission mode,
success/error messages), then embed it BY REFERENCE — {{sw-form "<id>" class="…"}} renders the
complete form, or author your own <form data-sw-form="<id>">…custom field markup…</form> and the
platform injects the submission endpoint, honeypot, and captcha at render. NEVER hand-wire an
action/endpoint and never write data-sw-component="form" yourself (it is stamped automatically).
A page in locale "de" auto-resolves "<id>-de" when that form exists. Submissions land in the
project inbox (\`list_submissions\`). Recipes to copy: form-embed ({{sw-form}}) / form-custom (your
own fields) / datetimepicker-field.
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

ORGANIZE — keep the media library tidy with virtual folders (grouping labels only; the asset url
never changes when you move it). list_media_folders to see what exists; create_media_folder to make
one; move_media to file an asset (folder) and/or set its display name (filename); rename_media_folder
to rename/move a whole folder. Organize PER PAGE, and only make a folder when the grouping earns it:
a picture gallery → its own folder (e.g. "About/Gallery"); one-off hero images → a shared "Header
Images"; loose singletons like the logo/icon → "Main".
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

PARALLAX (scroll-linked): drive move/scale/fade/blur off scroll with data-sw-parallax-* attributes on
any element (the platform ships a tiny runtime automatically — no library/script). Channels, all
optional + composable, each a from,to pair: data-sw-parallax-translate="40,-40" = MOVE in px (axis via
data-sw-parallax-axis="y|x"); data-sw-parallax-opacity="0,1", data-sw-parallax-scale="0.9,1.05",
data-sw-parallax-blur="8,0". ANCHORING: each effect interpolates across a WINDOW of the element's pass
through the viewport — c=0 entering (bottom), 0.5 centred, 1 leaving (top). Default window is the whole
pass-through (peaks as it leaves the top); add data-sw-parallax-<effect>-range="0,0.5" to finish while
centred (or data-sw-parallax-range on the element as a default). A shorter window leaves room for an OUT
phase: data-sw-parallax-<effect>-out="1,0" (+ optional -out-range) → in → hold → out (e.g. fade in to
centre then back out). DEPTH SCENE (replaces the old -bg): <section data-sw-parallax-scene><div
data-sw-parallax-layer data-sw-parallax-translate="70,-70" style="inset:-14% 0" data-sw-bg="page.data.bg">
</div><div data-sw-parallax-layer data-sw-parallax-translate="0,-30">…content…</div></section> — the scene
clips; each layer is absolutely-positioned and moves independently (oversize a translating cover layer via
inline inset so no edge shows). RESTRAINT: at most one parallax accent per section, keep moves modest; it
inherits prefers-reduced-motion (no motion = static, in-flow — never breaks layout). Blur is heavier — use
sparingly. Recipe to copy: parallax-hero. Compose one in the editor's Parallax builder (Library).

RIPPLE (Material "waves") click effect: add class="waves-effect" to a button/link, plus
"waves-light" for a white ripple on dark/colored buttons (e.g. class="btn btn-primary
waves-effect waves-light"). The platform ships its own ripple runtime when it sees
waves-effect — never add Waves.js. Respects prefers-reduced-motion.

NAV/BUTTON EFFECTS: curated CI-themed, contrast-safe schemes — add a class for nav active/hover
(\`sw-nav-<name>\` on the nav <ul> or set site-wide in website.effects.navEffect; names:
\`box-solid\`,\`box-fill-left\`,\`box-fill-up\`,\`box-draw\`,\`box-shadow\`,\`line-bottom\`,\`line-sliding-bottom\`,
\`line-top-down\`,\`line-squiggle\`,\`sliding-pill\`,\`glass-pill\`,\`dot-to-pill\`,\`highlighter\`,\`brackets\`,
\`brackets-curly\`,\`blob\`,\`chevron\`,\`corner-ticks\`,\`spotlight-sliding\`). Nav colors auto-derive from
the brand and stay legible in dark; only \`box-solid\`/\`box-fill-*\`/\`dot-to-pill\` fill a surface. A
\`sw-nav-*\` class on a SPECIFIC \`.menu\` OVERRIDES the site-wide website.effects.navEffect for that menu
(they don't collide) — so a custom menu (e.g. a scrollspy table of contents) can run its OWN effect while
the rest of the site keeps the site-wide one.

BUTTONS: every \`.btn\` already has a BASELINE — a ripple on click, a small hover lift + shadow, and its
background fills to the hover ACCENT (default secondary). Layer three independent axes as classes (each
works on a single .btn OR site-wide via website.effects):
 • EFFECT — \`sw-btn-fx-<name>\`: \`lift\`,\`glow\`,\`pulse\`,\`ring\`,\`magnetic\`,\`arrow\`,\`bounce\`,\`jelly\`,
   \`icon-spin\`,\`long-shadow\`,\`frost\`,\`width-expand\`,\`sheen\`,\`spotlight\`,\`shine\`,\`sparkle\`,
   \`fill-center\`,\`fill-slide\`,\`border-draw\`,\`outline-fill\`,\`fill-up\`,\`fill-down\`,\`skew-sweep\`,\`bubble\`,
   \`text-link\`,\`gradient-move\`,\`two-tone\`,\`ghost-gradient\` (or website.effects.buttonEffect for the site default).
 • ACCENT — \`sw-btn-accent-<primary|secondary|accent|neutral>\` overrides the hover/fill colour (or website.effects.buttonAccent).
 • SHAPE — \`sw-btn-shape-<rounded|soft|sharp|pill|cut|skewed|square|circle>\` (square/circle = icon-only) (or website.effects.buttonShape).
FACE = the daisyUI variant (\`btn-primary\`/\`btn-ghost\`=transparent/\`btn-outline\`/\`btn-soft\`). A class on
a button OVERRIDES the site default for that axis. \`magnetic\`/\`spotlight\` (+ the ripple) load a tiny
runtime automatically. Prefer these over hand-rolled hover CSS.

STICKY (fixed) HEADER: set website.effects.stickyHeader to fix the top nav (\`#main-nav\`) to the viewport
so it stays visible while scrolling — \`pinned\` (always visible, pure CSS), \`hide-on-scroll\` (slides away
on scroll-down, back on scroll-up), or \`shrink\` (condenses past a threshold). 'none' (default) = a normal
static header. THE OFFSET IS OPT-IN: a fixed header is out of flow, so add class \`sw-top-padding\` to the
first section of a page so its content clears the bar (without it, content sits UNDER the header) — UNLESS
that section already has enough top padding to clear the ~75px bar (e.g. \`pt-24\`/\`py-24\` = 96px), in which
case you need nothing. For a full-bleed hero/slider that should bleed UNDER the header, leave the section
flush and instead put \`sw-top-padding\` on an INNER element (so the background bleeds while the text clears
the header). \`sw-top-padding\` reads the \`--sw-header-h\` token (the platform sets it 4.5rem mobile / 4.75rem
desktop = the default header height; a custom header of a non-standard height overrides it with
\`:root{--sw-header-h:5rem}\` in website.criticalCss). The header sits at z-index 30 (below the mobile drawer
+ back-to-top/consent floats). State hooks for your own scroll CSS: \`html.sw-scrolled\` (set once scrolled,
shrink + hide modes) and \`html.sw-nav-hidden\` (hide-on-scroll only — header translated off-screen).

STICKY HEADER ENTRANCE animation (the platform keeps entrance AUTHOR-CONTROLLED — write it in
website.criticalCss). Simplest (no preloader): \`@media(prefers-reduced-motion:no-preference){@keyframes
sw-hdr-in{from{translate:0 -110%;opacity:0}to{translate:0 0;opacity:1}}#main-nav{animation:sw-hdr-in .6s
cubic-bezier(.16,1,.3,1) both}}\`. With a PRELOADER enabled, COORDINATE it so the bar slides in AFTER the
overlay clears (otherwise it animates hidden behind it): the preloader toggles class \`loading\` on the
overlay \`[data-sw-preloader]\` (a sibling of #main-nav that STAYS in the DOM), so add
\`[data-sw-preloader].loading ~ #main-nav{visibility:hidden}\` and
\`[data-sw-preloader]:not(.loading) ~ #main-nav{animation:sw-hdr-in .6s cubic-bezier(.16,1,.3,1) both}\`. Use
\`animation\` (NOT \`transition\`) so the entrance doesn't clobber the shrink mode's own \`#main-nav{transition}\`.
GOTCHA: a transform/translate on #main-nav (an entrance like the above) makes it the CONTAINING BLOCK for
its \`position:fixed\` children — the default mobile-drawer recipe pins itself with \`h-dvh\` so it's unaffected,
but a CUSTOM full-height nav drawer/overlay MUST set its own viewport height (\`h-dvh\`) or it gets clamped to
the header's height.

SCROLLSPY (highlight the section in view): on a one-page / landing layout, highlight the nav link whose
in-page section is currently scrolled into view. It toggles the SAME active state the nav uses (\`.active\`
+ \`aria-current="true"\`), so pair it with a nav effect (or any \`.active\` styling) to actually SEE the
highlight. Two ways to turn it on: (1) site-wide — set website.effects.scrollSpy: true → it governs the
main + mobile nav (\`#main-nav\`); (2) per element — add the \`data-sw-scrollspy\` attribute to ANY nav
container (e.g. a custom on-page table-of-contents \`<ul class="menu" data-sw-scrollspy>\`). Links point at
sections by id: \`<a href="#about">\` → \`<section id="about">\`. PATH-PREFIXED anchors work too
(\`<a href="/#about">\`, \`<a href="/en/#about">\`) — they spy only on the page that actually has \`#about\`
(so a global header can link to home sections from any page). RULES: a link is a target only if its
section EXISTS on the current page (anchors only — plain route links are ignored). A nav that HAS in-page
sections takes over its own active state (it clears \`.active\` from every link, including route links, then
lights the in-view one); a nav with NO in-page sections is left alone (normal route highlighting). Above
the first section a hashless self-link (a "Home" item) lights; at the page bottom the last section's link
lights. The trigger line auto-offsets by the sticky header (\`--sw-header-h\`). No-JS: the links still work,
they just carry no auto-highlight. Reduced motion: scrollspy STILL highlights — it toggles classes, not
animation; the indicator's own transition is separately gated by the nav effect's prefers-reduced-motion
CSS. Smooth-scroll on click is already handled — scrollspy only manages the highlight.

CUSTOM EFFECT (when no built-in scheme fits): leave the effect 'none' and set
website.effects.navCode / buttonCode / preloaderCode (in the settings entity) — raw HTML (a \`<style>\`
plus an optional \`<script>\`) injected site-wide ONLY while that effect is 'none' (nav/button code at
body-end; a custom preloader becomes the FIRST body child). Target the nav links
(\`.menu a\` — the built-in schemes only style links inside a \`.menu\`) or buttons (\`.btn\`) directly, and use the brand custom
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

LOCALIZED DATA: duplicate a dataset per locale as "<name>_<locale>" (lowercased, UNDERSCORE — a dataset
slug is a Handlebars path so it can't contain hyphens), e.g. "services" + "services_de". A page with
locale "de" auto-resolves {{#each dataset.services}} to "services_de" when it exists (else it falls back
to "services"); address a specific variant explicitly with {{#each dataset.services_de}}. In source, expose the page's language
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
floating cart + drawer. Recipe to copy: shop-product (card + add-to-cart + cart mount).
website.shop holds only STRUCTURE — the master switch, currency FORMATTING,
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
  consent: {
    title: "Cookie consent & third-party gating",
    summary: "a cookie banner that loads analytics/chatbots/embeds ONLY after consent (+ derives the CSP)",
    body: `
CONSENT MANAGER — a front-end cookie banner that ACTUALLY gates third-party code by category. It helps a site
meet GDPR (Art. 6/7 — a lawful basis + freely-given, informed consent) and the ePrivacy "Cookie Law" (Art.
5(3) — PRIOR consent before any cookie/tracker is set): third-party embeds (YouTube/Maps) + scripts (GA/chat)
are BLOCKED until the visitor consents by category, withdrawal is one click, and nothing third-party loads
before consent. (It's a tool to help comply — a privacy policy + a lawful basis are still on you.) Just turn it
on with website.consent.enabled — the banner is AUTO-INJECTED on every page (there is NO {{sw-consent}}
placeholder; don't add one). It shows a banner (Accept all / Reject all / Customize) + a per-category
preferences panel: Strictly necessary (always on), Functional, Analytics, Marketing. The choice is remembered
(versioned localStorage). Add a footer "Cookie settings" re-open link with {{sw-consent-settings}} (or a plain
<a href="#sw-consent">).
ALL banner COPY is TRANSLATABLE — it lives in website.translations under the reserved consent_* keys
(consent_title, consent_intro, consent_accept_all, consent_reject_all, consent_customize, consent_save,
consent_necessary[_desc], consent_functional[_desc], consent_analytics[_desc], consent_marketing[_desc],
consent_settings, consent_privacy, consent_allow_once, consent_always_allow, consent_embed_note).
website.consent holds only STRUCTURE:
  consent: { enabled:true, version:1, layout:"bar"|"box", denyButton:true, privacyHref:"/privacy",
             categories:["functional","analytics","marketing"], defaultEmbedCategory:"functional",
             integrations:[ {id:"ga", name:"Google Analytics", category:"analytics", preset:"ga4",
                              measurementId:"G-XXXXXXX"},
                            {id:"chat", name:"Support chat", category:"functional", preset:"custom",
                              src:"https://widget.example.com/c.js", frameOrigins:["*.example.com"]} ] }
INTEGRATIONS = the third-party scripts to gate. Each loads ONLY after its category is consented. Presets:
ga4 / gtm (need a measurementId G-…/GTM-…) or custom (an https src; add extra script/connect CSP hosts in
\`origins\`, and — if the SDK injects its OWN widget iframe like a chat bubble — its frame-src hosts in
\`frameOrigins\`). On publish the per-site Content-Security-Policy is WIDENED automatically to EXACTLY these
origins — no manual allow-listing. Bump \`version\` to re-ask everyone after adding a tracker.
EMBEDS / IFRAMES: there is NO embed helper — just paste the provider's normal <iframe …> (YouTube, Vimeo,
Maps, Calendly, …). With the manager enabled, ANY cross-origin iframe is automatically HELD behind an
"Allow once / Always allow" placeholder until consent, and its frame-src CSP origin is derived automatically.
It falls into \`defaultEmbedCategory\` (default "functional"); override one iframe with data-sw-consent="marketing",
customize the placeholder text with data-sw-consent-note="…", or skip gating with data-sw-consent-skip.
(Consent off → iframes load normally.) A raw third-party <script> in
website.head/scripts stays UNGATED by default — to gate it, write <script type="text/plain"
data-sw-consent="analytics" src="…"></script> and the runtime activates it on consent.
The whole thing is also configurable no-code in Settings → Website → Consent.
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
then drop {{> <name>}} in any page / template / other snippet. Factor out anything repeated (a card,
a contact block) so you edit it in ONE place. The include runs in the CURRENT context, so {{> card}}
inside {{#each dataset.x}} sees the item. (\`name\` must be a bare partial name — letters/digits/-/_ only.)

REFERENCE COOKBOOK (built-in global snippets) — worked recipes that show HOW to compose a component
or an authoring technique from primitives. READ one with get_content("snippet","<name>") to learn the
pattern, or {{> <name>}} it and restyle. The fastest way to see real markup for a feature:
- Sliders → {{> slider-fullscreen}} (full-screen hero, Ken Burns), {{> slider-cards}} (single content
  cards), {{> slider-multi}} (multi-item peek via --sw-items), {{> slider-logowall}} (auto-scroll
  ticker), {{> slider-dataset}} (one slide per dataset entry). Full attribute contract: get_components.
- Gallery/lightbox → {{> gallery-grid}} (styled folder grid), {{> gallery-masonry}} (no-crop),
  {{> gallery-dataset}}. Tabs → {{> tabs-mixed}}, {{> tabs-dataset}}. Modals → {{> modal-basic}},
  {{> modal-confirm}}.
- Forms & inputs → {{> form-embed}} ({{sw-form}}), {{> form-custom}} (your own fields),
  {{> datetimepicker-field}}. Shop → {{> shop-product}} (enable the shop first — the cart helpers
  are gated).
- Data & bindings → {{> dataset-grid}} ({{#each dataset.x}} + sw-date/sw-truncate),
  {{> folder-gallery}} ({{#sw-folder}} media reads), {{> i18n}} (sw-translate +
  data-sw-translate + sw-flag switcher), {{> page-vars}} (data-sw-text/html/src/bg on
  page.data, page.children, page.parent, sw-active).
- Chrome & effects → {{> navbar}}, {{> banner-bar}}, {{> logo-marquee}}, {{> rotating-tiles}},
  {{> parallax-hero}} (scroll drift), {{> shader-hero}} (WebGL background).

SNIPPET vs WIDGET vs COMPONENT: a SNIPPET is reference markup you copy and OWN (edit it freely); a
COMPONENT is a runtime you activate with data-sw-component=… (behaviour — see get_components); a
WIDGET is a snippet packaged with auto-provisioning. The built-in {{> hero-slider}} renders a
full-bleed background SLIDESHOW (Ken-Burns drift + rising captions, the standard frontpage hero);
its slides are EDITED AS DATA, no code. Just include {{> hero-slider}} — saving the page auto-provisions
its config dataset (slug "hero"). To POPULATE it programmatically, create ONE \`hero\` entry (or several —
the widget renders the entry whose id = page.data.hero_config, else the first) with these fields:
  • slides — a LIST; each item = { image (media url), caption (richtext; blank caption → no pill) }
  • autoplay (boolean), interval (number, ms), kenburns (boolean), show_arrows (boolean), show_indicators (boolean)
So a cloned hero carousel = put the slide images/captions as a \`hero\` entry's \`slides\` list + set the toggles;
you do NOT hand-author the carousel markup.
The other built-in widget is {{> logo-marquee}} — a CSS-only auto-scrolling logo strip; its \`marquee\` dataset
entry has { speed (select: Normal/Slow/Fast), logos (LIST of { image, alt, link }), or a \`folder\` name to
pull every image in a media folder }. Same pattern: include the partial, populate the dataset, no markup.
(Those are the only two WIDGETS; ordinary interactive sliders/tabs are plain snippets — see
get_guide("components") + the System Library slider recipes for their data-* contract.)
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
    title: "Navigation — menus, dropdowns, mobile drawer",
    summary: "slot menus (header/mobile/footer) + child-page dropdowns + a pure-CSS mobile drawer + active item + auto language/theme",
    body: `
DON'T REINVENT THIS — copy the recipes: {{> nav-header}} (the full default: data-driven desktop bar +
a pure-CSS mobile drawer + language dropdown + theme toggle), {{> nav-footer}}, or {{> navbar}} (simple).
Read one with get_content("snippet","nav-header"). New projects already ship {{> nav-header}} in their
Main Navigation slot. The notes below explain how it works so you can adapt it.

NAV SLOTS (page settings): each page's nav.slots places it in a menu — "header" (the Main Navigation),
"mobile" (the mobile drawer), and/or "footer". nav.title overrides the menu label (else the page title);
nav.order sorts; nav.dropdown:true folds the page's CHILD pages into a dropdown under it. The menus are
built for you: loop {{#each nav.header}} / {{#each nav.mobile}} / {{#each nav.footer}}, each item exposing
path, children (sub-pages, when nav.dropdown is on), newTab, external, and the label.

ONE MENU ITEM: output the label with {{sw-label}} (renders a placeholder's rich name; a page title is
escaped — never use {{{ }}}), the link with {{sw-url path}}, honor {{#if newTab}} target/rel, and mark the
active item with {{sw-active path}} (boolean, no JS, root-relative). Active matches the TRAIL by default (a
parent stays active on its children — except home "/" or a locale home "/es", which match only themselves);
pass exact=true for the current page only:
  <a href="{{sw-url path}}" class="{{#if (sw-active path)}}active{{/if}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}}</a>
(.active is what the nav EFFECT styles.)

CHILD-PAGE DROPDOWN (desktop): a CSS hover dropdown whose PARENT STAYS A REAL LINK — <li class="dropdown
dropdown-hover"><a href="{{sw-url path}}">{{sw-label}}</a><ul class="dropdown-content menu …">{{#each
children}}<li><a href="{{sw-url path}}">{{sw-label}}</a></li>{{/each}}</ul></li>. Do NOT use
<details>/<summary> for a desktop dropdown (it makes the parent a toggle, not navigable).

MOBILE DRAWER: there is NO drawer runtime — build a pure-CSS slide-in drawer with a peer-checkbox (no JS).
The hidden <input type="checkbox" id="sw-nav-drawer" class="peer sr-only"> MUST be the first sibling; a
<label for> is the hamburger, a second <label for> the backdrop, and the panel uses -translate-x-full →
peer-checked:translate-x-0. The hamburger and the drawer MUST be in the SAME slot (no cross-slot toggle).
Use <details>/<summary> accordions for child pages INSIDE the drawer; include the logo + a CLOSE <label
for>. Loop {{#each nav.mobile}} (the "Mobile menu" pages), with an {{else}} fallback to {{#each nav.header}}
until one is curated.

AUTO LANGUAGE + THEME: gate a flag language switcher on {{#if page.translations}} (loop page.translations;
{{sw-flag (lookup @root.website.data.locale_flags locale)}} — set website.data.locale_flags = {"en":"gb",…});
add {{sw-theme-toggle}} (renders nothing unless themes are enabled). Both auto-appear.

NAV PLACEHOLDERS: a page with kind:"link" is a menu item with NO page of its own — set link.target
("/path", "https://…"/"mailto:"/"tel:", "#section", or "#dialog-id" to open a <dialog> in website.bottom) +
optional link.newTab, and nav.slots/nav.dropdown as usual; its title is the menu name (may include
{{sw-icon}}/basic HTML, output via {{sw-label}}).

LANDMARK RULE: never author <nav>/<main>/<footer>/<aside> — the skeleton owns those; nav content is the
INNER markup of the Main Navigation / Footer slots.
`,
  },
  import: {
    title: "Nativize an imported website — a faithful port to native primitives",
    summary: "re-express a faithfully-imported page (literal HTML, marked data.swImport + draft) in native primitives (theme tokens, components, datasets, bindings) WITHOUT changing its layout — then clean up the foreign CSS/JS and tidy the media folders",
    body: `
IMPORTED PAGES. When an external site is imported (the OWNER does this in the editor — you don't trigger
it), each page lands as a FAITHFUL replica: literal HTML in \`source\` (no Handlebars), the foreign CSS
folded into the website criticalCss/head slots, the shared header/footer hoisted into the mainNav/footer
slots, and images self-hosted. Each page is MARKED \`page.data.swImport = { sourceUrl, rewritten:false }\`
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
   AVOID DaisyUI RESERVED component class names as plain layout classes — steps / tabs / carousel / collapse
   / card / badge / menu etc. are COMPONENTS; e.g. <ol class="steps"> lays items out horizontally. Name your
   own wrappers something else (howto-steps), or you'll inherit a component's styling by accident.
2. COLORS: replace the foreign palette (fixed hexes, --primary-color vars, named colour classes) with the
   MATCHING theme tokens (primary, secondary, base-100/200/300, base-content) so light AND dark work; set
   the brand from the imported identity (see "SET THE BRAND" in the core instructions) to the source's colours.
3. BINDINGS: swap hardcoded company name/contact/social for {{ company.* }} (use get_reference for exact names).
4. REPEATED MARKUP -> DATA: turn repeated blocks (cards, team, posts, logos) into a dataset + {{#each}}
   (get_guide("components") / the reference) instead of copy-pasted HTML — same rendered output, less markup.
   The import auto-infers datasets with generic slugs (items/items2/…); give them meaningful slugs with the
   rename_dataset tool — it CASCADES (rewrites every entry + page/template reference in one step). A dataset
   slug is a Handlebars PATH (dataset.<slug>), so it must be an UNDERSCORE identifier — name it
   "faq_passengers", NEVER "faq-passengers" (a hyphen parses as subtraction and breaks the loop; the tool
   rejects it). Do NOT change a dataset's slug via put_content: that renames only the dataset and orphans
   its entries + loops. rename_dataset ALSO takes a "name" — set a human display name so the dataset doesn't
   stay the import's generic "List"/"List 2" in the editor. ITEM KEYS (entry ids) follow the same rule: they
   are underscore identifiers (used as {{item.<dataset>.<id>}} paths + data-sw-entry edit handles), NEVER
   slug-prefixed or hyphenated ("fast_pickup", not "items-fast-pickup"). And make the loop EDITABLE: put
   data-sw-text / data-sw-html on each field INSIDE the {{#each}} ({{title}} → <span data-sw-text="title">
   {{title}}</span>) so the client can edit every item — a loop with bare {{field}} and no directives renders
   but can't be edited. GOTCHA: an entry's "dataset" field stores the dataset SLUG, and the loop resolves
   rows by slug — so after rename_dataset, any entry you re-put (e.g. to add a field) must carry the NEW slug
   in its "dataset" (re-putting with a stale value silently renders the loop EMPTY). Read entries AFTER the
   rename, or set the "dataset" field to the new slug explicitly.
4b. SHARED LAYOUTS -> TEMPLATE: when several imported pages share ONE layout — legal pages (Imprint +
   Privacy Policy = a titled rich-text card), or repeated service/detail/blog pages — do NOT author them as
   N standalone pages. Create ONE template (put_content "template" { id, name, source }) and render each page
   FROM it: set page.template + put that page's content in page.data, read in the template via {{page.data.*}}
   (+ data-sw-* so it's editable). One layout to maintain, faithful per page. See get_guide("templates").
5. INTERACTIVITY: rebuild sliders/carousels/lightboxes/tabs/accordions/modals with the matching platform
   COMPONENT (get_guide("components")) so they keep working — the import stripped their JS. The component gives
   you the BEHAVIOR; its DEFAULT chrome (arrows, dots, control bars, borders, tab underlines) rarely matches
   the source, so RESTYLE it to match with a scoped <style> in the page source (or website.criticalCss for a
   site-wide control): e.g. slider arrow size/position + indicator dots + a translucent bottom control bar;
   CENTER the tab strip and match the original's tab SHAPE — strip the component's default background +
   padding and match its corner-radius + active style + font size (a stray tab background or mismatched
   rounded edges is a common miss). For an ACCORDION use the DaisyUI collapse
   pattern — <details class="collapse collapse-arrow bg-base-200 …"> (the open marker is the summary), NOT a
   bare <details> — then match its border/spacing/icon to the source. Shipping a component's default look when
   the original clearly looks different is a fidelity miss.
   SLIDER (Carousel) specifics: include ALL the source's slides (don't drop any), each with a real image src;
   give the prev/next buttons a visible icon ({{sw-icon "chevron-left"}}) and keep a [data-sw-part="dots"]
   (the runtime fills it). The arrows/dots are HIDDEN until the JS runtime ENHANCES the slider — so they do
   NOT show in a static/JS-blocked preview; verify them on a rendered page, and when you restyle the controls
   with <style> make sure you keep them VISIBLE (don't set opacity:0 / off-screen / transparent-on-transparent).
6. EDIT AFFORDANCES: add data-sw-* directives + {{sw-control}} where the client should edit content. A dataset
   {{#each}} loop auto-gets a click-to-edit handle in the editor preview (each row is wrapped in data-sw-entry
   → a teal "entry" badge + outline that opens that item's editor on click) — but ONLY in the editor's live
   preview, not the static whole-site preview; and put data-sw-text/html on the fields so the inner text is
   editable too. If a row is FULLY covered by editable leaves, click the row's teal entry badge (or any
   non-text chrome / use the Regions panel) to open the full item editor.
7. IMAGES: keep the self-hosted images the import found (same src); fill gaps with import_image (from a URL)
   or search_stock_images (SVGs and oversize images may have been dropped).
8. ASSET FOLDERS: the import dumps every self-hosted file into a TRANSIENT \`imported/\` tree — REORGANIZE it
   into a clean, human-readable library. Group by the page/role that uses each file (a dedicated folder when
   a page has a cluster of ~3+, e.g. \`Management Team\`; a shared role folder for once-per-page assets like
   \`Header Images\`; \`Main\` for sitewide singletons — logo, favicon). Use slugified names, never bare UUIDs
   (\`ronald-kubas.jpg\`). PRUNE files no page references. Tools: list_media_folders (look first),
   create_media_folder, move_media (re-file + rename one asset), rename_media_folder, and delete_media
   (permanently remove an orphaned file — needs the content:delete capability; if you lack it, move the
   file to an \`Unused\` folder instead). Moving/renaming is SAFE — it only changes the folder TAG, and the
   \`/media/...\` URL is content-addressed + stable, so page references never break (only delete_media is
   destructive). End state: a tree a human dev reads at a glance, with no \`imported/\` left.
9. MATCH THE VISUAL SCALE (not just the structure — these "looks-close-but-off" misses are the most common):
   - TYPE SIZES: don't shrink text. Match the source's body + heading scale (read the original's font sizes;
     a real site's body is usually ~16-18px and headings are large). Defaulting everything to small text is a
     frequent, glaring miss.
   - ICON / graphic sizes: feature + hero icons are often BIG (~40-64px). Measure the original — don't default
     to a tiny h-9.
   - SHADOWS: cards, the header, buttons, popovers and tiles usually carry a VISIBLE shadow. Replicate its
     strength (shadow-md/lg/xl), not a faint one or none.
   - Spacing/padding and border weights likewise — match, don't approximate.

CHROME (do this too — it isn't done until the slots are ported). The header / footer slots
(in the settings entity, website.mainNav/.footer) still hold literal foreign HTML. Port them the
same way — same layout, native classes + tokens + {{company.*}} — editing the settings entity.
USE THE DEFAULT NAV AS THE STARTING POINT — DON'T HAND-ROLL A MENU WITH HARD-CODED ITEMS, and don't assume
the bare partial is enough. The mainNav SLOT is already populated (the importer put the foreign header there;
new projects ship {{> nav-header}}) — start from what's in the slot and ADAPT it; you do NOT need to fetch the
snippet (get_content("snippet","nav-header") only resolves if the project actually has that snippet entity —
an imported project does NOT, so it 404s; the data-driven recipe is in get_guide("nav")). The default is a
data-driven desktop bar + pure-CSS mobile drawer + language/theme toggles; ADAPT it to the original's exact
look: wrap it in the right CONTAINER (e.g. a .sw-container / centered max-width bar — the etaxi header needs
one), set the brand-bar background + height, logo placement, spacing, and link styling. KEEP IT DATA-DRIVEN —
build the items from the loop {{#each nav.header}}…{{sw-label}}…{{/each}}; NEVER write a fixed list of <a href>
entries. A nav <ul> needs an explicit list-none (Tailwind preflight leaves list markers, so a stray bullet
appears otherwise). A menu item exists because a PAGE opts into the slot: set each page's nav:{ slots:["header"],
title:"<short label>", order } (footer links the same via {{#each nav.footer}} / {{> nav-footer}}, also usually
copied + adapted). See get_guide("nav").
HEADER FIDELITY: (a) give the header bar a VISIBLE drop shadow (e.g. shadow-lg) — a faint shadow-sm vanishes
when the bar sits on a same-colour hero, so go stronger or add a hairline bottom border. (b) The header must
use the SAME content container + horizontal padding as the body sections (the .sw-container), so the logo +
menu line up vertically with the hero/section content — do NOT zero the header's container padding, and keep
that padding on mobile/tablet too (a flush-to-edge header is a common miss). (c) The mobile menu must be the
slide-in DRAWER (the nav-header pure-CSS drawer pattern), NOT a dropdown — default to the drawer on small
screens.
IN-PAGE ANCHOR MENUS (a one-pager whose menu scrolls to sections — e.g. Home / Why eTaxi / How To Use / FAQ):
do NOT hard-code href="#why". Create a LINK-PLACEHOLDER page per anchor — put_page { kind:"link", title,
nav:{ slots:["header"], order }, link:{ target:"#why" } } — so it appears in {{#each nav.header}} as a
smooth-scroll item, and give the matching home section id="why". (get_guide("nav") → NAV PLACEHOLDERS.)
STANDARDIZE THE CHROME: the slots are SITE-WIDE — author ONE header + ONE footer that every page shares.
When the original site styles its chrome INCONSISTENTLY across pages (e.g. a white header on one page, the
brand-colour header on another), DO NOT copy the divergence — pick the treatment that reflects the brand's
intent (usually the one in the brand/primary colour, or the most common one) and use it everywhere. If a
SPECIFIC page genuinely needs a different chrome look, don't fork the slot — add a per-page \`<style>\`
override in THAT page's source (scoped to it) on top of the shared chrome.
MATCH THE CHROME DETAIL faithfully: keep the LOGO exactly as the source presents it — do NOT invent a colored
box/pill behind it unless the original has one (a logo on a brand-colour bar usually sits directly on the bar).
The FOOTER / sub-footer must match the source's background (often white/light, not the brand colour), its
border weight, AND every link — including an agency/attribution credit (e.g. a "PHOENIX" build-credit link);
don't silently drop links. A fixed social/contact RAIL that the original shows on DESKTOP must be VISIBLE on
desktop — author it with the original's breakpoints, not md:hidden (mobile-only), or it vanishes on the
desktop compare.

CLEAN UP THE FOREIGN FILES (do this LAST, once the pages + chrome are ported). The folded-in foreign CSS
(website criticalCss / head) and any leftover dropped/self-hosted JS are now dead weight — REMOVE what is
no longer referenced (trim the criticalCss/head to nothing once every section is token-driven; delete unused
self-hosted .js/.css media). The page is NOT done until the media library is also a clean tree (step 8) — no
leftover \`imported/\` UUID dump. Re-render and confirm nothing regressed.

SAFETY: <script> tags were REMOVED and <form>s converted to inert <div>s on import. Do NOT re-add raw
JavaScript — rebuild interactivity with platform components (step 5) and real Forms (create a form entity,
embed with {{sw-form}}).

VERIFY AGAINST THE SOURCE (mandatory — do NOT trust your own render): after authoring a page, call
compare_to_source(pageId). It returns YOUR BUILD and the ORIGINAL site SIDE-BY-SIDE at desktop + mobile.
Go region by region — header (logo treatment), every section/tile (incl. ICON SIZE + shadow), tabs + their
inner media, accordion, footer/sub-footer, the fixed social rail — and match background, borders, colours,
TYPE SIZES, icon/graphic sizes, SHADOW strength, and component-control styling (slider arrows/dots, tab
centering + active state) — not just layout and content. Fix the differences and call it AGAIN. Keep
iterating until the build matches the original; a page is NOT done because your own screenshot looks fine. Work ONE page at a time so conventions (theme tokens, datasets,
chrome) carry across the site.

STRUCTURE CHECK (compare_to_source only catches VISUAL diffs — these are STRUCTURAL, so self-verify, they
won't show in a screenshot): the header + footer menus are DATA-DRIVEN (built from {{#each nav.*}} over page
nav-membership + link-placeholders), NOT a hard-coded <a> list; in-page section links are kind:"link"
placeholders (not literal href="#…" in a hand-rolled menu); pages sharing a layout (legal/repeated) render
from ONE shared template, not duplicated page source.

WHEN A PAGE IS DONE (i.e. compare_to_source shows it matching the original AND the STRUCTURE CHECK passes):
set page.data.swImport.rewritten:true (or remove the marker) and flip its status to "published".
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
  { name: 'compare_to_source', description: "Screenshot an imported page's BUILD and its ORIGINAL source side-by-side, to see and fix how the build differs from the real site.", capability: 'content:read' },
  { name: 'get_publish_status', description: "Read the project's latest published release (or null)." },
  { name: 'list_submissions', description: "List form submissions (newest first; optional formId + pagination).", capability: 'content:read' },
  { name: 'list_stock_providers', description: "List configured stock-image providers and whether each is available.", capability: 'content:read' },
  { name: 'search_stock_images', description: "Search a stock-image provider for photos.", capability: 'content:read' },
  { name: 'list_media', description: "List the project's self-hosted media assets (URLs to reference, kind, dimensions, alt).", capability: 'content:read' },
  { name: 'list_media_folders', description: "List the project's media folders (virtual grouping labels; '' = root).", capability: 'content:read' },
  { name: 'put_page', description: "Create or replace a page (id taken from page.id).", capability: 'content:write' },
  { name: 'delete_page', description: "Delete a page by id.", capability: 'content:delete' },
  { name: 'put_content', description: "Create or replace a content entity of the given kind.", capability: 'content:write' },
  { name: 'delete_content', description: "Delete a content entity by kind + id.", capability: 'content:delete' },
  { name: 'list_revisions', description: "List a content entity's revision history (newest first: id, op, who, when).", capability: 'content:read' },
  { name: 'restore_revision', description: "Restore a content entity to an earlier revision (non-destructive; recreates a deleted entity).", capability: 'content:write' },
  { name: 'import_stock_image', description: "Import a stock photo into the project (downloaded, optimized, self-hosted with attribution).", capability: 'content:write' },
  { name: 'import_image', description: "Import an image into the project from a public https URL (downloaded, optimized, self-hosted).", capability: 'content:write' },
  { name: 'create_media_folder', description: "Create an (empty) media folder + any missing ancestors.", capability: 'content:write' },
  { name: 'rename_media_folder', description: "Rename or move a media folder (re-roots the subtree + re-files every asset under it).", capability: 'content:write' },
  { name: 'move_media', description: "Move and/or rename a single media asset (folder re-files it; filename sets its display name).", capability: 'content:write' },
  { name: 'delete_media', description: "Permanently delete a media asset (DB row + binary) — prune orphaned files. Its URL stops resolving; ensure nothing references it.", capability: 'content:delete' },
  { name: 'rename_dataset', description: "Rename a dataset's slug (underscore identifier) AND/OR its display name — CASCADES to entries + page/template sources (and reference targets) so loops keep working.", capability: 'content:write' },
  { name: 'publish_project', description: "Build the project's static site from current saved content.", capability: 'publish' },
];
