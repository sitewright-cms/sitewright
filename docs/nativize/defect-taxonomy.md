# Nativize — defect taxonomy

> The categories every audit uses to tag each defect. A defect maps to the brief rule it **violated**,
> or is marked `MISSING-RULE` when no rule covered it (→ propose a new rule, bump the brief version).
> This is how the prompt-improvement loop turns observed failures into brief improvements.
> Rules referenced: [author-brief.md](./author-brief.md).

## How to use
For each defect found in the VERIFY phase, record: `{category, ruleId, page, severity, note}`.
- `severity`: `blocker` (broken/unstyled/wrong content) · `major` (clearly unfaithful) · `minor` (cosmetic).
- After a run, aggregate by category → the top categories are where the brief/foundation needs work.
- A defect tagged `MISSING-RULE` is the highest-signal: it means a whole failure class is uncovered.

## Categories

| ID | Category | Rule(s) | Real spike examples |
|----|----------|---------|---------------------|
| **C-VALIDATION** | Landmark tags / `{{{raw}}}` / inline style-script / foreign classes | R1, R2 | imported bodies full of `fa fa-*`, `d-md-none`, `container` |
| **C-TYPO** | Wrong/uncaptured fonts; sizes too small | R6, R7 | body `text-sm`/captions `text-xs`; platform default serif used instead of the brand woff (`primary-font`/`secondary-font`) |
| **C-COLOR** | CI colors unset or hardcoded hex | R4, R5 | secondary left at default blue instead of `#565656` |
| **C-NAV** | Nav hardcoded instead of `{{#each nav.header}}` | R13 | round-2 chrome hand-listed the menu links |
| **C-WHITESPACE** | Empty bands, seam gaps, side gutters, framed boxes, footer gap | R9–R12 | about page empty band where the original has a map; Facebook-iframe blue block; service white area showing grey |
| **C-COMPONENT** | Hand-rolled where a primitive exists (gallery, slider, modal) | R15, R16, R17 | inauguration as a static grid (should be Lightbox) then a generic carousel (should be `{{> hero-slider}}`); project rows missing the View→PDF modal |
| **C-FORM** | Dead `<form>` instead of functional `{{sw-form}}` | R18 | contact form had no endpoint until `{{sw-form "contact"}}` |
| **C-ICON** | Buttons missing leading icon | R20 | CTA/Download/Apply/Send buttons text-only |
| **C-SHADOW** | Elevation missing/too weak vs original | R23 | service image + cards flat; needed `bp-card` |
| **C-EDIT** | Visible copy not wrapped for editing | R19 | headings/paragraphs hardcoded, not `data-sw-text` |
| **C-ASSET** | Bare-UUID names / one flat folder / unpruned files | R21, R22 | everything under `_assets/<uuid>` |
| **C-FIDELITY** | Faithful-design miss not covered above (texture, bg treatment, layout) | R8, R12, R25, R32, page-specific | red bands missing texture; contact missing bg-image+overlay; **etaxi: header white not yellow; "Why" tiles solid-white not semi-transparent+border; tile content left not centered; legal pages a generic richtext blob not the brand-bordered container** |
| **C-HALLUCINATION** | Invented section/element/link not in the original; placeholder `href="#"`/lorem | R24 | **etaxi: a whole "Download the App" band invented; app-store badges + Imprint/Privacy links were dead `#` placeholders** |
| **C-SNIPPET** | DaisyUI/hand-rolled used where a SW snippet exists | R13, R13a | **etaxi: nav hand-built `<li>`s instead of `nav-header`; How-To/FAQ used DaisyUI tabs not `tabs-mixed`/`tabs-dataset`; tiles not `recipe-dataset-grid`** |
| **C-COMPONENT-CONTENT** | A component panel stripped of the original's inner media | R27 | **etaxi: How-To/FAQ tabs lost their sliders/images/buttons/video — reduced to a bare text list** |
| **C-ICON-CAPTURE** | Original icons not reproduced (wrong glyph/size/color) | R26 | **etaxi: all "Why" tiles got one generic check icon; real distinct icons + sizes/colors dropped** |
| **C-SIDEBAR** | Original sidebar/off-canvas dropped | R28 | **etaxi: sidebar not captured (foundation discards `sidebarLeft/Right`)** |
| **C-DATASET-NAME** | Generic crawler dataset names kept | R29 | **etaxi: `items2`/`items3` not renamed to `FAQ – Passengers/Drivers`** |
| **C-FOREIGN-FILES** | Imported CSS/JS/icon-font files left in the media library | R30 | **etaxi: File Manager still held imported `.css`/`.js` + FontAwesome woffs; `imported/_data` UUID dump not streamlined** |
| **C-STALE** *(verify-process, not a code defect)* | Audited a STALE/transient render and mis-judged | — (VERIFY rule) | career/management false defects were stale fullPage CSS; **etaxi: a preloader scroll-lock (`html{overflow:hidden}`) clipped the headless render to the viewport** |

## Verify-phase rules (process, not page rules)
- **V1** The author who declares faithfulness is never the only verifier — an independent render-and-compare is mandatory.
- **V2** The fullPage screenshot can capture stale CSS on tall pages and during lazy preview rebuilds.
  Confirm a suspected defect with `getComputedStyle` + a targeted element screenshot before logging it
  (avoids C-STALE false positives). Warm the preview (one request) before the authoritative render.
- **V3** Headless artifacts ≠ defects: third-party embeds (maps, PDF iframes) and lazy map tiles may not
  paint headlessly though they work in a real browser — verify the markup/URL, don't log a false defect.
- **V4** Verify PER SECTION, not by whole-page glance: enumerate the original's sections top-to-bottom and
  confirm each (header, hero, every band/tile, tabs + inner media, accordion, footer, sub-footer, sidebar).
  The etaxi pass declared `faithful` on a glance and missed ~15 defects on a single-page layout — the
  author must produce the defect list, not the user.
- **V5** Release scroll-locks before the authoritative screenshot: a preview/preloader can leave
  `html{overflow:hidden}` + a fixed body height, clipping a headless fullPage capture to the viewport
  (looks "blank below the fold"). Force `overflow:visible` / `height:auto` before measuring + shooting.

## Loop bookkeeping
Each run appends to [progress.md](./progress.md): defect counts by category, any `MISSING-RULE` items,
the brief-version bump, and which categories the bump targets. A category trending down across versions =
the loop working; a recurring category = the rule is ambiguous or unenforced (strengthen it / add to self-lint).
