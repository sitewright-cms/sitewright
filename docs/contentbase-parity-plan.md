# Sitewright — contentBase Parity & Improvement Plan

> Status: proposed (2026-05-30). This plan brings Sitewright to functional parity with the
> battle-tested **contentBase** agency CMS and fixes its identified deficiencies. It supersedes
> the thin from-scratch editor MVP. See `docs/architecture.md` for the current system and the
> memory notes `sitewright-contentbase-predecessor` / `sitewright-oss-landscape` for background.

---

## 0. Product thesis

Sitewright is the **OSS, AI-native rebuild of contentBase**: a multi-tenant CMS for web-dev
agencies that **exports** static sites (ZIP / FTPS / SFTP / SSH) to the customer's own webspace —
it does not host them (preview only). It must run in a **single lean container**, be low on
resources, produce **high-Lighthouse** output, and ship under **Apache-2.0**.

contentBase is the proven spec. The deficiencies we explicitly fix:

| contentBase pain | Sitewright fix |
|---|---|
| Page skeletons hand-coded in HTML + Handlebars + **PHP**; ~1–2 weeks/site | Platform-managed, **data-driven** skeleton; **AI** generates structure/data/tokens |
| Per-tenant `eval()` everywhere (php_code, global_head, critical_css, partials) | **No per-tenant code execution.** Logic-light **sandboxed** templating + data-driven chrome |
| Directus backend no longer OSS; outdated stack | Clean **Fastify + Drizzle + SQLite + React**, license-clean |
| End-user editor too limited | Richer **constrained inline editor** + AI-assisted editing for client tier |
| Token usage unoptimized (no skeleton/content/image strategy) | Clear **skeleton + dataset + brand-token** model → AI emits JSON, not styled HTML; re-themeable without regeneration |
| Bespoke CSS framework, ad-hoc styling | **Tailwind** utility layer with brand tokens as theme; critical CSS inlined |

---

## 1. Target architecture

### 1.1 Three-layer rendering (the contentBase model, made safe)

```
Platform skeleton  (Sitewright code — identical for every tenant, parameterized by data)
 ├─ <head>: brand :root tokens (Style Dictionary) · @font-face (web-safe detection)
 │          · Tailwind theme · critical CSS inline · deferred utils · meta/OG · favicon
 │          · custom head HTML (analytics) · auto schema.org JSON-LD (from company.*)
 ├─ <body>:
 │    • preloader / top-nav / mobile-nav partials          ┐ slot-filled from website settings
 │    • <main> ◄══ inner page content (blocks/templates) ══╪══ the only per-page authored region
 │    • sidebars / bottom-bar / footer / contact-modal     ┘ (global OR project-scoped partials)
 │    • custom footer HTML (analytics) · scripts
 └─ rendered via a SAFE expansion engine over company.* / website.* / page.* + datasets
```

Only the inner `<main>` is authored per page. All chrome is **composed from data + selected
partials**. This is what makes "fill data → pick partials → write main content" fast, and it is
what AI generates into.

### 1.2 Expansion engine (replaces `preProcess()` + PHP `eval`)

- A **logic-light, sandboxed** template layer (Handlebars-style) with a **fixed, allow-listed
  helper set** (`if`, `each`, `with`, `eq`, url/asset helpers, money/date format, etc.).
- Variables: `company.*`, `website.*`, `page.*`, plus `company.data` / `page.data` /
  `website.data` (datasets). Partial includes resolve global → project scope.
- **No `Function`, no `eval`, no arbitrary JS/PHP.** This removes the multi-tenant code-exec
  surface entirely → no untrusted build code → the sandboxed build worker stays optional and the
  in-process build remains ~56 MiB / sub-second (validated by earlier benchmarks).

### 1.3 Styling: Tailwind + brand tokens + self-contained partial CSS

