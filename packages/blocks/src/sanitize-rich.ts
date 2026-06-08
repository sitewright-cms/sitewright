// Allowlist sanitizer for client-authored RICH content (the `data-sw-html` directive +
// the side-panel WYSIWYG editor). This is THE XSS boundary for the one place we emit
// client HTML unescaped: a `data-sw-html` region's value is set as an element's innerHTML
// (see directives.ts), so anything this function lets through runs in the published site.
//
// Posture: a small, explicit allowlist (Full formatting — text marks, headings, lists,
// links, images, tables, text-align). Everything else is DISCARDED: `script`/`style`
// elements, `on*` handlers, `iframe`/`object`/`embed`/`form`, comments, and any unlisted
// tag/attribute. URL schemes are gated to http(s)/mailto/tel (+ relative) and
// protocol-relative URLs are rejected — matching the platform's `safeUrl` posture without
// dropping legitimate contact links. Truly-raw HTML (scripts/widgets) is NOT this surface;
// that stays the owner-authored `Html` block.
import sanitizeHtml from 'sanitize-html';

const RICH_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    // Block + structure. `h1` is intentionally omitted — the page's single top-level heading comes
    // from the surrounding template, so rich regions start at `h2`.
    'p', 'div', 'br', 'hr', 'blockquote', 'pre',
    'h2', 'h3', 'h4', 'h5', 'h6',
    // Inline marks
    'span', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup', 'small', 'code',
    // Lists
    'ul', 'ol', 'li',
    // Links + media
    'a', 'img',
    // Tables
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
    col: ['span'],
    // `style` is allowed everywhere but constrained to `text-align` only (see allowedStyles);
    // every other declaration (and the on*-via-style / expression() surface) is dropped.
    '*': ['style'],
  },
  allowedStyles: {
    '*': {
      'text-align': [/^(?:left|right|center|justify)$/],
    },
  },
  // Schemes for href/src. `data:`/`javascript:`/`vbscript:` are absent → discarded. Relative
  // URLs (no scheme, e.g. `/media/…`) are permitted by sanitize-html regardless of this list.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  // No author classes from clients (keeps the published Tailwind candidate-set stable and
  // closes a class-injection vector); structure + text-align cover the formatting surface.
  allowedClasses: {},
  disallowedTagsMode: 'discard',
  transformTags: {
    // We fully control `rel`: drop any author-supplied value (so a bare `rel="opener"` can't slip
    // through) and set `noopener noreferrer` only when the link opens a new browsing context.
    a: (tagName, attribs) => {
      const next: Record<string, string> = { ...attribs };
      delete next.rel;
      if (next.target) next.rel = 'noopener noreferrer';
      return { tagName, attribs: next };
    },
  },
};

/**
 * Sanitizes client-authored rich HTML to the allowlist above. Idempotent (sanitizing
 * already-clean HTML is a no-op), so it is safe to run both at SAVE (authoritative) and at
 * RENDER (defensive — catches a value that reached the store via import/seed/DB).
 */
export function sanitizeRichHtml(html: string): string {
  if (typeof html !== 'string' || html === '') return '';
  return sanitizeHtml(html, RICH_OPTIONS);
}
