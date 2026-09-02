// Allowlist sanitizer for client-authored HTML — THE XSS boundary for the two places we emit client
// HTML unescaped: the `data-sw-html` directive region (set as innerHTML, see directives.ts) and the
// `{{sw-html}}` helper. Anything this lets through runs in the published site, so it is allow-list based.
//
// Posture: BROAD "safe HTML" — structure/sectioning, text, lists, links, media (img/picture/video/
// audio), tables, and HTTPS-only iframe EMBEDS (force-sandboxed). Authors may use `class`/`id`/`title`/
// `dir`/`lang`/`role`/`aria-*` for styling + a11y, and a small safe inline-`style` set (text-align,
// colors, font weight/style, text-decoration — value-gated so no url()/expression()).
//
// STILL DISCARDED (the security guarantees): `<script>`/`<style>` elements, every `on*` handler, ALL
// `data-*` attributes (so authored HTML can NOT inject platform `data-sw-*` component/cart/directive
// markers the runtime/build interprets), `javascript:`/`vbscript:`/`data:` URLs, protocol-relative
// URLs, and any unlisted tag/attribute. iframes are restricted to an `https:` src and get a FORCED
// `sandbox` (no `allow-same-origin`) + `referrerpolicy=no-referrer`; an iframe without a valid https
// src is dropped entirely. `<form>`/`<input>` are NOT allowed (no embedded credential-harvest forms).
import sanitizeHtml from 'sanitize-html';
import { RICH_TABLE_SIZE_RE } from './rich-table.js';