- **Tailwind** replaces contentBase's bespoke utility framework. Brand identity (colors/fonts/
  spacing) is exposed as **Tailwind theme tokens** (`@theme` → CSS custom properties), so
  `bg-primary`, `text-secondary`, `font-display` map to `--color-primary` etc. — the per-project
  corporate identity drives the utility palette.
- **Partials and templates remain self-contained**: their component CSS lives in their own inline
  `<style>` (as in contentBase), and they may also use Tailwind utilities. Both coexist.
- **"Critical CSS"** (website setting) = project-wide CSS inlined in `<head>` (kept).
- **Build step:** at export, Tailwind scans the fully-rendered HTML (skeleton + partials + content)
  for used classes and emits a **purged, minimal** stylesheet; the critical subset is inlined and
  the remainder deferred. Output stays framework-free at runtime (no JS framework; tiny CSS) →
  preserves Lighthouse. Tailwind v4 (Oxide) is fast; build-memory impact to be measured.

### 1.4 Preview isolation (because custom head/footer HTML is allowed)

Tenants can inject arbitrary head/footer HTML (analytics, pixels) — legitimate for *their own*
exported site. To keep that from touching the editor session, previews render in a **sandboxed
iframe** with a strict CSP, so injected JS cannot read the platform's cookies or DOM. *(Decided:
sandboxed iframe — not a separate preview origin.)*

### 1.5 Portable relative links + temporary publish location

Sites must work **both** at the temporary preview path and at the customer's eventual webspace
(root or any subfolder). So **all site-internal links are relative**, never absolute:

