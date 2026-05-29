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
