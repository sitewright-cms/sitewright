# AI Clone / Nativize — progress log

Dated records of what's done, decided, and next. Newest first. Spec: [pipeline.md](./pipeline.md).

---

## 2026-06-26 — plan documented, Step 1 started

**Decisions locked (from review):**
- Approach = 3-phase hybrid: mechanical ingest+foundation → AI authoring → render-diff verify.
- Retire the user-facing mechanical website importer → single **"Clone with AI"** flow; crawl/import
  become internal. Deprecate the mechanical per-page nativizer.
- Foundation extractor is deterministic; foreign **CSS is transient (extract then discard)**, foreign
  **JS is dropped**, only binary assets persist.
- Assets organized **per page, count-justified** (dedicated folder for galleries; shared "Header Images"
  for one-per-page heroes; "Main" for sitewide singletons; never bare-UUID names).
- Agents operate through the **SW MCP toolset** (screenshotter `preview_page`, reference
  `get_components`/`get_reference`/`get_guide`, `put_content`, + media tools to add).
- The **prompt-improvement loop** is the priority lever; build its scaffold first.

**Spike state (proven, pre-productionization):** burmeister-native (`F45xZmYIGBaj`) — all 19 pages
authored as clean native SW, verified by render-diff at desktop+mobile across 3 feedback rounds.
Foundation (data-driven nav, theme, captured fonts `primary-font`/`secondary-font`, CI colors
`#B42A33`/`#565656`, criticalCss texture/`bp-hero`/`bp-card`), components (service `template` + View→PDF
modal, hero-slider widget on inauguration, lightbox rule, functional `sw-form` on contact),
container/whitespace discipline. Token cost: two agent rounds ~636K + ~611K output tokens (~80K/page).

**Roadmap (tasks #42–47):** 1) prompt-loop scaffold · 2) foundation extractor · 3) MCP agent tooling ·
4) asset reorg · 5) UI swap + deprecate mechanical nativizer · 6) end-to-end validation.

**Step 1 DONE — prompt-improvement loop scaffold:**
- [pipeline.md](./pipeline.md) — canonical spec.
- [author-brief.md](./author-brief.md) — v3, 23 numbered rules (Rn) + self-lint checklist + structured
  `selfLint` output contract; foundation-owned concerns (fonts/colors/nav) split out; `{{> hero-slider}}`
  mandated; asset naming rules; agents query the primitive registry.
- [defect-taxonomy.md](./defect-taxonomy.md) — 13 categories ↔ rules (+ `MISSING-RULE`), 3 verify-phase
  rules (V1–V3, incl. the stale-render trap), loop bookkeeping.
- [golden-snippets.md](./golden-snippets.md) — 8 verified copy-paste patterns (criticalCss foundation,
  data-driven nav, service template + View modal, hero-slider, contact bg+overlay+form, lightbox, card grid).

**Step 2 BUILT + TESTED (commit blocked — see below):**
- `packages/site-import/src/transform/foundation.ts` — deterministic extractor: `extractColors`
  (foreign `--*-color` vars → SW tokens), `extractTypography` (resolve heading/body families, match the
  self-hosted woffs → native `identity.typography` `source:'asset'` slots — the PROPER path, no
  criticalCss `!important`), `foundationCriticalCss` (body bg + `.bp-hero` + `.bp-card`),
  `nativeTopNav` (`{{#each nav.header}}` data-driven), `nativeFooter`, `configurePageNav`, `applyFoundation`.
- Wired into `build.ts` as OPT-IN (`TransformOptions.foundation`, default off → import unchanged); when on,
  it sets theme+fonts+native chrome+page-nav and discards the foreign stylesheet/scripts. `collectHostedFonts`
  parses the font assetId from the hosted media path. New diagnostic `foundation-applied`.
- Exported from `index.ts`. `types.ts` flag + diagnostic added.
- TESTS: `test/foundation.test.ts` (11 unit) + 2 integration cases in `test/build.test.ts`. Full
  site-import suite green: **222 passed**; my files typecheck clean.

**PILE RESOLVED + REBASED ONTO CURRENT MAIN (per direction).** The ~22-file pile was OBSOLETE
prior-session working-tree cruft, superseded upstream by **#485–489** (nav consolidation, hero-slider
caption fix, snippets). Discarded it; the working branch is now `nativize/clone-pipeline-current`, off
`origin/main` (`79f7df9`). Foundation re-applied onto current main and ALIGNED to **#486's new nav model**:
the single `website.mainNav` slot replaced `topNav`/`mobileNav`; `nativeMainNav` models the global
`navbar` recipe (`.navbar` + `.menu.menu-horizontal` + `.dropdown-hover`, `{{#each nav.header}}`); page
nav slots back to `['header']`. (A stale local `dist/` first masked this — rebuilt schema/core/blocks/
tailwind, then green.) Full site-import suite **222 passed**, typecheck clean.

> Note: `golden-snippets.md` F2 (data-driven nav) still shows the older `topNav`/`mobileNav` slot names —
> update to `mainNav` when convenient (the live foundation code is correct).

**Steps 1 + 2 DONE on `nativize/clone-pipeline-current` (off current origin/main).**

**Next:** Step 3 — agent tooling via MCP (media-management tools + headless service-token auth).

---

## 2026-06-27 — Step 3 recon (MCP surface)

MCP tools live in `packages/mcp/src/server.ts` (+ `client.ts`) over `apps/api/src/http/mcp-routes.ts`.
Findings:
- **Headless auth is ALREADY solved** — `packages/mcp/src/auth.ts` `staticAuth(token)` boots the bridge
  non-interactively from a fixed bearer (a project API key / PAT). So the "headless service-token auth"
  gap is effectively closed; the clone agents connect with a scoped project key. (No new auth work needed.)
- **Agent toolset already present:** whoami, get_components, get_guide, get_reference, list_pages,
  get_page, get_content/list_content, put_page, put_content, preview_page (the multi-device screenshotter),
  list_media, import_image_url (takes a `folder`), import_stock_image, revisions, get_published.
- **The real Step-3 gap = media MANAGEMENT tools:** there is NO MCP tool to create/rename a media folder
  or move/rename an existing asset (only list + import). These are needed for the per-page asset-org
  (Step 4). The HTTP side already has `/media/folders` (create/rename/copy) + `/media/:id/copy`; need to
  confirm an asset move/rename endpoint, add `client.ts` methods, and `registerTool` wrappers
  (e.g. `create_media_folder`, `move_media`, `rename_media`), gated `content:write`.

Step 3 narrows to: add the media-management MCP tools (+ any missing HTTP endpoint) with tests.
