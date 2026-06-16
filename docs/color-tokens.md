# Color tokens

A project's brand colors live on its **Corporate Identity** (`identity.colors`) and compile to
Tailwind theme variables (`--color-<token>`), so every color is a first-class utility
(`bg-<token>`, `text-<token>`, `border-<token>`). DaisyUI, when a page uses it, reads the same
variables — so components are themed from the identical source with no translation.

## The six mandatory tokens

Every project always has these, with sensible defaults. They are **non-deletable** in the
settings page (clearing one resets it to its default) and re-materialize on parse, so templates,
components, and site-builder agents can rely on them unconditionally.

| Token          | Settings label     | Default     | Role |
|----------------|--------------------|-------------|------|
| `primary`      | Primary Color      | `#4f46e5`   | Brand / primary action (CTAs, links) |
| `secondary`    | Secondary Color    | `#0ea5e9`   | Supporting brand color |
| `accent`       | Accent Color       | `#f59e0b`   | Highlights / emphasis |
| `neutral`      | Neutral Color      | `#171627`   | Dark UI chrome (footers, badges) |
| `base-100`     | **Background Color** | `#ffffff` | Page background / surfaces |
| `base-content` | **Text Color**     | `#1a1a23`   | Default body text |

The names are the canonical DaisyUI/Tailwind semantic roles, so `bg-primary` and `btn-primary`
draw from the same value.

### Foregrounds are automatic

You don't define `primary-content`, `secondary-content`, etc. For each colored surface
(`primary`/`secondary`/`accent`/`neutral`) a readable foreground is **derived at build time** via
WCAG relative luminance, so an overridden brand color never produces unreadable text. Put text on a
colored surface with the derived token: `class="bg-primary text-primary-content"`. (`base-content`
is itself the page text color; `base-100` needs no foreground.)

## Custom colors

Add any number of extra named colors in the settings page. They become utilities too
(`bg-<name>` / `text-<name>` / `border-<name>`). Keys may use letters, digits, `_`, and internal
hyphens (e.g. `brand-teal`). Custom colors do **not** get an auto-derived `-content`.

## Using tokens in custom CSS — the `--sw-*` variables

The utilities above cover almost everything, but when you write **custom CSS** (a `<style>` block, the
**Critical CSS** setting, or an inline `style="…"`) read the theme through the platform's own CSS custom
properties instead of pasting hex values. Every brand value is mirrored under the **`--sw-` namespace**:

| Variable | What it is |
|----------|------------|
| `--sw-color-<role>` | A theme colour — `--sw-color-primary`, `--sw-color-base-100`, `--sw-color-base-content`, `--sw-color-accent`, … (one per role/custom colour above) |
| `--sw-font-<key>`   | A CI font family (e.g. `--sw-font-heading`, `--sw-font-body`) |
| `--sw-space-<key>`  | A CI spacing value |
| `--sw-radius-<key>` | A CI corner radius |

```css
.promo { background: var(--sw-color-base-200); color: var(--sw-color-base-content);
         border: 1px solid var(--sw-color-primary); border-radius: var(--sw-radius-box, .75rem); }
```

These are the **only** non-standard (platform-specific) tokens — everything else is stock DaisyUI/Tailwind.
DaisyUI's own `--color-<role>` variables resolve to the same values, so either works; the `--sw-` ones are
guaranteed present even on a page that doesn't pull in DaisyUI. Using them (instead of hex) is what keeps
custom CSS on-brand **and** dark-mode-safe (see below).

## Light / dark color schemes

Color schemes are **opt-in per project** (Settings → Website → "Light / dark color schemes"; off by
default, so existing sites are unchanged). When enabled:

- The platform adds a **dark variant** by flipping the surface + text tokens (`base-100/200/300` and
  `base-content`) to a dark palette. Because the whole site is built from those tokens, **anything that
  uses the token utilities/variables above adapts automatically** — no per-element dark styles. This is the
  single best reason to use tokens over fixed colours.
- You pick a **default scheme**: `light`, `dark`, or `auto` (follow the visitor's device). The default is
  server-rendered onto `<html data-sw-scheme>` so there is no flash.
- Drop **`{{sw-theme-toggle}}`** in the nav/header to let visitors switch; their choice persists
  (localStorage) and re-applies before first paint. The toggle (and its tiny runtime) only appear when
  color schemes are enabled.
- The brand **accent** roles (`primary`/`secondary`/`accent`) are kept as-is in dark for now — only the
  neutrals flip — so a brand colour with poor contrast on dark is a design choice to watch.

> **What breaks dark mode:** fixed colours — `bg-white`, `bg-slate-900`, `text-gray-700`, `#fff` in custom
> CSS. They don't adapt. Use `bg-base-100` / `text-base-content` / `var(--sw-color-*)` instead. A fixed
> colour on an always-coloured element (a brand badge, a gradient) is fine.

## For site-builder agents

- The six tokens above always exist — use `bg-primary`, `text-base-content`, `border-neutral`, … in
  **plain Tailwind**; no DaisyUI required.
- If you use DaisyUI, its components (`btn-primary`, `bg-base-100`, `alert-error`, …) are themed
  automatically from the same tokens. Unset roles (e.g. `info`/`success`/`warning`/`error`,
  `base-200`/`base-300`) fall back to DaisyUI's defaults.
- For text on a colored surface, use the derived `*-content` foreground.
- **Prefer tokens over hardcoded hex** — for brand consistency AND so the page survives dark mode. Use
  `bg-base-100` / `bg-base-200` / `text-base-content` / `border-base-300` for surfaces, text, and borders
  rather than fixed Tailwind palette colours (`bg-white`, `bg-slate-900`, `text-gray-700`). A fixed colour
  is fine only on an element that is meant to look the same in both schemes (a brand badge, a gradient).
- In custom CSS, read `var(--sw-color-<role>)` (and `--sw-font/space/radius-<key>`) instead of hex.
- If the project enables color schemes, add `{{sw-theme-toggle}}` to the nav so visitors can switch.

## Implementation notes

- Schema: `identity.colors` is keyed by `ColorTokenKeySchema` (allows hyphens) and a transform
  fills the mandatory six from `DEFAULT_BRAND_COLORS` — see `packages/schema/src/corporate-identity.ts`.
- Publish: brand colors → `@theme` vars, with derived `-content`, in
  `packages/tailwind/src/{tokens,daisy,compile}.ts`.
- Preview: the editor preview stylesheet reads `--sw-color-base-100` / `--sw-color-base-content` /
  `--sw-color-primary` (see `packages/blocks/src/preview-css.ts`).
- Editor: the non-deletable rows + custom editor live in
  `apps/editor/src/views/settings/BrandColorsEditor.tsx`.