- A per-page **`root`** variable (contentBase's `$root` / `dirOffset`) = the relative path from the
  current page back to the site root: `./` for the homepage, `../` one level deep, `../../` two, etc.
  (generalizes the existing `'../'.repeat(slugDepth(slug))` media-URL logic to *all* internal links).
- Navigation, page-to-page links, asset/media references, and partials all prefix with `{{root}}`,
  so the exported output is location-independent.
- **Temporary publish / preview** renders to **`/sites/{customer-slug}/`** (served by the API for
  preview only); because links are `root`-relative, the *same artifact* works unchanged when exported
  to the customer's webspace root or any subfolder.

---

## 2. Data model (Drizzle / SQLite)

Content kinds (shared-DB, row-level tenant scoping). **Scope** axis added: `global` (platform/
agency-wide) vs `project` (per customer). Project scope overrides global on name collision.

| Kind | Key fields | Scope | Notes |
|---|---|---|---|
| `project` | brand/company identity (names, slogan, schema.org type, colors[6], fonts[4], logo/icon/image/video, address+GPS, social links), `company.data` JSON | project | the `company.*` namespace |
| `website` (settings) | slug, url, container_width, icon_font, **critical_css**, **custom_head**, **custom_footer**, partial slot assignments, sitemap, mailer, back-to-top, export config, `website.data` ref | project | the `website.*` namespace |
| `page` | title, meta, nav_title, parent/path, OG image, **nav_visibility[slots]**, template ref, empty-page flag, language, status, content tree | project | multilingual tree; the `page.*` namespace |
| `partial` | slot type, HTML + inline CSS, vars | **global + project** | nav/footer/sidebar/etc.; auto-nav helper |
| `template` | HTML + inline CSS, variables (JSON) | **global + project** | reusable page layouts (blog/rooms/tours) |
| `snippet` | category, HTML block | **global + project** | copy-paste block library (seed from HyperUI) |
| `dataset` / `entry` | typed collection + rows | project (company + per-page) | JSON tree editor; binds into blocks/partials |
| `media` | variants (AVIF/WebP/JPEG/LQIP), folders | project | optimize-at-upload (exists) |
| `deploy_target` | encrypted FTPS/SFTP creds | project | exists |
| `user` / `membership` | role (admin/developer/client), project assignment | org/project | 3-tier; client tier constrained |
| `ai_usage` | org, user, project, model, tokens_in/out, cost, ts | org/user | metering + quota enforcement (new) |

---

## 3. Feature parity matrix

| contentBase capability | Sitewright status | Phase |
|---|---|---|
| Export: HTML buffer + asset bundling + FTPS/SFTP/zip | ✅ built | — |
| Optimize-at-upload image pipeline (AVIF/WebP/JPEG/LQIP) | ✅ built | — |
| Multi-tenant, tenant-scoped CMS, sessions/roles | ✅ built | — |
| Data-driven outer skeleton (head/tokens/chrome/schema.org) | ❌ build | 1 |
| Brand tokens → CSS vars + Tailwind theme | ⚠️ partial (colors only) | 1 |
| Critical CSS inline + custom head/footer HTML | ❌ build | 1 |
| Company / Website / Page namespaces + corporate identity model | ⚠️ partial | 2 |
| Page settings (nav-visibility per slot, template, status, lang) | ⚠️ partial | 2 |
| Multilingual page trees | ❌ build | 2 |
| Partials w/ slots, **global + project scope**, auto-nav, self-contained CSS | ⚠️ partial | 3 |
| Templates **global + project**, with variables | ❌ build | 3 |
| Snippet/block library (seed HyperUI, W3C nav) | ❌ build | 3 |
| Inner-content hybrid editor (blocks + token/dataset binding + raw-HTML escape) | ⚠️ partial | 4 |
| Constrained client WYSIWYG (editable regions) | ❌ build | 4 |
| Datasets: company-global + per-page JSON tree editor + binding | ⚠️ partial | 4 |
| AI: CLI (claude-cli dev/preview) | ❌ build | 5 |
| AI: online API editing for end users | ❌ build | 5 |
| AI token metering + per-user quota/limits | ❌ build | 5 |
| Attractive interactive editor UX (transitions/hover/mobile) | ❌ build | 6 |
| Dev utilities (image tools, color/gradient/icon pickers) | ❌ build | 6 |
| contentBase → Sitewright importer | ❌ build | 7 |

---

## 4. Phased roadmap

Each phase follows the standing standards: **TDD (RED→GREEN→REFACTOR)**, ≥80% coverage,
unit + integration + **Playwright E2E**, local **DinD** deploy + E2E, code-review +
security-review per PR, CI guards (`pnpm audit --audit-level high`), conventional commits.

### Phase 1 — Data-driven skeleton + tokens + Tailwind + critical CSS *(foundation; removes eval)*
**Deliverables**
- Extend `renderDocument` into the platform skeleton: `<head>` with brand `:root` tokens, @font-face
  (web-safe vs URL detection), meta/OG/favicon, **critical CSS inline**, **custom head/footer HTML**,
  **auto schema.org JSON-LD** from company data, deferred asset loading.
- **Style Dictionary** integration: per-project token JSON → CSS vars + **Tailwind theme**.
- **Tailwind build** wired into the export/preview pipeline (scan rendered HTML → purge → inline
  critical + defer rest). Measure build memory/time delta.
- Chrome slot composition (renders selected partials around `<main>`), all via the **safe expansion
  engine** (new) — explicitly **no `eval`/`Function`**.
**Tests first:** token→CSS var mapping; @font-face safe/url branches; schema.org JSON-LD shape;
custom head/footer injection + escaping; expansion engine helper allow-list + injection attempts;
Tailwind purge correctness; critical-vs-deferred split.
**Acceptance:** a project with brand colors/fonts renders a themed page with correct `:root`,
schema.org, custom analytics tags, purged Tailwind, inlined critical CSS — with zero per-tenant code
execution. Lighthouse ≥ 95 on a sample page.

### Phase 2 — Company / Website / Page IA
**Deliverables**
- Corporate-identity model (`company.*`): names, slogan, schema.org type, 6 colors, 4 fonts,
  logo/icon/image/video, address+GPS, social links, `company.data`.
- Website settings (`website.*`): slug/url, container width, icon font, critical CSS, custom head/
  footer, partial slot assignments, sitemap/mailer/back-to-top, export config.
- Pages (`page.*`): settings (title/meta/nav-title/parent-path/OG/status/template/empty-page),
  **nav-visibility per slot** (header/footer/mobile/custom/dropdown), **multilingual page trees**.
- Editor SPA: COMPANY / WEBSITE / PAGES tabs.
**Tests first:** namespace resolution; nav-visibility → nav inclusion; multilingual tree
expansion (route generation per locale); page-settings validation.
**Acceptance:** the three-tab IA edits all namespaces; multilingual page tree exports correct
per-locale routes; nav reflects per-page visibility.

### Phase 3 — Partials, Templates, Snippets (global + project scope)
**Deliverables**
- Partial model: **slot-typed**, self-contained HTML + inline CSS, **global + project scope**,
  resolution order project→global; **auto-nav helper** (loops page tree + nav-visibility).
- Template model: HTML + inline CSS + **variables**, global + project; "Use Template" on a page.
- Snippet library UI + seed catalog **ported from HyperUI (MIT)** and **W3C APG nav**, re-expressed
  through brand tokens / Tailwind.
- Preset libraries for each slot (top/mobile nav, sidebars, footer, modal, preloader, effects).
**Tests first:** scope resolution + override; auto-nav generation; template variable binding;
snippet insertion; partial CSS isolation in preview.
**Acceptance:** a project can override any global partial/template with a project-scoped one;
auto-generated nav matches the page tree; templates mass-produce dataset-driven pages.

### Phase 4 — Inner-content hybrid editor + datasets + client editing
**Deliverables**
- Hybrid content model: typed blocks **bound to brand tokens + datasets**, plus a **raw-HTML/
  template escape-hatch block**; "Empty Page" bypasses skeleton for full-custom landers.
- **Constrained client WYSIWYG**: editable-region markers (the `data-cb-text`/`data-cb-html`
  equivalent) so the client tier edits only marked text/rich-text/image zones.
- Datasets: **company-global + per-page JSON tree editor**; binding into blocks/partials/templates
  (`each page.data.vehicles`).
- Live split preview (code/blocks + sandboxed preview, responsive viewports).
**Tests first:** block→HTML render with token/dataset binding; editable-region enforcement
(client cannot edit outside marked zones); dataset tree validation; binding expansion.
**Acceptance:** developer builds structured content + datasets; client edits only allowed regions;
dataset-driven template renders a collection (e.g. vehicles/rooms).

### Phase 5 — AI pillar (two surfaces) + token governance
**Two distinct AI surfaces (cost-separated):**
- **CLI / developer (cheap):** the `sitewright` CLI drives **claude-cli (Claude Code)** locally to
  develop & preview sites — generate skeleton data, partials, templates, content blocks, datasets;
  run local preview (DinD `0.0.0.0:2000–2010` / `dind.local`). Tokens billed to the developer's own
  Claude subscription, not the platform.
- **Online / end-user (metered):** **Claude API** via the platform for in-editor generation/editing
  (client + agency tiers). Expensive → must be governed. **Agency-funded: one global agency API key**;
  the platform meters all end-user usage against it and enforces per-user/per-org quotas so no single
  client can drain the agency's budget.
**Token governance (required):**
- `ai_usage` ledger (org/user/project/model/tokens/cost/ts).
- Per-user and per-org **quotas** (monthly budget + rate limit); **hard + soft limits**; enforcement
  middleware blocks calls past the cap with a clear message; usage dashboard.
- **Model tiering** per operation (Haiku for cheap/bulk edits; larger models for generation).
- **Token-minimizing generation contract:** AI emits **JSON** (blocks/datasets/token refs), reuses
  skeleton/partials, references existing media by id — never re-emits styled HTML or image bytes.
- Provider abstraction (pluggable; Anthropic default) behind a `BuildRunner`-style seam.
**Tests first:** usage accounting; quota enforcement (block at hard cap, warn at soft); rate limit;
model-tier selection; structured-output validation; prompt-injection/output sanitization.
**Acceptance:** CLI generates+previews a site locally with no platform token cost; online editing
meters every call, enforces per-user limits, and rejects over-quota with a clear UX.

### Phase 6 — Editor UX polish + dev utilities
**Deliverables**
- **Attractive, interactive, mobile-optimized** editor UI: motion/transitions, hover states,
  responsive layout, keyboard/a11y, empty/loading states, polish pass across all tabs/modals.
- Dev utilities (the contentBase SYSTEM panel): image resizer/optimizer, color/gradient/clip-path
  generators, Google-font + FA/Material icon pickers, JSON/email editors.
**Acceptance:** a usability pass; the editor feels modern and responsive on mobile; utilities speed
common dev tasks.

### Phase 7 — contentBase importer (migration)
**Deliverables**
- Importer mapping contentBase `_data/*.json` (company/website/pages/partials/templates) → Sitewright
  model; media import; **AI-assisted conversion of PHP/eval partials → safe templates** (flag any
  that need manual review).
**Acceptance:** an existing contentBase project imports into Sitewright and exports an equivalent site.

---

## 5. Cross-cutting: security & quality

- **Eliminate per-tenant code execution** (no `eval`/`Function`/PHP); sandboxed expansion engine with
  an allow-listed helper set.
- **Preview isolation**: sandboxed iframe + CSP (and/or per-project preview origin) so tenant-supplied
  head/footer/analytics JS can't reach platform cookies/session.
- **Output escaping** by default in the expansion engine; raw HTML only via explicit, audited blocks
  (escape-hatch block, custom head/footer) which target the tenant's *own* exported site.
- **Tenant isolation** across the new project-scoped partials/templates/datasets (row-level scoping,
  no cross-project reads).
- **AI**: prompt-injection hardening, output validation against schemas, secret-free worker, rate
  limits, quota enforcement.
- **Gates**: ≥80% coverage; `pnpm audit --audit-level high`; **Lighthouse-CI gate** (high scores are a
  product promise); code-review + security-review per PR; DinD E2E before merge.

## 6. Key decisions locked by this plan

1. Three-layer rendering: **platform skeleton (data-driven) + slot partials + inner content**.
2. **No per-tenant code execution** — sandboxed, logic-light templating only.
3. **Tailwind** as the utility layer; **brand tokens as Tailwind theme**; partials/templates keep
   self-contained inline `<style>`; project-wide "critical CSS" inlined; custom head/footer HTML kept.
4. **Partials, templates, snippets are scoped global + project** (project overrides global) for total
   per-project design freedom.
5. **Two AI surfaces**: CLI via claude-cli (cheap, developer dev/preview) vs online Claude API
   (expensive, end-user) — the latter **metered + quota-limited per user/org**.
6. Keep the research-validated core (export pipeline, optimize-at-upload images, multi-tenancy,
   single container); no fork, no AGPL/source-available dependency.

## 7. Open questions / risks

- Tailwind-at-export build cost (memory/time) — measure during Phase 1; mitigate with caching of the
  per-project purge if needed.
- Editable-region model fidelity vs contentBase's `data-cb-*` — confirm the markup contract in Phase 4.
- Scoping UX for global-vs-project partials/templates (clarity of override).
- ✅ RESOLVED: **agency-funded** — one global agency API key; platform meters all end-user usage
  against it and enforces per-user/per-org quotas so no single client drains the agency budget.
  (Per-seat default caps still TBD.)
- ✅ RESOLVED: **single sandboxed iframe** (+ strict CSP) for preview isolation.
- ✅ RESOLVED: **all site-internal links relative** via a per-page `root` var; temporary publish to
  `/sites/{customer-slug}/`. Generalize the existing relative media-URL logic to all internal links.
