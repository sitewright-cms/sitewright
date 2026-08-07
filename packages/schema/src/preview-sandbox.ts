// The sandbox token list for every PREVIEW surface — ONE definition, consumed by both sides of the
// frame boundary.
//
// A preview document is served under a response `Content-Security-Policy: sandbox …` (which forces an
// OPAQUE origin even on direct navigation) AND embedded in an editor `<iframe sandbox="…">`. The two
// lists INTERSECT: whichever is stricter silently wins, and the loss is invisible — the feature simply
// does nothing, with no console error to find. Keeping the API's header and the editor's attribute
// derived from this array is what makes that drift impossible; `preview-sandbox.test.ts` asserts both
// call sites use it.
//
// `allow-same-origin` is DELIBERATELY absent and must never be added: a preview document is served from
// the API's own origin, so granting it would let author-supplied JS read the editor's session and make
// credentialed API calls as the signed-in user. The opaque origin IS the preview's security boundary.
// (Cost of that boundary: an embed needing first-party storage — YouTube, Vimeo — cannot run in a
// preview at all. Those are swapped for an "open in a new tab" placeholder at build time instead.)

/** Sandbox tokens shared by the preview CSP header and the editor's iframe `sandbox` attribute. */
export const PREVIEW_SANDBOX_TOKENS: readonly string[] = [
  // Author content runs, for true WYSIWYG — the whole point of the surface.
  'allow-scripts',
  // A form's submit EVENT fires. Preview forms post to the dry-run endpoint, so nothing is stored or mailed.
  'allow-forms',
  // An outbound `target="_blank"` opens at all…
  'allow-popups',
  // …and lands UN-sandboxed at the target's real origin, rather than opaque and broken.
  'allow-popups-to-escape-sandbox',
  // A `download` link / an attachment response actually downloads. Without this the click is a no-op:
  // no navigation, no file, no console error — measured on both preview surfaces before it was added.
  'allow-downloads',
];

/** The `Content-Security-Policy` value for a preview document (`sandbox allow-scripts …`). */
export const PREVIEW_SANDBOX_CSP = `sandbox ${PREVIEW_SANDBOX_TOKENS.join(' ')}`;

/** The value for an editor preview `<iframe sandbox="…">`. Must MATCH the CSP, or the stricter wins. */
export const PREVIEW_SANDBOX_ATTR = PREVIEW_SANDBOX_TOKENS.join(' ');
