# Compatibility and stability

> **STATUS: DRAFT — not yet in force.** This document defines what Sitewright will promise at
> **1.0.0**. Until 1.0 is tagged, the pre-1.0 rule in [CHANGELOG.md](../CHANGELOG.md) still applies:
> *minor versions may include breaking changes.* Every **[DECIDE]** marker below is a call the
> maintainers have to make before this goes into force — see [Open decisions](#open-decisions).

Sitewright follows [Semantic Versioning](https://semver.org/). From 1.0.0 onward the version number
is a promise about the surfaces listed here, and nothing else:

- **MAJOR** — a documented Stable surface changed in a way that can break an existing instance,
  an authored site, an integration, or a stored project.
- **MINOR** — new capability; existing Stable surfaces keep working.
- **PATCH** — fixes only.

The unit of release is the **container image**, `ghcr.io/sitewright-cms/sitewright:X.Y.Z`. Nothing is
published to npm, so the workspace packages (`@sitewright/*`) are **internal** — see
[Not covered](#not-covered).

## How to read the tiers

| Tier | Promise | Change lands in |
|---|---|---|
| **Stable** | Will not break without a major bump and a documented migration path. | MAJOR |
| **Provisional** | Actively used and documented, but still moving. Changes are announced in the CHANGELOG with an upgrade note. | MINOR |
| **Internal** | No promise at all. May change or vanish in any release. | any |

A surface can be *partly* stable — the table below says exactly which part.

---

## 1. The container and its data

**Stable.**

- The image runs as a **non-root** user and listens on `$PORT` (`80` in the image).
- **`SW_DATA_DIR` is the one persistent directory.** SQLite database, media, published sites,
  preview builds and pre-migration backups all live under it. Mounting a single volume there is
  the supported deployment; the internal layout under it is **Internal** — treat it as opaque and
  move it as a whole.
- `GET /health` (liveness) and `GET /ready` (readiness) keep their paths and their
  200-means-serving semantics.
- `GET /version` keeps `{ current, latest, updateAvailable, releaseUrl, build }`.

**Provisional:** the exact JSON *body* of `/health` and `/ready` beyond the status code.

### Environment variables

**Stable:** every variable documented in [environment.md](environment.md), including its default.
Removing one, or changing a default in a way that changes behaviour, is a major change. Adding new
optional variables is a minor.

**Internal:** any `SW_*` variable *not* in that document.

### Database and upgrades

**Stable — the upgrade path, not the schema.**

- Migrations are **forward-only** and applied automatically at boot.
- Upgrading across any number of **minor** versions in one step is supported.
- A **pre-migration snapshot** of the database is written under `SW_DATA_DIR/backups/` whenever
  migrations are pending, subject to the configured retention.

**Internal:** the SQL schema itself — table and column names, indexes, the `__drizzle_migrations`
bookkeeping. Read the data through the API, never through the database file.

**Not promised:** downgrade. Rolling back to an older image after migrations have run is not
supported; restore the pre-migration snapshot instead.

---

## 2. HTTP API

Roughly 90 routes. **[DECIDE]** whether this is Stable in full at 1.0, or only the subsets below.
Recommendation: **stabilise the public and content surfaces; keep admin and AI provisional.**

### 2a. Public (unauthenticated) — recommend **Stable**

These are reached by *published sites and their visitors*, so breaking them breaks sites already in
the wild — the strongest case for stability on the whole list.

| Route | Purpose |
|---|---|
| `POST /f/:projectId/:formId` | Form submission endpoint baked into exported HTML. |
| `POST /f/:projectId/:formId/preview` | Preview-mode submission. |
| `GET /media/:projectSlug/:file` | Media delivery (flat scheme, `<id>-<name>`). |
| `GET /media/:projectSlug/:assetId/:file` | Legacy media path, still served. |
| `GET /sites/:slug/*` | Locally-hosted published site (301s to `<slug>.<SW_SITES_DOMAIN>` when configured). |
| `GET /preview/:slug/:token` | Signed draft-preview link. |

The **submission request shape** (`POST /f/…` field names, the `_elapsed` honeypot field, the 200/400
contract) is part of this promise, because exported HTML depends on it.

### 2b. Content CRUD — recommend **Stable**

The generic content surface, over the kinds listed in [§4](#4-content-kinds):

```
GET    /projects/:projectId/content/:kind
GET    /projects/:projectId/content/:kind/:entityId
PUT    /projects/:projectId/content/:kind/:entityId
DELETE /projects/:projectId/content/:kind/:entityId
POST   /projects/:projectId/content/:kind/bulk-delete
```

Plus `GET/POST/PATCH/DELETE /projects`, `/projects/:id`, and the media, publish and deploy routes.

Stable means: the path, the method, the request body accepted, and the *documented* response fields.
Adding fields to a response is a minor. Removing or renaming one is a major.

**Note:** an `entry` is keyed *per dataset*, so its routes require `?dataset=<slug>`. That coupling
is part of the contract.

### 2c. Authentication — recommend **Stable**

`/auth/login`, `/auth/login/totp`, `/auth/logout`, `/auth/register`, `/auth/config`,
`/invites/accept`, `/me`, the `/account/*` self-service routes, and the passkey and OIDC flows.

**Registration is invitation-only, unconditionally** — that is a product decision, not a setting, and
reversing it would be a major change in behaviour even though no route changes.

### 2d. API keys and capabilities — recommend **Stable**

The capability vocabulary: `content:read`, `content:write`, `content:delete`, `publish`, `always`.
Destructive deletes require `content:delete` *separately* from `content:write`; that separation is
part of the promise.

### 2e. Admin, AI, import/clone — recommend **Provisional**

`/admin/*`, `/ai/*`, `/projects/:id/agent/*`, `/projects/:id/ai-clone`, `/projects/:id/import/*`.
These are operator- and tooling-facing, still moving, and not embedded in published artifacts.

---

## 3. The MCP tool surface

**Recommend Stable for the tool NAMES and their required inputs; Provisional for optional inputs and
response text.** Agents are written against these names, and a rename silently breaks every stored
prompt and workflow.

50 tools as of this draft:

```
add_language          ai_clone              clone_audit           compare_regions
compare_to_source     create_media_folder   delete_content        delete_content_bulk
delete_media          delete_page           fidelity_check        get_capabilities
get_components        get_content           get_guide             get_page
get_publish_status    get_reference         get_scope             import_image
import_status         import_stock_image    import_website        inspect_source
list_content          list_media            list_media_folders    list_pages
list_revisions        list_stock_providers  list_submissions      login
move_media            move_media_bulk       pagespeed_audit       patch_critical_css
patch_page            preview_page          publish_project       put_content
put_page              remove_language       rename_dataset        rename_media_folder
restore_revision      search_icons          search_stock_images   search_textures
switch_project        visual_audit
```

The transport (`POST /mcp`, token **or** OAuth, plus the two `/.well-known/oauth-*` discovery
documents) is **Stable**.

The **agent instructions** and the `get_guide` corpus are **Internal** — they are prose tuned for
model behaviour and will change freely.

---

## 4. Content kinds

**Stable** — the kind identifiers used in URLs and export bundles:

`settings` · `page` · `template` · `snippet` · `translation` · `dataset` · `entry` · `form` ·
`imagemap` · `media` · `mediafolder` · `preview_share` · `project_smtp` · `deploy_target` ·
`ai_config`

**Stable** — the field shapes validated by `@sitewright/schema`, in the *accepting* direction: a
document that validates against 1.x keeps validating against every later 1.x. Adding optional fields
is a minor; making an optional field required, or narrowing an accepted value, is a major.

---

## 5. The authoring vocabulary

This is the surface with the **most existing content behind it** and the one that has moved most
recently, so it needs the most explicit treatment.

### 5a. Editor bindings — recommend **Stable**

The seven server-resolved directives that make a region editable:

`data-sw-text` · `data-sw-html` · `data-sw-src` · `data-sw-bg` · `data-sw-href` ·
`data-sw-translate` · `data-sw-entry`

…and the binding namespaces they resolve against: `company.*`, `website.*`, plus `page.data.*` and
the loop variables.

### 5b. Template helpers — recommend **Stable**

22 helpers: `sw-active` · `sw-add-to-cart` · `sw-blank` · `sw-cart` · `sw-consent-settings` ·
`sw-control` · `sw-date` · `sw-flag` · `sw-folder` · `sw-form` · `sw-html` · `sw-icon` · `sw-image` ·
`sw-imagemap` · `sw-json` · `sw-label` · `sw-pick-entry` · `sw-stagger` · `sw-theme-toggle` ·
`sw-translate` · `sw-truncate` · `sw-url`

Stable means the helper name and its **positional argument order** — a page in Git must keep
rendering. New named options are minor.

### 5c. Components and runtime attributes — recommend **Stable for the catalog, Provisional for the rest**

- **Stable:** `data-sw-component` and the component contracts published by `GET /authoring/components`
  (also reachable as the MCP `get_components`), plus `data-sw-part` names for components an author
  targets with CSS.
- **Provisional:** the ~100 other `data-sw-*` runtime attributes (parallax, SVG animation, consent,
  cart, image-map internals). They are documented in the in-app reference, which is the surface most
  authors actually use — but they are also where most iteration happens.

### 5d. Platform CSS — recommend **Stable**

- The `--sw-*` custom properties (59 of them: colour tokens, font slots, button and container
  variables). Author CSS reads these.
- The `.sw-*` utility and structural classes emitted into the published stylesheet
  (`.sw-container`, `.sw-bleed`, `.sw-h1`–`.sw-h6`, `.sw-btn-ripple`, …).

**Not promised:** the *generated* class names inside third-party layers (Tailwind, daisyUI) and their
version. A Tailwind or daisyUI major upgrade is itself a Sitewright major.

### 5e. Published output layout — recommend **Stable**

What a deployed site looks like on disk and over HTTP:

- per-page directories with `index.html`
- `_assets/` for shared runtime assets (`_assets/_icons`, `_assets/_textures`)
- cache-busting `?v=…` on asset URLs (the *presence* of a query is promised; the token is not)
- `sitemap.xml` and `robots.txt` at the root when a production URL is configured
- per-locale prefixes, `/<locale>/…`

Anyone who has pointed a CDN, a proxy rule, or a deploy pipeline at this layout depends on it.

### 5f. Project export bundle — recommend **Stable**

The zip: `manifest.json` + `bundle.json`, carrying `formatVersion` (currently **2**).

The promise: **a bundle exported by 1.x imports into every later 1.x.** Bumping `formatVersion`
without an importer that still reads the older value is a major change.

Note what a bundle deliberately **omits** — secrets, deploy targets, SMTP config, AI config, preview
shares — recorded in the manifest's `omitted` field. That omission is part of the contract.

---

## 6. Deprecation policy

Nothing Stable is removed without going through this:

1. **Announce** in the CHANGELOG under `### Deprecated`, naming the replacement.
2. **Keep it working** for the remainder of the current major.
3. Where the platform can detect use, **warn** — a server log line, or a Page Audit finding for
   authored content.
4. **Remove** in the next major, listed under `### Removed` with the migration step.

**[DECIDE]** the minimum lifetime of a deprecation — a number of minors, or a time window.
Recommendation: **at least two minor releases, and at least 90 days.**

---

## Not covered

Explicitly outside the promise. Changes here are never a major bump:

- **The `@sitewright/*` workspace packages.** Nothing is published to npm; the package boundaries,
  their exports and their types are internal refactoring surface.
- **The editor SPA's DOM, CSS classes, and bundle names.** Automate the editor through the API or
  MCP, not by scripting its markup.
- **Log format and log lines.** Do not parse them; use them for humans.
- **The SQL schema** (see §1).
- **Agent instructions and guide prose** (see §3).
- **Example projects** bundled with the image.
- **Anything behind an explicitly experimental flag** at the time it ships.

---

## Open decisions

Settle these before this document goes into force. Each one changes what 1.0 actually costs.

1. **[DECIDE] Is the whole HTTP API Stable, or only §2a–2d?** Recommendation: 2a–2d Stable, admin/AI
   Provisional. Stabilising `/admin/*` now would freeze surfaces that are still being shaped.
2. **[DECIDE] Are the ~100 runtime `data-sw-*` attributes Stable or Provisional?** Recommendation:
   Provisional (§5c). They are the most-iterated surface, and calling them Stable would make routine
   effect work a major bump.
3. **[DECIDE] Deprecation minimum lifetime.** Recommendation: two minors and 90 days.
4. **[DECIDE] Support window for a major.** How long does 1.x get security fixes once 2.0 ships?
   Recommendation: 12 months.
5. **[DECIDE] Does the authoring model freeze at 1.0?** This is the substantive question. Three
   changes shipped in the last week alone that would each be a major under this contract:
   headings are no longer injected (rich content rewritten to `p.sw-hN`), nav consolidated to named
   menu slots, and media flattened to `/media/<slug>/<id>-<name>`. If more of that is planned, it
   belongs *before* 1.0, not after.

## Before this can ship

- [x] ~~`docs/project-format.md` is stale by an architectural pivot~~ — **retired.** It documented a
      *block tree* with `partialRef` and a CLI that reads project files directly; `PageSchema` has
      `source` (Handlebars) and `template` with no blocks at all, and the CLI is only an MCP bridge.
      The portable representation that *does* exist is the export bundle in [§5f](#5f-project-export-bundle-recommend-stable).
      `docs/architecture.md` D2/D3 were annotated as superseded at the same time.
- [ ] An **API reference** for whatever §2 declares Stable. "The documented response fields" needs a
      document to refer to; today the routes are described only by their code.
- [ ] A **`### Deprecated` section** added to the CHANGELOG's template.
- [ ] Replace the pre-1.0 sentence in the CHANGELOG header with a link to this file.
