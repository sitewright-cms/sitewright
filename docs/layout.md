# Layout — content width

Every section's content should sit in one **site-wide content container** so the whole site lines
up to a single width — and so the owner can retune that width from one control. The platform
provides this as the `.sw-container` helper, driven by the **Content width** setting.

## The `.sw-container` helper

Put `class="sw-container"` on a section's inner wrapper:

```html
<section class="py-20 sm:py-28">
  <div class="sw-container"> … </div>
</section>
```

`.sw-container` is a platform default (shipped in the base CSS) that resolves to:

```css
.sw-container {
  width: 100%;
  max-width: var(--sw-container, 1200px); /* the Content width setting */
  margin-inline: auto;                    /* centred */
  padding-inline: clamp(1rem, 5vw, 5rem); /* a responsive gutter */
}
```

So it is fluid up to the configured width, centred, and never lets content touch the viewport
edges. It lives in the weak `sw-normalize` layer, so author utilities/CSS override it when needed.

### Full-bleed bands

For an edge-to-edge coloured or photo background, keep the background on the `<section>` (full
width) and the `.sw-container` **inside** it — the background spans the viewport while the content
stays aligned:

```html
<section class="bg-primary text-primary-content py-20">
  <div class="sw-container"> … </div>
</section>
```

## The Content width setting

`website.containerWidth` (System Settings → Website → **Content width**) sets the value of the
`--sw-container` CSS variable site-wide. Changing it reflows every `.sw-container` at once.

| Preset  | Value     | `--sw-container` |
|---------|-----------|------------------|
| Default | *(unset)* | `1200px` (the platform default) |
| Narrow  | `960px`   | `960px`  |
| Normal  | `1200px`  | `1200px` |
| Wide    | `1440px`  | `1440px` |
| Full    | `none`    | no cap (full-bleed content) |

A custom pixel value (any `<n>px`) is also accepted. The stored value is the CSS length itself (a
px string or `none`); the editor presents the presets and maps a known value back to its label.
Unset → the helper's built-in `1200px` default, so existing sites are unaffected.

The variable is emitted as `:root{--sw-container:…}` by `renderDocument` on every render surface
(publish, the whole-site preview, and the editor canvas). It is omitted on a raw-fidelity imported
page (which renders with only its own stylesheet — see [the import guide](#imported--nativized-pages)).

## Imported / nativized pages

The website importer and the mechanical nativizer follow the same convention: every section is
**full-width** (`w-full`, never a pinned pixel width), and a section's main centred content wrapper
is emitted as `.sw-container`. That is why imported, nativized, and hand-authored pages all share
one alignment and respond to the Content width setting together. When nativizing, port a foreign
`.container` / centred `max-width` wrapper to `.sw-container` (see the `import` agent guide).

## See also

- [Color tokens](color-tokens.md) — the brand color custom properties.
- The `design` agent guide (`get_guide("design")`) — the section toolkit uses `.sw-container`.
