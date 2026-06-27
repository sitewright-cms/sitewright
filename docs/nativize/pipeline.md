# AI Clone / Nativize Pipeline — canonical spec

> Status: design + spike-proven (burmeister-native, project `F45xZmYIGBaj`). Not yet productionized.
> Living document. Progress is tracked in [progress.md](./progress.md).
> Related: [author-brief.md](./author-brief.md) · [defect-taxonomy.md](./defect-taxonomy.md) · [golden-snippets.md](./golden-snippets.md)

## 1. Goal

Turn an arbitrary external website into a **clean, native Sitewright project** that meets five bars:
1. **Clean code handoff** — readable native SW (Handlebars + Tailwind + DaisyUI + theme tokens + SW
   directives/components); zero foreign CSS/JS/classes; well-named assets in a sensible tree.
2. **Faithful** to the original design at desktop AND mobile.
3. **Snaps to SW** features/architecture (datasets, templates, data-driven nav, components, forms).
4. **Automatic content editing** — copy wrapped in `data-sw-*`; data in datasets/page-vars.
5. **Full redesign** possible after the port (because it's native code, not a foreign-DOM transform).

The mechanical per-page nativizer (computed-style → Tailwind) cannot meet these for sophisticated
sites. The proven approach is **mechanical for ingest/scaffold, AI for layout, render-diff to verify.**

## 2. Architecture — a 3-phase hybrid

```
URL ─▶ [A] INGEST + FOUNDATION (deterministic)  ─▶ [B] AUTHOR (AI agents)  ─▶ [C] VERIFY (tooling + gate)
        crawl · self-host assets · extract           per-page native bodies      render-diff vs original
        fonts/colors/chrome · clean asset tree        via the SW MCP toolset      structured defect report
```

Mechanical does everything **deterministic**; agents do the **irreducibly creative** layout work;
tooling makes it **trustworthy**. Each phase is a real, repeatable step — not hand-run scripts.

### Phase A — INGEST + FOUNDATION (code, no AI)

**Ingest** (exists: `/projects/:id/import/website/stream`): crawl, self-host binary assets
(images/fonts/PDF/video), capture datasets from repeated content, capture per-page reference
screenshots, fetch the foreign CSS **transiently**.

**Foundation extractor** (NEW committed tool — replaces the hand-run `_css.mjs`/`_chrome3.mjs`/`_navfix.mjs`):

| Input (transient foreign CSS / DOM) | Output (persisted, native) |
|---|---|
| `@font-face` + `--*-font` vars | register woffs as font assets → `identity.typography` + `criticalCss` `@font-face` |
| `--primary/secondary/…-color` | `identity.colors` (primary, secondary, …) |
| nav/footer DOM | **data-driven native chrome** (`{{#each nav.header}}` from the page tree; footer offices) |
| hero/`.bm-header` texture asset | `criticalCss` `.bp-hero` background (real asset, exact) |
| foreign `head` / `scripts` / `styles.css` blobs | **DISCARDED** |

**Do we keep foreign CSS/JS?** CSS: only **transiently, for extraction; never shipped.** JS: **dropped
entirely** (nothing to mine — behavior is re-expressed with SW primitives). Only binary assets persist.

After Phase A the project has: correct theme + fonts + colors, native chrome, a clean asset tree, and
**zero foreign CSS/JS**.

### Phase B — AUTHOR (AI agents, orchestrated)

Per page, an agent: reads the reference screenshot + imported content → authors a clean native body
using SW primitives → screenshots it (multi-device) → self-lints + render-diffs against the original →
iterates → returns a structured report. Driven by the **versioned [author-brief](./author-brief.md)**.
Agents **query the live primitive registries** (`get_components`/`get_reference`/`get_guide`) rather
than a hand-copied contract list, so they always use current primitives. Repeating layouts collapse to
a `template` + per-page `page.data`; repeating content to datasets + `{{#each}}`.

### Phase C — VERIFY (tooling + gate)

Committed render-diff harness → a **structured per-page defect report** (tagged by
[defect-taxonomy](./defect-taxonomy.md)) → a final audit gate before "done." The author who declares
faithfulness is never the only verifier — an independent render-and-compare is mandatory (a hard rule
learned the hard way; agent self-reports drift toward optimistic).

## 3. Asset organization (per-page, count-justified)

Never leave one flat `_assets/<uuid>` blob. Group by the **page** that uses the asset, and create a
folder only when the count justifies it:

- **Dedicated page/gallery folder** — when a page has a *cluster* of related files (a picture gallery,
  a team grid; heuristic ≈ 3+). Named for the page/gallery, e.g. `Inauguration Gallery`, `Management Team`.
- **Shared role folder** — for a single asset that recurs once per page (e.g. each page's one
  header/hero image) → collect into e.g. `Header Images`.
- **`Main`** — sitewide singletons / unsorted single files (logo, favicon, icons, the hero texture).
- **Naming** — slugified subject, never a bare UUID: `agri-industrial-hero.jpg`, `ronald-kubas.jpg`.

Mechanical does a first-pass filing by referrer; the authoring agent refines names + prunes unreferenced
files using the media-management tools (§4). End state: a tree a human dev can read at a glance.

## 4. Agent tooling — via the SW MCP server (dogfooding)

The nativize agents use the **same MCP toolset the platform exposes to any AI assistant** building a SW
site. If it's good enough for our hardest internal job, it's good enough for end-users — and every
improvement helps both surfaces.

| Need | Tool | Status |
|---|---|---|
| Multi-device screenshotter | `preview_page` (server-rendered desktop+mobile JPEGs) | exists — replaces local `_render.mjs` |
| SW reference library | `get_components` / `get_reference` / `get_guide` | exists — agents query, brief stays lean |
| Content authoring | `put_content` / `get_content` / `list_content` | exists |
| Media management | folder create/rename, asset move/rename/upload | **gap — HTTP routes exist; expose via MCP** |
| Original to match | per-page reference screenshots (stored in Phase A) | new, cheap |

Gaps to close in Step 3: (a) **media-management MCP tools**; (b) **headless service-token auth** so
orchestration agents call MCP non-interactively. Then retire the local `_render.mjs`/`curl` stack.

## 5. UX change — retire the mechanical importer surface

A mechanical "import website → messy scaffold" button shouldn't be user-facing once the product is the
AI clone:
- **UI:** replace "Import a website" with **"Clone a website with AI."** Crawl/import become internal plumbing.
- **Deprecate** the mechanical per-page nativizer (`render/nativize-project`); keep only the ingest half.
- Import endpoints remain, used internally by the clone pipeline.

**SHIPPED (Step 5).** The editor menu + modal are now "Clone a website with AI"; the import always runs
the foundation pipeline (`?foundation=1` on both the crawl + upload routes). The mechanical `Nativize`
step is removed from the modal — the `/nativize/stream` route + `render/nativize-project.ts` stay
*registered but UI-unreachable* (dormant), to be **deleted in a follow-up after end-to-end validation**
(Step 6), per the hide-not-delete decision.

**Post-clone = AI handoff today, in-app runner tomorrow (decided).** The modal's report step ends on an
`Author with AI` block (`NextStepAuthorWithAI`) that guides the user to their OWN connected AI assistant
(the platform has no in-app agent runtime). That block is the deliberate **seam** for the chosen future
direction: an in-app AI agent — or a dedicated **AI-runner container** (claude-cli / codex / others,
driven on cheaper subscription tokens) — that runs the AUTHOR agents *inside* the platform against the
same MCP toolset. The foundations for that are already in place (the MCP toolset + the deterministic
foundation pipeline); only the orchestrator/runner is future work. Do NOT hardcode "external assistant"
anywhere that would block swapping in an in-app runner at that seam.

## 6. Prompt-improvement loop (quality compounds across sites)

See [author-brief.md](./author-brief.md) + [defect-taxonomy.md](./defect-taxonomy.md). Mechanism:
1. **Versioned brief** with numbered rules, each traceable to the defect that created it.
2. **Defect taxonomy** — every audited defect tagged by the rule it violated *or* the missing rule.
3. **Agent self-lint** — a checklist run inside the agent loop, catching violations before the audit.
4. **Golden snippets** — verified pages become copy-paste recipes; agents adapt, not re-derive.
5. **Primitive-coverage pass** — periodically diff the brief vs the catalog for under-used primitives.
6. **Brief-improver meta-pass** — mine transcripts + audit defects → propose brief edits; bump version.

## 7. Roadmap / sequence

1. **Prompt-improvement loop scaffold** (brief + taxonomy + self-lint + golden snippets) — the lever.
2. **Foundation extractor** as committed tooling.
3. **Agent tooling via MCP** (media tools + headless auth).
4. **Asset reorg** (mechanical filing + agent renaming, §3 rules).
5. **UI swap** + deprecate mechanical nativizer.
6. **Validate end-to-end** on a real site; route defects back through the loop.

## 8. Reference implementation (the spike)

Project `burmeister-native` (`F45xZmYIGBaj`): all 19 pages native + verified (desktop+mobile). Hand-run
scripts under `apps/api/_*.mjs` (`_css`, `_chrome3`, `_navfix`, `_svctpl`, `_home3`, `_inaug`,
`_contact`, `_author`, `_render`) are the prototype each productionized step replaces. Captures/working
state under the session scratchpad `native/`. See the memory note `native-clone-authoring-recipe`.

## 10. Compare-to-source: the self-correction loop (the missing capability)

The hand-clone failures proved agents (human or MCP) CANNOT reliably self-verify visual fidelity by
"looking at their own render." The fix is a TOOL that puts build next to source and MEASURES the gap,
plus prompts that make using it mandatory. This is the reproducible system; the non-MCP agent's job is
to build this tooling + the prompts, not to hand-clone.

**Decisions (2026-06-27):**
- **No foreign JS/CSS import.** The AI-clone flow imports BINARY ASSETS ONLY (images/fonts/docs) + the
  source reference screenshots. Foreign CSS/JS are never hosted (R30 already skips them in foundation
  mode). The compare-to-source reference replaces the old literal-CSS scaffold.
- **Imported assets land in the ROOT folder** (no `imported/<dir>` mirroring); the author agent regroups
  them per R21. (Change `importMediaFolder` → `''` in foundation mode.)
- **Single sequential AUTHOR agent**, not parallel per-page — one agent retains memory/conventions across
  the whole site (datasets, chrome, tokens) and compares each page as it goes.

**Build spec:**
1. **Source reference capture (ingest).** Add `captureSourceShots(url, viewports)` to
   `apps/api/src/import/render.ts` — same pinned-route headless Chromium as `renderViaBrowser` (SSRF-safe),
   but `page.screenshot({fullPage})` at desktop + mobile. During the foundation import, screenshot each
   crawled page and store the shots (media in a reserved `__source__` folder, or a dedicated reference
   store) keyed by route; record `page.data.swImport.reference = { desktop, mobile }`.
2. **`compare_to_source` MCP tool** (+ HTTP route). Input: a page id (+ optional viewports). Server:
   renders the agent's BUILD via the existing `captureScreenshots(html, …)` path; loads the stored SOURCE
   reference shots; computes a **pixelmatch** difference (resize to common width) → a 0–1 diff score per
   viewport. Returns the build + source images **side-by-side as MCP image blocks** + the diff scores +
   page-height deltas. Register in `MCP_TOOL_CATALOG` (content:read), add `client.ts` method, document in
   the agent guide.
3. **Prompt/brief loop.** Author a page → `compare_to_source(pageId)` → enumerate the visible diffs from
   the side-by-side AND read the diff score → fix → repeat until the score is under a threshold (e.g. <8%).
   NEVER self-declare "faithful"; the diff score + the side-by-side ARE the verdict. Goes in author-brief
   (replaces the unenforceable "render-diff yourself") + the MCP agent import guide.

This makes the verification a tool call an agent cannot skip or fake — the structural fix for the
repeated "looked at my own render and called it faithful" failure.