// Safe colour values: hex, rgb()/rgba() (digits/commas/dots/space only — can't carry url()/expression()
// since those need letters+parens), or a CSS named colour. Split into simple regexes (no nested
// quantifiers → no ReDoS). allowedStyles matches if ANY entry matches.
const COLOR = [/^#[0-9a-fA-F]{3,8}$/, /^rgba?\([0-9.,\s]+\)$/, /^[a-zA-Z]+$/];

const RICH_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    // Sectioning + structure
    'div', 'span', 'section', 'article', 'aside', 'nav', 'header', 'footer', 'main', 'hgroup',
    'address', 'figure', 'figcaption', 'details', 'summary', 'p', 'br', 'hr', 'blockquote', 'pre',
    // Headings ARE allowed through the gate, but transformTags below rewrites every one of them to a
    // <p class="sw-h*">: see the note there. Dropping them from this list instead would DELETE the text.
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    // Inline text marks
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup', 'small', 'code', 'q',
    'cite', 'abbr', 'time', 'kbd', 'samp', 'var', 'dfn', 'data', 'bdi', 'bdo', 'wbr', 'ruby', 'rt', 'rp',
    // Lists
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    // Inert interactive (no behaviour without on* handlers — useful for styling)
    'button', 'label',
    // Links + media
    'a', 'img', 'picture', 'source', 'video', 'audio', 'track',
    // Tables
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    // HTTPS-only, force-sandboxed embeds (YouTube/Vimeo/Maps/…)
    'iframe',
  ],
  allowedAttributes: {
    // Global safe attributes on every tag. `aria-*` is wildcarded; `data-*` is deliberately ABSENT
    // (authored data-* must never reach the platform's data-sw-* runtime/build interpreters).
    '*': ['class', 'id', 'title', 'dir', 'lang', 'role', 'style', 'aria-*'],
    a: ['href', 'name', 'target', 'rel', 'download'],
    img: ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding'],
    source: ['src', 'srcset', 'sizes', 'type', 'media'],
    video: ['src', 'poster', 'width', 'height', 'controls', 'loop', 'muted', 'preload', 'playsinline', 'autoplay'],
    audio: ['src', 'controls', 'loop', 'muted', 'preload', 'autoplay'],
    track: ['src', 'kind', 'srclang', 'label', 'default'],
    // iframe: src is https-gated below; sandbox + referrerpolicy are FORCED in transformTags. `allow`
    // is intentionally omitted (the camera/mic/geolocation delegation vector).
    iframe: ['src', 'width', 'height', 'allowfullscreen', 'loading', 'name', 'referrerpolicy', 'sandbox', 'title'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
    col: ['span'],
    ol: ['start', 'reversed', 'type'],
    li: ['value'],
    time: ['datetime'],
    details: ['open'],
    bdo: ['dir'],
  },
  allowedStyles: {
    '*': {
      'text-align': [/^(?:left|right|center|justify)$/],
      color: COLOR,
      'background-color': COLOR,
      'font-weight': [/^(?:normal|bold|[1-9]00)$/],
      'font-style': [/^(?:normal|italic|oblique)$/],
      'text-decoration': [/^(?:none|underline|line-through|overline)$/],
    },
    // TABLE SIZING ONLY. A dragged column width is the one thing the toolbars cannot express as a
    // utility class — the author picks an arbitrary number — so `width`/`height` are allowed here and
    // NOWHERE else, gated to a bounded px/% literal (RICH_TABLE_SIZE_RE: no calc(), var(), or url()).
    // Scoped per-tag rather than on `*` so authored HTML still cannot resize arbitrary page elements;
    // sanitize-html merges each tag's entry with the `*` entry above.
    ...Object.fromEntries(
      (['table', 'colgroup', 'col', 'tr', 'th', 'td'] as const).map((tag) => [
        tag,
        { width: [RICH_TABLE_SIZE_RE], height: [RICH_TABLE_SIZE_RE], 'table-layout': [/^(?:auto|fixed)$/] },
      ]),
    ),
  },
  // Schemes for href/src. `data:`/`javascript:`/`vbscript:` are absent → discarded; iframe is further
  // gated to https only. Relative URLs (no scheme, e.g. `/media/…`) are permitted by sanitize-html.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { iframe: ['https'] },
  // Scheme-gate every URL-bearing attribute we allow — the lib default is href/src/cite only, which
  // would let a `data:`/`javascript:` slip through `<video poster>`.
  allowedSchemesAppliedToAttributes: ['href', 'src', 'cite', 'poster'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  // Drop an iframe that has no valid https src (rather than leaving an empty frame).
  exclusiveFilter: (frame) =>
    frame.tag === 'iframe' && !(typeof frame.attribs.src === 'string' && /^https:\/\//i.test(frame.attribs.src)),
  transformTags: {
    // NO HEADING TAGS SURVIVE. This sink is a FRAGMENT dropped into a region of a page that already has
    // its own outline (`data-sw-html` / `{{sw-html}}`), so an <h3> here joins that outline at whatever
    // level someone happened to pick — heading spam the page's author never chose. It is also the only
    // enforcement point that covers the HTML-SOURCE editor, where the toolbar's rules do not apply.
    //
    // REWRITTEN, not discarded: dropping the tag would take the text with it and silently gut existing
    // content. A `<p class="sw-h3">` keeps the words, and `sw-h1`–`sw-h6` reproduce exactly what an
    // h1–h6 rendered as before (the UA size scale the platform baseline deliberately keeps, plus the
    // project's heading font/weight), so nothing moves visually. Platform CSS rather than Tailwind
    // utilities on purpose: these classes are synthesised at RENDER, so the publish build's source scan
    // would never see them and a utility would compile in preview and vanish on the published site.
    ...Object.fromEntries(
      (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).map((h) => [
        h,
        (_tagName: string, attribs: Record<string, string>) => {
          // Append, don't clobber — an author's own classes on the heading are kept. Deduped so
          // markup that already names the look-alike class doesn't end up carrying it twice.
          const classes = (attribs.class ?? '').split(/\s+/).filter(Boolean);
          if (!classes.includes(`sw-${h}`)) classes.push(`sw-${h}`);
          return { tagName: 'p', attribs: { ...attribs, class: classes.join(' ') } };
        },
      ]),
    ),
    // We fully control `rel`: drop any author value (so a bare `rel="opener"` can't slip through) and
    // set `noopener noreferrer` only when the link opens a new browsing context.
    a: (tagName, attribs) => {
      const next: Record<string, string> = { ...attribs };
      delete next.rel;
      if (next.target) next.rel = 'noopener noreferrer';
      return { tagName, attribs: next };
    },
    // FORCE a restrictive sandbox (note: NO `allow-same-origin` — with allow-scripts that would defeat
    // the sandbox) + no-referrer, overriding any author-supplied sandbox. Embeds run isolated.
    iframe: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        sandbox: 'allow-scripts allow-popups allow-presentation allow-forms',
        referrerpolicy: 'no-referrer',
        loading: typeof attribs.loading === 'string' ? attribs.loading : 'lazy',
      },
    }),
  },
};

/**
 * Sanitizes client-authored HTML to the allowlist above. Idempotent (sanitizing already-clean HTML is
 * a no-op), so it is safe to run both at SAVE (authoritative) and at RENDER (defensive — catches a
 * value that reached the store via import/seed/DB).
 */
export function sanitizeRichHtml(html: string): string {
  if (typeof html !== 'string' || html === '') return '';
  return sanitizeHtml(html, RICH_OPTIONS);
}
