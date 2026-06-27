# Nativize — page author brief

> Version: v3 (2026-06-26). The instruction set given to each per-page authoring agent.
> Numbered rules (Rn) are traceable: each exists because a real defect occurred — see
> [defect-taxonomy.md](./defect-taxonomy.md). Copy-paste patterns: [golden-snippets.md](./golden-snippets.md).
> Changelog at the bottom.

You author ONE page of an external site as **clean, native Sitewright code**, then **verify it by
rendering and comparing to the original screenshot**. The bar: (1) clean native code, (2) faithful at
desktop AND mobile, (3) uses SW primitives, (4) content client-editable, (5) responsive.

## The loop
1. **Read the original** (your ground truth): the page's desktop + mobile reference screenshots.
2. **Read the imported content** for exact text + asset paths + any dataset refs.
3. **Check the primitive registry** before hand-rolling anything: `get_components` (COMPONENT_CATALOG),
   `get_reference` (authoring-reference), `get_guide`. Prefer a documented primitive over custom markup.
4. **Author** the page body; create datasets/templates/forms as needed.
5. **`compare_to_source(pageId)`** — the mandatory verification. It returns YOUR BUILD next to the
   ORIGINAL site, desktop + mobile. This is the ground truth — NOT your own `preview_page` render.
6. **Self-lint** against the checklist; then **diff the compare_to_source pair PER SECTION** —
   header, hero, each band, each tile, tabs+their inner media, accordion, footer, sub-footer, sidebar —
   matching background, borders, alignment, type sizes, icons and content. List every difference; fix;
   call `compare_to_source` AGAIN; repeat until the build matches the original at both breakpoints.
   "Looks about right" / your own screenshot is NOT verification.
7. **Return** the structured report (output contract below). `faithful:true` is earned ONLY when
   `compare_to_source` shows the build matching the original — never from your own render. An independent
   auditor re-runs compare_to_source.

## Rules

### Structure & landmarks
- **R1** Page body is Handlebars + Tailwind injected into the platform `<main>`. NEVER emit
  `<html>/<head>/<body>/<nav>/<header>/<footer>/<main>/<aside>` — the validator rejects those landmarks.
- **R2** NEVER `{{{tripleRaw}}}`; NEVER inline `<style>`/`<script>` in a page (site-wide CSS lives in
  `criticalCss`); NEVER foreign framework classes (`fa fa-*`, `d-md-none`, `container`, `wow`,
  `z-depth-*`, `waves-*`, `grid-N-col`).
- **R3** Repeating layout across sibling pages → ONE `template` + per-page `page.data`. Repeating
  content → a dataset + `{{#each dataset.<slug>}}`. Don't duplicate near-identical source.

### Theme & color
- **R4** Use theme tokens, never hardcoded hex: `text-primary`/`bg-primary`, `text-base-content`,
  `bg-base-100/200/300`, `bg-neutral text-neutral-content`, `btn btn-primary`/`btn-neutral`.
- **R5** CI colors come from the foundation (`identity.colors`) — don't reintroduce the original's raw hexes.

### Typography & sizing
- **R6** Fonts are set globally by the foundation (captured brand woffs). Don't override font-family.
- **R7** Type scale — body `text-base lg:text-lg` (NEVER `text-sm` for body copy); small meta/captions
  `text-sm` (NEVER `text-xs`); hero h1 `text-3xl lg:text-5xl`; section h2 `text-2xl lg:text-3xl`.
- **R8** Rich-HTML containers (`data-sw-html`) need prose styling via descendant arbitrary variants:
  `[&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-5 [&_h6]:font-bold` etc.

### Container & whitespace
- **R9** Constrain width ONLY where the original does: `mx-auto max-w-screen-xl px-4`. Full-bleed bands
  (heroes, colored sections) get NO max-w wrapper (or you get side gutters the original lacks).
