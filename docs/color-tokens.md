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

## For site-builder agents

- The six tokens above always exist — use `bg-primary`, `text-base-content`, `border-neutral`, … in
  **plain Tailwind**; no DaisyUI required.
- If you use DaisyUI, its components (`btn-primary`, `bg-base-100`, `alert-error`, …) are themed
  automatically from the same tokens. Unset roles (e.g. `info`/`success`/`warning`/`error`,
  `base-200`/`base-300`) fall back to DaisyUI's defaults.
- For text on a colored surface, use the derived `*-content` foreground.
- Prefer tokens over hardcoded hex for brand consistency; the stock Tailwind palette
  (`bg-slate-900`) is fine for one-off non-brand neutrals.

## Implementation notes

- Schema: `identity.colors` is keyed by `ColorTokenKeySchema` (allows hyphens) and a transform
  fills the mandatory six from `DEFAULT_BRAND_COLORS` — see `packages/schema/src/corporate-identity.ts`.
- Publish: brand colors → `@theme` vars, with derived `-content`, in
  `packages/tailwind/src/{tokens,daisy,compile}.ts`.
- Preview: the editor preview stylesheet reads `--sw-color-base-100` / `--sw-color-base-content` /
  `--sw-color-primary` (see `packages/blocks/src/preview-css.ts`).
- Editor: the non-deletable rows + custom editor live in
  `apps/editor/src/views/settings/BrandColorsEditor.tsx`.
