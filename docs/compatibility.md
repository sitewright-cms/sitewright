# Compatibility and stability

> **STATUS: DRAFT — not yet in force.** This defines what Sitewright will promise at **1.0.0**. Until
> then the pre-1.0 rule in [CHANGELOG.md](../CHANGELOG.md) applies: *minor versions may include
> breaking changes.* Every **[DECIDE]** marker is a call the maintainers make before this goes into
> force — see [Open decisions](#open-decisions).

Sitewright follows [Semantic Versioning](https://semver.org/). From 1.0.0 the version number is a
promise about the surfaces below, and nothing else:

- **MAJOR** — a Stable surface changed in a way that can break an existing instance, an authored
  site, an integration, or a stored project.
- **MINOR** — new capability; existing Stable surfaces keep working.
- **PATCH** — fixes only.

The unit of release is the container image, `ghcr.io/sitewright-cms/sitewright:X.Y.Z`. Nothing is
published to npm, so the workspace packages (`@sitewright/*`) are **internal**.

## This document does not list the surfaces

**[`contract/`](../contract/) does.** Every promised surface is generated from the running system and
committed there, so that breaking one shows up as a **diff in code review** — see
[`contract/README.md`](../contract/README.md).

That split is deliberate, and the reason is in this repo's own history. `docs/project-format.md`
described a page model the code had abandoned months earlier, and nothing could notice; meanwhile
`packages/blocks/test/authoring-reference.test.ts` had been asserting the helper registry against the
engine that whole time and never drifted once. So:

> **Never write down a fact a test can assert.**

What stays here is the part that genuinely cannot execute: which tier a surface is in, what the tiers
oblige, and how something is removed.

| Artifact | Surface |
|---|---|
| [`contract/http-routes.json`](../contract/http-routes.json) | Every registered route |
| [`contract/mcp-tools.json`](../contract/mcp-tools.json) | MCP tool names + required inputs |
| [`contract/content-kinds.json`](../contract/content-kinds.json) | The content-kind vocabulary |
| [`contract/capabilities.json`](../contract/capabilities.json) | API-key capabilities |
| [`contract/css-api.json`](../contract/css-api.json) | `--sw-*` properties + `.sw-*` classes |
| [`contract/golden/`](../contract/golden/) | Documents and bundles that must keep loading |
| `SW_HELPERS` / `SW_DIRECTIVES` / `COMPONENT_CATALOG` | Already guarded in `@sitewright/schema` + `@sitewright/blocks` |

## The tiers

| Tier | Promise | Change lands in |
|---|---|---|
| **Stable** | Will not break without a major bump and a documented migration path. | MAJOR |
| **Provisional** | Documented and used, but still moving. Changes carry a CHANGELOG upgrade note. | MINOR |
| **Internal** | No promise. May change or vanish in any release. | any |

### What is in which tier

**Stable**

- **The public surface** — the routes published sites and their visitors reach: form submission,
  media delivery, site serving, signed preview links. This is the strongest case on the list: those
  URLs are baked into exported HTML on servers we do not control, so the submission *request shape*
  is promised too, not merely the route.
- **Content CRUD, authentication, API-key capabilities.** The `content:delete` / `content:write`
  separation is itself the promise, not just the names.
- **The content kinds and their schemas**, in the ACCEPTING direction: a document that validates
  under 1.x keeps validating under every later 1.x. Adding an optional field is a minor; making one
  required, or narrowing an accepted value, is a major.
- **The authoring vocabulary** — the binding directives, the `{{sw-*}}` helpers (name *and*
  positional argument order, because pages live in Git), the component catalog, and the `--sw-*` /
  `.sw-*` CSS API.
- **The published-site layout** — per-page directories, `_assets/`, cache-busting on asset URLs (the
  *presence* of a query, not the token), `sitemap.xml`, `robots.txt`, per-locale prefixes.
- **The export bundle** — a bundle exported by 1.x imports into every later 1.x.
- **The container contract** — `SW_DATA_DIR` as the single persistent volume, the documented
  environment variables in [environment.md](environment.md) and their defaults, `/health`, `/ready`,
  `/version`, and the forward-only upgrade path with its pre-migration snapshot.

**Provisional**

- `/admin/*`, `/ai/*`, the agent/import/clone routes — operator- and tooling-facing, still moving,
  not embedded in published artifacts.
- The runtime `data-sw-*` attributes beyond the binding directives (parallax, SVG animation, consent,
  cart, image-map internals). This is where the iteration is; promising them would make routine
  effect work a major bump.
- The response *bodies* of `/health` and `/ready` beyond their status codes.

**Internal**

- The `@sitewright/*` package boundaries, exports and types.
- The SQL schema, and the layout inside `SW_DATA_DIR`. Read data through the API, never the DB file.
- The editor SPA's DOM, classes and bundle names. Automate via the API or MCP.
- Agent instructions and the `get_guide` corpus — prose tuned for model behaviour.
- Log lines and log format.
- Example projects bundled with the image.

**Not promised at all:** downgrade. Rolling back to an older image after migrations have run is not
supported; restore the pre-migration snapshot instead.

## Deprecation policy

Nothing Stable is removed without:

1. **Announce** in the CHANGELOG under `### Deprecated`, naming the replacement.
2. **Keep it working** for the remainder of the current major.
3. **Warn** where use is detectable — a server log line, or a Page Audit finding for authored content.
4. **Remove** in the next major, under `### Removed`, with the migration step.

**[DECIDE]** the minimum deprecation lifetime. Recommendation: **two minor releases and 90 days.**

## Open decisions

1. **[DECIDE] Is the whole HTTP API Stable, or only the public + content + auth subsets?**
   Recommendation: those Stable, admin/AI Provisional — stabilising `/admin/*` now would freeze
   surfaces still being shaped.
2. **[DECIDE] Runtime `data-sw-*` attributes: Stable or Provisional?** Recommendation: Provisional.
3. **[DECIDE] Deprecation minimum lifetime.** Recommendation: two minors and 90 days.
4. **[DECIDE] Support window for a major** once its successor ships. Recommendation: 12 months.
5. **[DECIDE] Does the authoring model freeze at 1.0?** The substantive one. Three changes shipped in
   a single recent week would each be a major under this contract — headings no longer injected
   (rich content rewritten to `p.sw-hN`), nav consolidated to named menu slots, media flattened to
   `/media/<slug>/<id>-<name>`. If more of that is planned, it belongs *before* 1.0.

## Before this goes into force

- [x] ~~`docs/project-format.md` is stale by an architectural pivot~~ — **retired**, and
      `docs/architecture.md` D2/D3 annotated as superseded.
- [x] The listed surfaces are generated and guarded, not described — see [`contract/`](../contract/).
- [ ] **An API reference** for whatever the HTTP API declares Stable. `contract/http-routes.json`
      pins the route *inventory*; it says nothing about request or response bodies, and "the
      documented response fields" needs a document to point at.
- [ ] **More golden fixtures.** The corpus is one released version deep. It gets stronger every
      release that adds to it, and it is append-only by design.
- [ ] A **`### Deprecated`** section in the CHANGELOG template.
- [ ] Replace the pre-1.0 sentence in the CHANGELOG header with a link to this file.