- **R10** No gratuitous wrapper `<div>`s and no framed card boxes around whole-page content unless the
  original shows one. Body sits flush under the nav and flush above the footer.
- **R11** The site body is grey-textured (foundation). White content areas (prose, tables, forms) get
  `bg-base-100`; card-grid sections where cards sit ON the grey stay transparent (cards get `bg-base-100`).
- **R12** After rendering, EXPLICITLY scan for: empty bands, double padding, framed borders, side gutters
  on full-bleed sections, gaps at section seams / above the footer. Remove the offending container.

### Components & primitives (prefer these over custom markup)
- **R13** Nav is NEVER hardcoded — use the canonical **`nav-header`** chrome snippet (and `nav-footer`),
  which iterate `{{#each nav.header}}` from the nav object. Configure the nav ITEMS (labels, links,
  in-page section anchors, the CTA button) in the nav data — do NOT write `<li>`-by-`<li>` markup or
  literal hrefs in the slot. Same for the footer: start from `nav-footer`, don't rebuild from scratch.
- **R13a** Prefer a SW snippet/component over DaisyUI or hand-rolled markup whenever one exists — check
  the snippet library FIRST: tabs → `tabs-mixed` / `tabs-dataset` (NOT DaisyUI `tabs`); sliders →
  `slider-*`; galleries → `gallery-*`; modal → `modal-*`; forms → `form-embed`/`form-custom`; dataset
  card grid → `recipe-dataset-grid`; nav/footer → `nav-header`/`nav-footer`. DaisyUI is the fallback,
  not the default.
- **R13b** Use each page's NAV LABEL + page SETTINGS — don't hardcode menu text. The nav renders
  `{{sw-label}}`, which reads the page's nav label; set a clean per-page nav label (e.g. `Why eTaxi`),
  not the raw `<title>` (which may carry a `| Site Name` suffix). Likewise populate the other available
  page settings from the original — menu order, dropdown/parent placement, `newTab`, SEO title +
  meta description, and the slug. The original's menu order and labels are part of fidelity.
- **R14** Helpers: `{{sw-url x}}` REQUIRED for any dynamic href/src; `{{sw-html x}}` for rich HTML;
  `{{sw-icon "name" "h-4 w-4"}}` (Lucide). Inside a `{{#each}}` fields are bare (`{{title}}`).
- **R15** Galleries → the **Lightbox** component (`data-sw-component="lightbox"` over `<a href><img></a>`
  with `data-caption`), never a plain grid.
- **R16** Hero slideshow → the **`{{> hero-slider}}` widget** (auto-provisions the `hero` dataset; populate
  one config entry with `slides`). Use the widget when a hero slider is wanted — not a hand-rolled carousel.
  Other slideshows → `data-sw-component="carousel"`. (Gotcha: clean image URLs — a stray quote → `src="#"`;
  empty `caption` renders a small empty pill, give one or leave it editable.)
- **R17** Modal (e.g. a "View" PDF preview, no download) → `<a href="#id">` + `<dialog id
  data-sw-component="modal">` (no inline JS). In a loop, put the `<dialog>`s in a SECOND loop AFTER the
  list so they don't break nth/last styling.
- **R18** Forms → create a `form` definition (kind `form`: `{id,name,fields:[{name,label,type,required}]}`)
  then embed `{{sw-form "id"}}` (functional: endpoint + honeypot injected). NEVER a dead `<form>`.

### Content editability
- **R19** Wrap visible copy in `data-sw-text="page.data.KEY"` (plain) / `data-sw-html="page.data.KEY"`
  (rich); set the value in `page.data`. Headings, paragraphs, labels, CTA text.
- **R20** Every button carries a leading icon: `class="btn btn-primary gap-2">{{sw-icon "send" ...}}…`.

