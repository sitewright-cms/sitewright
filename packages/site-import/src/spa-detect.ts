// Heuristic: does this HTML look like a CLIENT-RENDERED (SPA) shell — i.e. an almost-empty body that a
// bundle fills in at runtime? Such pages have no real content when fetched statically, so the crawler
// should re-render them in a headless browser. Pure + conservative (false negatives just mean a page is
// imported as-fetched, which is the safe default).

/** Body text length below which a page is "empty" enough to suspect client rendering. */
const EMPTY_BODY_TEXT = 200;
/** Common SPA root mount nodes. */
const MOUNT_RE = /<(?:div|main)\b[^>]*\bid\s*=\s*["'](?:root|app|__next|__nuxt|q-app|svelte|application)["']/i;
const SCRIPT_SRC_RE = /<script\b[^>]*\bsrc\s*=/gi;

export function looksClientRendered(html: string): boolean {
  if (typeof html !== 'string' || html.length === 0) return false;
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1]! : html;
  // Strip tags + collapse whitespace to estimate the visible text.
  const textLen = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
  if (textLen >= EMPTY_BODY_TEXT) return false;
  const scriptSrcCount = (html.match(SCRIPT_SRC_RE) ?? []).length;
  if (scriptSrcCount === 0) return false;
  // A near-empty body WITH a recognized mount node, or an essentially-blank body that still ships JS.
  return MOUNT_RE.test(body) || textLen < 40;
}
