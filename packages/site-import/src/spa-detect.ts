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

/** Max visible text (outside any iframe) a page can have and still count as a bare embed WRAPPER. */
const WRAPPER_MAX_TEXT = 700;
const IFRAME_SRC_RE = /<iframe\b[^>]*\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/i;

/**
 * Does this HTML look like an EMBED WRAPPER — a shell page whose REAL content is a single dominant
 * `<iframe>` (Arena / CodeSandbox / preview hosts that frame the actual site, often behind an embed
 * guard)? Returns the framed document's absolute URL to FOLLOW, or null. A real content page that merely
 * embeds a widget (map/video) has plenty of its own text, so it's excluded by the text-length gate.
 * Pure + conservative (a false negative just imports the wrapper as-is, the safe default).
 */
export function embedWrapperFrame(html: string): string | null {
  if (typeof html !== 'string' || html.length === 0) return null;
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1]! : html;
  const iframe = body.match(IFRAME_SRC_RE);
  if (!iframe) return null;
  // Visible text OUTSIDE iframes must be small — otherwise it's a content page, not a wrapper. Strip
  // <script>/<style>/<iframe> bodies FIRST (an inline analytics snippet is not visible text — leaving it
  // in wrongly inflated a wrapper past the threshold), then measure the remaining prose.
  const textLen = body
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<iframe\b[^>]*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
  if (textLen > WRAPPER_MAX_TEXT) return null;
  return iframe[1]!;
}
