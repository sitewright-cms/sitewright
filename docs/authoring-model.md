# Authoring model — the building blocks

**Status:** Components, Datasets, Snippets, Templates, Slots are **shipped**. Widgets and nested
datasets are **planned** (roadmap at the end). This doc is the canonical reference for *which
building block to reach for* — for coders, agents, and the editor UI. Keep the vocabulary small:
**six nouns, no more** without retiring one.

## The two axes

Every building block sorts cleanly on two axes — use them whenever you're tempted to add a concept:

- **Granularity:** element → component → block → page → chrome.
- **Reference vs. Managed:** dead markup you copy and *own*, vs. a system-managed thing with a
  lifecycle (backing data, a no-code editing surface, provisioning).

## The producer / consumer split

The most important framing: most blocks belong to one of two audiences.

- **Producer vocabulary (coders + agents, code-first):** Components, Snippets, Templates, Datasets.
- **Consumer vocabulary (end-users, no-code):** Widgets + the editing UIs.
- **Widgets are the bridge:** *produced once in code, consumed many times in the UI.*

## The six building blocks

| Block | What it is | Scope | Authored by | Edited by | Data-backed | Referenced in code as |
|---|---|---|---|---|---|---|
| **Component** | Interactive primitive + `data-sw-component` contract (Carousel, Lightbox, Tabs, Modal, Form, CookieConsent, ShaderBg) | element/block | platform | coder/agent (writes the markup) | no — you bring content | `data-sw-component="…"` + `data-sw-part` |
| **Dataset** | Structured content store — collections of typed records (a "database replacement") | data layer | coder/agent/user | end-user (grid + entry editor) | *is* the data | `{{#each dataset.<slug>}}` |
| **Snippet** | **Reference** markup — a copy-to-own starter ("how to compose a navbar") | any | platform/coder | nobody (you copy it and own the result) | no | `{{> name}}` (or copy the source) |
| **Widget** | **Managed**, data-backed, editable drop-in block (hero slider, testimonials, logo wall) | block | platform/coder (defines it) | end-user (no-code) | yes — owns a dataset | `{{> name}}` + a `provides` manifest |
| **Template** | Full-page reusable layout | page | coder/agent | end-user via its data | optional | `template: "global:<id>"` on a Page |
| **Slot** | Chrome region the skeleton wraps (topNav, mobileNav, sidebars, footer, bottom) | chrome | coder/agent | end-user (slot editor) | no | `nav: { slots: [...] }` / `website.<slot>` |

> **"Partials" is deliberately NOT a noun.** In Handlebars `{{> x}}` *is* a partial, and Snippets/
> Widgets already resolve as partials — so naming the chrome regions "partials" overloads the word.
> The chrome regions are **Slots**. "Pre-authored content you can drop into a slot" is just a Snippet
> (reference) or a Widget (managed) that happens to target a slot — not a new concept.

## Snippet ↔ Widget: one library, two tiers

A **Widget is a Snippet plus a manifest.** They share one store and one render path (`{{> name}}`);
the only difference is whether the entry carries a `provides` manifest (a dataset structure + seed)
and is flagged *managed*. This is deliberate — Widgets add **zero new runtime primitives**; they reuse
Snippets + Datasets + provisioning.

This gives a clean **promotion path**: prototype something as a **Snippet** (reference markup); when it
needs backing data + no-code editing, **graduate it to a Widget** by adding the manifest. Same entry,
one new field.

| | Snippet | Widget |
|---|---|---|
| Carries a `provides` manifest | no | yes |
| Provisions a dataset on use | no | yes (save-time reconciliation) |
| End-user editing | none (copy & own) | dataset UI + options |
| Mental model | "show me how" | "drop it in and edit it" |

## Layering (how they compose)

```
Element            raw HTML + data-sw-* leaf directives (data-sw-text/html/src/bg/href/translate)
  └─ Component     interactive primitive (data-sw-component + JS runtime)
       └─ Widget   managed block: composes components + elements, OWNS a dataset, editable
            └─ Template   full-page layout: composes widgets/components/markup
Slot               chrome regions, filled with markup (or a Snippet / Widget)
Dataset            orthogonal data layer — Widgets own datasets; pages bind them
```