### Assets & naming
- **R21** Reference the organized asset paths, not bare UUIDs. Ingest lands assets in a transient
  `imported/*` tree — REORGANIZE it. Group per page; a dedicated folder only when count justifies it
  (gallery/grid ≈ 3+); one-per-page heroes → shared `Header Images`; sitewide singletons (logo/icon) →
  `Main`. Rename to slugified subjects (`ronald-kubas.jpg`). Tools: `list_media_folders` (see what
  exists first), `create_media_folder`, `move_media` (re-file + rename one asset), `rename_media_folder`.
- **R22** Prune assets the page no longer references.

### Elevation
- **R23** Cards/images use `bp-card` (foundation) + usually `ring-1 ring-base-200 rounded-lg
  overflow-hidden`. Shadows must be clearly visible (originals have strong drop shadows).

### Fidelity — match the original, never invent (the rules the etaxi pass violated)
- **R24 — NO HALLUCINATION.** Every section, element, image and link must exist in the original. NEVER
  invent a section (e.g. a standalone "Download the App" band the original keeps only in the footer),
  never pad with content that isn't there. NEVER ship placeholder links (`href="#"`) or lorem text — if a
  target is unknown, wire the real one from the source or leave the field editable + empty, don't fabricate.
- **R25 — Match each section's SURFACE, don't impose a default.** Reproduce the original's per-section
  background (a brand-yellow band stays yellow), the tile/card treatment (semi-transparent fill + colored
  border vs solid white — copy what's there), text ALIGNMENT (centered vs left), and spacing. R11's
  "white surfaces" is only a default; the original overrides it.
- **R26 — Capture icons faithfully.** Reproduce the original's actual icons (map to the closest
  `{{sw-icon}}` / brand icon), preserving their size and color. Don't substitute one generic icon for a
  set of distinct ones.
- **R27 — Preserve ALL content inside a component.** When a section uses tabs/sliders/accordion, keep
  everything the original puts inside them — sliders, images, buttons, video, captions. Don't reduce a
  rich tab panel to a bare text list.
- **R28 — Sidebar / off-canvas.** If the original has a sidebar or off-canvas drawer, reproduce it. The
  foundation currently DROPS `sidebarLeft/Right` — re-add it (chrome slot or page) rather than losing it.
- **R29 — Name datasets meaningfully.** Rename crawler-inferred datasets (`items2` → `FAQ – Passengers`,
  etc.) via the dataset rename so names are self-describing; update the loops accordingly.
- **R30 — Delete foreign files.** After the foundation discards foreign CSS/JS from the head, also DELETE
  those files (imported `.css`/`.js`, FontAwesome/icon-font woffs) from the media library — they must not
  linger in the File Manager. Streamline the folder tree (R21): no leftover `imported/_data` UUID dump.
- **R31 — Content/legal pages are faithful + editable too.** Imprint/Privacy/Terms are NOT a single
  richtext blob dropped in a generic container. Match the original's framing (e.g. white page +
  transparent-brand container + brand border), structure the sections, and wrap the copy in
  `data-sw-html`/`data-sw-text` so a client can edit it.
- **R32 — Header bar fidelity.** The header is part of the diff: match its background (brand vs white),
  container width, logo size, item alignment and spacing to the original — don't settle for the default.
- **R33 — Site-wide data → `website.data`.** Any value reused across pages/sections (app-store URLs,
  phone/email, a booking link, repeated CTAs) belongs in `website.data` once, referenced everywhere with
  `{{website.data.KEY}}` (in a URL: `{{sw-url website.data.KEY}}`). Never hardcode the same value in two
  places or leave it a `href="#"` placeholder — pull the real value from the original (e.g. the live
  app-store links) into `website.data`. Page-specific values still go in `page.data`.
- **R34 — Replicate a component's LOOK, don't abandon it.** When a native SW component's default styling
  differs from the original (slider arrows/dots, accordion active-state highlight, tab styling), keep the
  component and restyle it to match — Tailwind utility classes on the markup, or `criticalCss` rules
  targeting its `[data-sw-part="…"]` / state selectors. Falling back to non-native markup because "the
  default looks different" is a regression (R13a).

