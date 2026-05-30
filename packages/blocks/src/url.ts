// Mirrors apps/render-app/src/blocks/props.ts:safeUrl. Kept here so the shared
// renderer is self-contained; Phase F converges the Astro renderer onto this
// package and removes the duplicate.

// Allow only absolute http(s) URLs, root-relative paths, fragment links, and empty.
// Blocks `javascript:`, `data:`, `vbscript:`, and other active/unknown schemes that
// would become XSS or unwanted fetches when emitted into an href/src attribute.
// The root-relative branch requires a single leading `/` NOT followed by another
// `/`, so protocol-relative URLs (`//evil.com`, an off-site/open-redirect vector)
// are rejected.
const SAFE_URL = /^(?:https?:\/\/|\/(?!\/)|#)/i;

/** Sanitizes a URL string for use in `href`/`src`; returns `fallback` if unsafe. */
export function safeUrl(value: string, fallback = '#'): string {
  const trimmed = value.trim();
  if (trimmed === '') return fallback;
  return SAFE_URL.test(trimmed) ? trimmed : fallback;
}

/**
 * Rewrites an author-supplied href for portable output. Internal, root-relative
 * links (`/about`, `/`) are rebased onto `root` — the relative path from the
 * current page to the site root (see `relativeRoot` in @sitewright/core) — so
 * the exported site works at any base path. External (`http(s)://`) and fragment
 * (`#`) links pass through unchanged. Unsafe or protocol-relative URLs fall back
 * to `#`.
 */
export function resolveInternalUrl(href: string, root: string): string {
  const safe = safeUrl(href, '');
  if (safe === '') return '#';
  if (safe.startsWith('#') || /^https?:\/\//i.test(safe)) return safe;
  // Reject root-relative paths that traverse above the site root (`/../x`,
  // `/a/../b`) — they'd resolve off-root in the exported artifact.
  if (/(?:^|\/)\.\.(?:\/|$)/.test(safe)) return '#';
  // Root-relative internal link: drop the leading '/' and rebase onto `root`.
  const rebased = root + safe.slice(1);
  return rebased === '' ? './' : rebased;
}
