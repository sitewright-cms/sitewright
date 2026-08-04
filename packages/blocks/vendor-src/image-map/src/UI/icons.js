// The map's own chrome icons — zoom, fullscreen, search, close, the layer menu.
//
// ★ ALL ORIGINAL GEOMETRY. Upstream used Font Awesome **Pro** 6.x glyphs and carried their licence
// banner into the bundle, so every published page shipped paid-licence artwork we have no right to
// redistribute. These are plain shapes authored here: a 24×24 box, filled paths, sized by CSS
// (`.sw-imap-icon { width; height }`) and coloured by `fill`, exactly as before — so the stylesheet
// and every call site are unchanged.
//
// Keep them geometric. Anything that wants real iconography belongs in the platform's Phosphor set
// ({{sw-icon}}), not in a bundled runtime.

const icon = (body) => `<svg class="sw-imap-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`

/** Four corner brackets pointing outward. */
export const goFullscreen = icon('<path d="M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM6 15v3h3v2H4v-5h2zm12 0h2v5h-5v-2h3v-3z"/>')

/** The same brackets, pointing inward. */
export const closeFullscreen = icon('<path d="M9 4h2v5H6V7h3V4zm6 0h2v3h3v2h-5V4zM6 15h5v5H9v-3H6v-2zm9 0h5v2h-3v3h-2v-5z"/>')

export const zoomIn = icon('<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z"/>')

export const zoomOut = icon('<path d="M5 11h14v2H5z"/>')

/** A magnifier: a ring plus a handle. */
export const search = icon(
  '<path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.8 4.8-1.4 1.4-4.8-4.8A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/>',
)

export const close = icon(
  '<path d="m19.1 6.3-1.4-1.4-5.7 5.7-5.7-5.7-1.4 1.4 5.7 5.7-5.7 5.7 1.4 1.4 5.7-5.7 5.7 5.7 1.4-1.4-5.7-5.7 5.7-5.7z"/>',
)

export const arrowDown = icon('<path d="M12 15.5 5.5 9h13L12 15.5z"/>')

export const bars = icon('<path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/>')

export const caretDown = icon('<path d="M12 15.5 5.5 9h13L12 15.5z"/>')

export const caretRight = icon('<path d="M15.5 12 9 18.5v-13L15.5 12z"/>')
