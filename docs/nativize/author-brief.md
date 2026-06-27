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
5. **Screenshot** your page at desktop + mobile (the multi-device screenshotter).
6. **Self-lint** against the checklist below; **render-diff** vs the original; list every difference
   YOURSELF; fix; repeat until faithful at both breakpoints.
7. **Return** the structured report (output contract below). Be honest — an independent auditor re-renders.

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
- **R13** Nav is NEVER hardcoded — chrome iterates `{{#each nav.header}}` (foundation owns this; don't
  re-author nav in a page).
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

## Self-lint checklist (run BEFORE returning — catch violations pre-audit)
- [ ] No landmark tags, no `{{{raw}}}`, no inline `<style>/<script>`, no foreign classes (R1,R2)
- [ ] Body copy is `text-base`/`lg`, captions `text-sm` — no `text-sm` body, no `text-xs` (R7)
- [ ] Full-bleed bands have no max-w wrapper; no empty bands / seam gaps / framed boxes (R9,R10,R12)
- [ ] White content wrapped in `bg-base-100`; card grids transparent on grey (R11)
- [ ] Every dynamic href/src uses `{{sw-url}}`; every button has a `{{sw-icon}}` (R14,R20)
- [ ] Galleries use Lightbox; hero slideshow uses `{{> hero-slider}}`; forms use `{{sw-form}}` (R15,R16,R18)
- [ ] Copy wrapped in `data-sw-text/html` (R19); cards/images have `bp-card` (R23)
- [ ] Assets referenced by organized name, not UUID (R21)
- [ ] Rendered + compared to the original at desktop AND mobile (the loop)

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
