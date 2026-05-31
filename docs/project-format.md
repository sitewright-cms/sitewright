# Sitewright Project Format

The **project format** is the single on-disk representation of a website project. It is the
bridge that makes the platform usable both **online** (the editor + API read/write it via the
database) and **offline** (the `sitewright` CLI reads/writes the files directly, so projects
live in Git and edits are diffable, reviewable, and AI-friendly).

`@sitewright/schema` is the source of truth for every shape below (Zod schemas).

## Directory layout

```
my-project/
├─ sitewright.json            # Project manifest: id, name, slug, identity, settings, formatVersion
├─ pages/
│  ├─ index.json              # Page: route "/", a block tree (+ optional SEO)
│  ├─ about.json
│  └─ product.json            # Collection page, e.g. path "/products/[slug]"
├─ partials/
│  ├─ site-header.json        # Reusable block subtree, referenced by `partialRef`
│  └─ site-footer.json
├─ datasets/
│  └─ products/
│     ├─ dataset.json         # Dataset: field definitions (the CMS schema)
│     └─ entries/
│        ├─ <entry-id>.json   # Entry: field values (one file per entry)
│        └─ ...
├─ media/                     # Source assets (optimized derivatives are generated at build)
└─ .sitewright/               # Build cache & generated artifacts (git-ignored)
```

## Core concepts

- **Block tree** — every page (and partial) is a tree of `PageNode`s. A node has a `type`
  (mapped to a component in the block registry), optional `props`, and optional `children`.
- **Partials** — a node with a `partialRef` is replaced at build time by the named partial's
  subtree. Edit the partial once; every reference updates. (Reusable corporate components,
  headers, footers, CTAs.)
- **Bindings** — a node with a `binding` pulls data from a dataset. `mode: "single"` binds one
  entry; `mode: "list"` repeats the node per entry. Bindings are **resolved at build time**,
  so the published output stays static.
- **Collection pages** — a page with a `collection` (`{ dataset, param }`) and a `[param]`
  segment in its `path` is generated once per dataset entry (e.g. `/products/[slug]`).
- **Corporate Identity** (`identity`) — the single per-project record that unifies the company
  info (legal/short name, slogan, logo, favicon/OG image, address, geo, social → schema.org
  JSON-LD) and the brand tokens (colors, typography, spacing, radii → CSS variables + Tailwind
  theme). `name` is always present; everything else is optional. Editable by developers;
  lockable for client roles.

## Versioning

`sitewright.json.formatVersion` is an integer. It is bumped only on **incompatible** format
changes; the CLI and API refuse to open a project with a newer format than they understand and
provide a migration path. The current version is exported as `PROJECT_FORMAT_VERSION` from
`@sitewright/schema`.

- **v2** — merged the separate `brand` and `company` objects into a single `identity` record
  (the unified Corporate Identity). Legacy v1 `{brand, company}` data is normalized to
  `{identity}` transparently on read (DB settings rows, imported bundles) by `mergeLegacyIdentity`.