## Self-lint checklist (run BEFORE returning — catch violations pre-audit)
- [ ] No landmark tags, no `{{{raw}}}`, no inline `<style>/<script>`, no foreign classes (R1,R2)
- [ ] Body copy is `text-base`/`lg`, captions `text-sm` — no `text-sm` body, no `text-xs` (R7)
- [ ] Full-bleed bands have no max-w wrapper; no empty bands / seam gaps / framed boxes (R9,R10,R12)
- [ ] White content wrapped in `bg-base-100`; card grids transparent on grey (R11)
- [ ] Every dynamic href/src uses `{{sw-url}}`; every button has a `{{sw-icon}}` (R14,R20)
- [ ] Galleries use Lightbox; hero slideshow uses `{{> hero-slider}}`; forms use `{{sw-form}}` (R15,R16,R18)
- [ ] Copy wrapped in `data-sw-text/html` (R19); cards/images have `bp-card` (R23)
- [ ] Assets referenced by organized name, not UUID (R21); foreign CSS/JS/icon-font files DELETED (R30)
- [ ] Nav + footer use `nav-header`/`nav-footer` snippets, data-driven, no hardcoded items/hrefs (R13)
- [ ] Per-page nav LABELS + page settings set (label, order, SEO title/desc, slug) — not hardcoded (R13b)
- [ ] SW snippet used where one exists (tabs/slider/gallery/modal/form) — not DaisyUI/hand-rolled (R13a)
- [ ] NO invented sections, NO `href="#"`/placeholder/lorem (R24); every section traces to the original
- [ ] Each section's bg/tile-fill/border/alignment/icons MATCH the original, not a default (R25,R26,R32)
- [ ] All in-component media kept (slider/img/button/video inside tabs) (R27); sidebar reproduced (R28)
- [ ] Datasets meaningfully named (R29); legal pages faithful + editable, not a richtext blob (R31)
- [ ] PER-SECTION render-diff done at desktop AND mobile — every section confirmed, not glanced (the loop)

## Output contract (return ONLY this JSON — it is parsed, not shown to a human)
```
{ "slug": "...", "faithful": true|false, "componentsUsed": [...], "datasetsUsed": [...],
  "changes": [...], "defects": [ "<remaining diff vs original>" ],
  "selfLint": { "<ruleId>": true|false, ... }, "notes": "..." }
```
Be honest about `faithful`/`defects`. Do not claim faithful without rendering and looking.

## Changelog
- **v1** — initial: structure, theme tokens, directives, datasets/loops, container/whitespace, output contract.
- **v2** — polish pass: type scale (R7), `bp-hero`/`bp-card` (R23), button icons (R20), Lightbox (R15),
  carousel (R16), `sw-form` (R18), View→modal (R17), white surfaces over grey (R11).
- **v3** — foundation split out (fonts/colors/nav now foundation-owned: R5,R6,R13); `{{> hero-slider}}`
  widget mandated for hero sliders (R16); asset naming/folders (R21,R22); self-lint checklist + structured
  `selfLint` in the output contract; agents query the primitive registry (loop step 3).
- **v4** — etaxi-pass failure capture. The diff went from whole-page glance → PER-SECTION enumeration
  (loop step 6). New fidelity rules: no hallucination / no placeholder links (R24), match each section's
  surface/alignment (R25), capture icons (R26), keep in-component media (R27), reproduce the sidebar (R28),
  name datasets (R29), delete foreign files (R30), faithful+editable legal pages (R31), header-bar fidelity
  (R32). R13 now mandates the `nav-header`/`nav-footer` snippets (data-driven, never hand-rolled) + R13a
  snippet-first over DaisyUI + R13b use per-page nav LABELS + page settings (order/SEO/slug), not
  hardcoded text or the raw title. Root cause was non-compliance with the EXISTING loop/R13/registry rules
  as much as missing rules — hence the hardened, enumerated verification.
