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
| **C-FIDELITY** | Faithful-design miss not covered above (texture, bg treatment, layout) | R8, R12, page-specific | red bands missing the geometric texture; contact missing the building bg-image + overlay; hero solid vs patterned |
| **C-STALE** *(verify-process, not a code defect)* | Audited a STALE/transient render and mis-judged | — (VERIFY rule) | career "white job headers" + management "global preview bug" were stale fullPage CSS, not real defects — confirmed via computed-style + element screenshot |

## Verify-phase rules (process, not page rules)
- **V1** The author who declares faithfulness is never the only verifier — an independent render-and-compare is mandatory.
- **V2** The fullPage screenshot can capture stale CSS on tall pages and during lazy preview rebuilds.
  Confirm a suspected defect with `getComputedStyle` + a targeted element screenshot before logging it
  (avoids C-STALE false positives). Warm the preview (one request) before the authoritative render.
- **V3** Headless artifacts ≠ defects: third-party embeds (maps, PDF iframes) and lazy map tiles may not
  paint headlessly though they work in a real browser — verify the markup/URL, don't log a false defect.

## Loop bookkeeping
Each run appends to [progress.md](./progress.md): defect counts by category, any `MISSING-RULE` items,
the brief-version bump, and which categories the bump targets. A category trending down across versions =
the loop working; a recurring category = the rule is ambiguous or unenforced (strengthen it / add to self-lint).
