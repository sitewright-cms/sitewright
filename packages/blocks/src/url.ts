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
 *
 * `localePrefix` (e.g. `'de/'`) keeps internal PAGE links inside the current
 * locale subtree: `/about` → `<root>de/about`. It defaults to `''` (single-locale
 * / default-locale → identical to before). Pass it ONLY for page links, never for
 * shared assets (media/css/js live at the site root, the same across locales).
 */
export function resolveInternalUrl(href: string, root: string, localePrefix = ''): string {
  const safe = safeUrl(href, '');
  if (safe === '') return '#';
  // Reject embedded TAB/LF/CR: the WHATWG URL parser strips these, so a value like
  // `/<TAB>javascript:…` would survive `safeUrl` (it starts with `/`) and — once the
  // leading slash is dropped at the site root — parse as the `javascript:` scheme (XSS).
  if (/[\t\n\r]/.test(safe)) return '#';
  if (safe.startsWith('#') || /^https?:\/\//i.test(safe)) return safe;
  // Reject root-relative paths that traverse above the site root (`/../x`,
  // `/a/../b`) — they'd resolve off-root in the exported artifact.
  if (/(?:^|\/)\.\.(?:\/|$)/.test(safe)) return '#';
  // Root-relative internal link: drop the leading '/' and rebase onto `root`,
  // inside the locale subtree.
  const rebased = root + localePrefix + safe.slice(1);
  return rebased === '' ? './' : rebased;
}

// Rewrites internal root-relative links in `href`/`src` attributes; a single leading
// slash not followed by another (so protocol-relative `//host` is left for safeUrl/the
// validator to handle). Captures: (1) attr name, (2) quote, (3) the `/…` value.
const INTERNAL_LINK_ATTR = /\b(href|src)=(["'])(\/(?!\/)[^"']*)\2/gi;

/**
 * Rebases EVERY internal root-relative link (`href`/`src` starting with a single `/`) in
 * a rendered HTML document onto the page-relative `root`, so the output is portable —
 * it works unchanged at a domain root, in a sub-folder, or at the `/sites/<slug>/`
 * preview path. `/about` → `<root>about`, `/` → `<root>` (or `./` at depth 0). External
 * (`http(s)://`), protocol-relative (`//`), fragment (`#`), and already-relative links are
 * untouched; traversing links (`/a/../b`) collapse to `#` (via {@link resolveInternalUrl}).
 *
 * Applied as a publish post-process so it catches links from code-first `{{url …}}`
 * helpers AND literal `href="/…"` in source/skeleton slots (block-tree props are already
 * rebased at render time, and are relative here, so they don't match).
 *
 * Limitations (acceptable for the current surface): it is a flat attribute scan, so a
 * literal `href="/…"`/`src="/…"` inside a `<script>` STRING in an OPERATOR-only raw field
 * (website.head / scripts) is also rewritten — tenant slots/pages can't contain `<script>`
 * (the template validator forbids it), so there is no end-user vector. `srcset` is not
 * rewritten (the block Image already emits page-relative srcset; hand-authored `srcset`
 * with `/…` paths would stay root-relative).
 */
export function relativizeInternalLinks(html: string, root: string): string {
  return html.replace(INTERNAL_LINK_ATTR, (_m, attr: string, quote: string, value: string) => {
    return `${attr}=${quote}${resolveInternalUrl(value, root)}${quote}`;
  });
}