A "hero slider Widget" *uses* the Carousel Component and *owns* a `hero_slides` dataset. Components
stay the atoms; Widgets are managed molecules built from them.

## Which do I reach for? (litmus tests)

- Need **behavior** (slider, modal, tabs, lightbox)? → **Component** (contract in the catalog / MCP `get_components`).
- Need **repeating structured content**? → **Dataset**, bound with `{{#each dataset.x}}`.
- Need a **whole-page layout**? → **Template**.
- Want a **code starting point** to copy and own? → **Snippet**.
- Want a **drop-in that end-users edit without code**, with managed data? → **Widget**.
- Site-wide **chrome** (nav/footer)? → **Slot**.

> Rule for proposing any new concept: if it's expressible as one of the six (or a flag on one), it is
> not new. Adding a seventh noun requires retiring one.

## Development paths

**Coder / agent (producer, code-first):**
1. Reach for a **Component** when you need behavior — read its contract from the catalog / MCP.
2. Bind a **Dataset** with `{{#each dataset.x}}` for repeating content.
3. Compose into a page `source` or a **Template**.
4. Copy a **Snippet** to start; **define a Widget** (snippet + manifest) when end-users will edit it.

**End-user (consumer, no-code):**
1. Pick a **Template** for the page shape.
2. Drop in **Widgets**; edit their content through the dataset UI and their options.
3. Configure **Slots** (nav/footer) in their editors.
4. Never touches Snippets or raw Components — those are the producer layer.

---

## Roadmap: Widgets + nested datasets

Widgets depend on two pieces of new capability, built in this order:

### 1. Nested datasets (`list` / `object` field types)

Today a Dataset field is a scalar (`text/richtext/number/boolean/date/image/reference/select/json`),
so a dataset models a *flat* collection. A Widget config wants one editable object with **top-level
settings AND a nested array** — e.g. a hero is `{ show_navigation, show_indicators, autoplay,
interval, slides: [{ image, caption, link }, …] }`.

The keystone is a **`list` field type** (an ordered, repeatable group of sub-fields); `object` (a
named sub-group) is a natural sibling. The `json` field already *stores* nesting — what's missing is
the **schema** for it and a **structured editor**. Scope:

- `FieldSchema` becomes recursive (`list`/`object` carry child `fields`), with hard **depth + size
  guards** (this is attacker-adjacent authored input).
- `EntryEditorModal` renders recursively: nested groups, and for `list` — add / remove / **reorder**
  rows, including nested image pickers.
- The `localized` flag must work recursively.
- Render binding reaches nested arrays (`{{#each hero.slides}}`); a **singleton** dataset (one entry =
  one config object) is the shape a Widget uses.

This is a general structured-content capability — it also unlocks pricing tiers, FAQ groups, and
multi-level menus, not just the hero. Build it on its own merits, with the hero Widget as the first
consumer.

### 2. Widget mechanism (Snippet + manifest + provisioning)

- Extend the snippet record with an optional **`provides`** manifest: the dataset(s) it needs
  (slug, name, fields — possibly nested — and seed entries) and a *managed* flag.
- **Provision by save-time reconciliation, not an insert hook:** on `PUT content/page`, scan the saved
  source for `{{> name}}` references, look up each Widget's manifest, and **ensure** its datasets exist
  (create-if-missing, seed only on fresh create, never overwrite). This is path-independent — typed,
  pasted, copied across pages, or written by an agent over the API all provision identically. Removing
  the Widget leaves the dataset as a harmless orphan (offer cleanup later; never auto-delete data).
- The editor surfaces a Widget with no-code editing affordances (its dataset UI + options); a Snippet
  stays copy-only.

### Phasing

1. **Dataset-driven hero** — flat `hero_slides` dataset + seed; slides editable via today's UI. Ships now.
2. **Save-time provisioning** — the `provides` manifest, reconciled on any save (paste/agent-safe).
3. **Nested `list`/`object` field types + recursive editor** — fold the hero into a singleton config
   Widget (settings + slides), and make nested datasets a first-class capability.

> See also: `docs/architecture.md` (decision log — note D2/D3 describe the retired block-tree; the
> platform is now code-first/Handlebars), `docs/i18n-content-model.md`, and the `component-catalog`.
