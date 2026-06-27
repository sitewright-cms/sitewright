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

## 2026-06-27 — Step 3 DONE (commit `eca4960`)

Added four capability-gated MCP tools (no new HTTP endpoints needed — the `/media/folders` +
`PATCH /media/:id` routes already existed):
- `list_media_folders` (content:read), `create_media_folder`, `rename_media_folder`, `move_media`
  (content:write). Client methods in `client.ts`, registrations in `server.ts`, entries in
  `MCP_TOOL_CATALOG` (the no-drift test passes), folder paths validated with `MediaFolderSchema`.
- Documented in the **images** agent guide with the per-page / count-justified convention.
- Tests: server.test.ts (gating + forwarding + invalid-segment reject) + client.test.ts (paths/bodies).
  MCP **76 passed**, schema **240 passed**, typecheck clean.

The screenshotter (`preview_page`), reference (`get_components`/`get_guide`/`get_reference`), and
headless auth (`staticAuth`) already existed — so Step 3 is complete.

## 2026-06-27 — Step 4 RESOLVED (agent-phase, not mechanical)

Per-page / count-justified asset organization is inherently an **authoring judgment** (gallery vs
one-off hero vs sitewide singleton) that needs page context — which the **agent** (Phase B) has and the
ingest MediaPort does not (its `hostAsset` callback never sees the referencing page; threading it would
be an engine API change to the soon-retired mechanical importer). So Step 4 is delivered as an
**authoritative, enforceable agent rule**, not new ingest code:
- `author-brief.md` **R21** (reorganize the transient `imported/*` tree → per-page folders, count
  justified, `Header Images` / `Main`, slugified names — now naming the actual MCP tools) + **R22** (prune).
- `defect-taxonomy.md` **C-ASSET** maps bad asset trees back to R21/R22 (so the prompt-improvement loop
  catches regressions), and the **images** guide carries the same convention for any SW agent.
- Tools to act on it shipped in Step 3.

Decision: intentionally NOT changing the mechanical ingest foldering (`importMediaFolder`'s
`imported/<dir>` mirror) — it's a transient starting tree the agent flattens, and that code path is
slated for retirement in Step 5.

**Steps 1–4 DONE on `nativize/clone-pipeline-current`.**

## Steps 5 + 6 — need decisions / a live environment (paused for input)

- **Step 5 (UI swap, retire mechanical nativizer)** removes a SHIPPED feature (the "Import a website" UI
  + `render/nativize-project`) and introduces the "Clone a website with AI" UX — a product decision with
  real consequences (and orchestration design: who drives the AUTHOR agents, and from where).
- **Step 6 (end-to-end validation)** needs a live instance + a real target site + an agent run, then a
  defect-report pass feeding the prompt loop — not completable purely in-repo.

These match the user's "stop for meaningful decisions / blockers" bar — surfaced for direction.

## 2026-06-27 — Step 5 DONE (decisions taken)

User decisions: (1) post-clone = **AI handoff message now, but lay foundations for a future in-app AI
agent / dedicated AI-runner container** (claude-cli/codex on cheaper subscription tokens); (2) mechanical
nativizer = **hide UI, keep route dormant, delete after Step 6**.

Shipped:
- `feat(api) 2691846` — opt-in `?foundation=1` on the crawl + upload import routes → runs the foundation
  pipeline end-to-end (default off → raw import unchanged). +2 tests.
- `feat(editor) bb56320` — menu + modal renamed **"Clone a website with AI"**; the import always sends
  `?foundation=1`; the mechanical **Nativize step removed** from the modal; report step ends on an
  `Author with AI` handoff (`NextStepAuthorWithAI` — the documented seam for a future in-app runner). The
  `/nativize/stream` route + `nativizeProject` stay registered-but-unreachable (dormant). Tests updated.
- `docs(pipeline) §5` — records both decisions + the in-app-runner roadmap/seam.

Verified: site-import 222, schema 240, mcp 76, api import-routes 23, editor modal+app 17 — all green;
schema/mcp/api/editor typecheck clean.

**Steps 1–5 DONE on `nativize/clone-pipeline-current`.**

## Step 6 — end-to-end validation (needs a live instance)

Not completable purely in-repo: needs a running instance, a real target site, a `?foundation=1` clone,
an AUTHOR-agent pass over the imported pages via MCP, then a render-diff/defect audit feeding the
prompt loop. The reusable spike harness (`_render.mjs` etc., §8) + the burmeister reference remain the
template. Pending a live environment (shared DinD :2003 redeploy or local) to run against.

## 2026-06-27 — Step 6 RAN on live :2003 (#492 merged → main-38ab637 deployed)

Pushed #492 → CI green (after fixing a tsc-only test type error vitest missed) → squash-merged →
rebuilt the `:2003` image from an `origin/main` worktree → swapped the container (reused key + sw-data
volume) → healthy. Then cloned **burmeister.com.na** with `?foundation=1` (4 pages) end-to-end via the
live route. **PASS** on the core foundation:
- `identity.colors` exact vs ground truth: primary `#B42A33`, secondary `#565656`, accent `#880088`,
  base-content `#222222`, **base-200 `#CCCCCC`** (the captured page bg — the review fix), → `criticalCss`
  body `background-color:#CCCCCC`. ✓
- foreign `head`/`scripts` empty (CSS/JS discarded); `mainNav` 1870c, `footer` 774c, `criticalCss` 1215c. ✓
- `foundation-applied` diagnostic emitted; 18 images self-hosted, 24 scripts dropped. ✓

**DEFECT FOUND + FIXED (font extraction):** `typography` came back EMPTY (`no-fonts`) even though the
woffs were self-hosted (primary-font, secondary-font, FontAwesome). Root cause (reproduced locally
against the real CSS): (A) `familyForSelectors` didn't strip `!important` → garbage family; (B) the brand
applies its heading font via a `.primary-font` **class**, not `h1/h2`, so the selector scan missed it;
(C) the body woff `text-font` wasn't among the hosted fonts; (D) `FontAwesome` (an icon font) polluted
the candidate pool. Fix in `transform/foundation.ts`: resolve roles from semantic `--*-font` vars
(`FONT_VAR_MAP`) before selector-scanning, strip `!important` (shared `familyName` helper), and exclude
icon fonts. Now resolves heading=primary-font, body=secondary-font (via the unhosted-body fallback).
+4 unit tests; site-import 224 green. Shipping as a follow-up PR (then a 2nd `:2003` redeploy to confirm
fonts populate live).

Known limitation (not fixed here): the crawler didn't self-host the `text-font` woff (only primary/
secondary/FontAwesome) — the body falls back to the other brand face. A separate font-capture issue.
