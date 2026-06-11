// A self-contained stylesheet for the live-preview document. The published site
// is styled by Tailwind at build time; this approximates that look using plain
// CSS keyed on the renderer's `data-sw-block`/`data-sw-part` attributes and the
// project's `--sw-*` brand variables, so the preview re-themes with the brand
// and never needs Tailwind at runtime (CSP-friendly: pure inline CSS, no JS).

// NOTE: the box-sizing reset and `a{color:inherit}` now live in the shared base
// layer (base-css.ts, prepended ahead of this skeleton); kept out of here to avoid
// duplicate/conflicting rules. The `body` font/colour/background remain skeleton
// concerns (brand-themed) and stay.
const PREVIEW_CSS = `
body{margin:0;font-family:var(--sw-font-body,ui-sans-serif,system-ui,sans-serif);color:var(--sw-color-base-content,#0f172a);background:var(--sw-color-base-100,#ffffff);line-height:1.5}
[data-sw-block="Section"]{width:100%;padding:3rem 1.5rem}
[data-sw-block="Section"][data-tone="surface"]{background:var(--sw-color-base-100,#ffffff);color:var(--sw-color-base-content,#0f172a)}
[data-sw-block="Section"][data-tone="primary"]{background:var(--sw-color-primary,#0ea5e9);color:#ffffff}
[data-sw-block="Section"][data-tone="muted"]{background:#f8fafc;color:var(--sw-color-base-content,#0f172a)}
[data-sw-block="Section"]>[data-sw-part="container"]{max-width:64rem;margin:0 auto;display:flex;flex-direction:column;gap:2.5rem}
[data-sw-block="Hero"]{max-width:48rem;margin:0 auto;padding:2.5rem 0;text-align:center}
[data-sw-part="title"]{margin:0;font-family:var(--sw-font-heading,inherit);font-size:3rem;font-weight:800;letter-spacing:-.02em}
[data-sw-part="subtitle"]{margin-top:1.5rem;font-size:1.125rem;color:color-mix(in srgb,var(--sw-color-base-content,#0f172a) 58%,transparent)}
[data-sw-part="cta"]{margin-top:2rem;display:inline-block;border-radius:var(--sw-radius-card,.75rem);background:var(--sw-color-primary,#0ea5e9);color:#fff;padding:.75rem 1.5rem;font-weight:600;text-decoration:none}
[data-sw-block="Heading"]{font-family:var(--sw-font-heading,inherit);font-weight:700;letter-spacing:-.01em;color:var(--sw-color-base-content,#0f172a)}
h1[data-sw-block="Heading"],h2[data-sw-block="Heading"]{font-size:1.875rem}
h3[data-sw-block="Heading"]{font-size:1.25rem}
h4[data-sw-block="Heading"],h5[data-sw-block="Heading"],h6[data-sw-block="Heading"]{font-size:1.125rem}
[data-sw-block="RichText"]{font-size:1rem;line-height:1.7}
[data-sw-block="Grid"]{display:grid;gap:1.5rem;grid-template-columns:repeat(1,minmax(0,1fr))}
@media(min-width:640px){[data-sw-block="Grid"]{grid-template-columns:repeat(2,minmax(0,1fr))}}
[data-sw-block="Grid"][data-columns="1"]{grid-template-columns:repeat(1,minmax(0,1fr))}
@media(min-width:1024px){
[data-sw-block="Grid"][data-columns="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}
[data-sw-block="Grid"][data-columns="3"]{grid-template-columns:repeat(3,minmax(0,1fr))}
[data-sw-block="Grid"][data-columns="4"]{grid-template-columns:repeat(4,minmax(0,1fr))}
[data-sw-block="Grid"][data-columns="5"]{grid-template-columns:repeat(5,minmax(0,1fr))}
[data-sw-block="Grid"][data-columns="6"]{grid-template-columns:repeat(6,minmax(0,1fr))}
}
[data-sw-block="Card"]{display:flex;flex-direction:column;gap:.75rem;border-radius:var(--sw-radius-card,.75rem);background:var(--sw-color-base-100,#fff);padding:1.5rem;box-shadow:0 1px 2px rgba(0,0,0,.05);outline:1px solid rgba(0,0,0,.05)}
[data-sw-block="Button"]{display:inline-block;border-radius:var(--sw-radius-card,.75rem);background:var(--sw-color-primary,#0ea5e9);color:#fff;padding:.625rem 1.25rem;font-weight:600;text-decoration:none}
[data-sw-block="Link"]{color:var(--sw-color-primary,#0ea5e9);text-decoration:none}
img[data-sw-block="Image"],[data-sw-block="Image"] img{max-width:100%;height:auto;display:block}
picture[data-sw-block="Image"]{display:block}
[data-sw-block="Image"][data-sw-empty]{min-height:8rem;background:#f1f5f9;border:1px dashed #cbd5e1;border-radius:.5rem}
[data-sw-block="Header"]{width:100%;border-bottom:1px solid #f1f5f9;background:var(--sw-color-base-100,#fff)}
[data-sw-block="Header"]>[data-sw-part="container"]{max-width:64rem;margin:0 auto;display:flex;align-items:center;justify-content:space-between;padding:1rem 1.5rem}
[data-sw-part="brand"]{font-family:var(--sw-font-heading,inherit);font-size:1.25rem;font-weight:700}
[data-sw-part="nav"]{display:flex;gap:1.5rem;font-size:.875rem;color:color-mix(in srgb,var(--sw-color-base-content,#0f172a) 58%,transparent)}
[data-sw-block="Footer"]{width:100%;border-top:1px solid #f1f5f9;background:var(--sw-color-base-100,#fff)}
[data-sw-block="Footer"]>[data-sw-part="container"]{max-width:64rem;margin:0 auto;padding:2rem 1.5rem;font-size:.875rem;color:color-mix(in srgb,var(--sw-color-base-content,#0f172a) 58%,transparent)}
[data-sw-block="Unknown"]{border:1px dashed #f59e0b;background:#fffbeb;padding:.5rem;color:#92400e;font-size:.875rem;border-radius:.375rem}
`.trim();

/** Returns the static preview stylesheet (block layout + brand-variable theming). */
export function previewStyles(): string {
  return PREVIEW_CSS;
}
