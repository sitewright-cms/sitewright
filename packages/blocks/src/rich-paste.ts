// Paste hygiene for the two rich-text surfaces (the dataset `richtext` field and the on-page
// `data-sw-html` toolbar). Word, Google Docs and LibreOffice put a second, private markup dialect on the
// clipboard — `class="MsoNormal"`, `<o:p>`, conditional comments, and a font-family/font-size inline
// style on every run. Dropped into a contentEditable verbatim it renders "right" in the editor and then
// fights the site's own typography forever after, because none of it is expressible in the platform's
// vocabulary and none of it follows a theme change.
//
// So: DETECT that dialect (`isForeignRichHtml`) and, once the author agrees, SNAP the paste onto the
// primitives the toolbars themselves emit (`cleanPastedHtml`) — semantic marks/blocks plus the bounded
// Tailwind class palettes from rich-toolbar.ts. Everything else is dropped.
//
// ONE implementation, both surfaces: the React field calls this directly, and the sandboxed preview
// bridge — which cannot import at runtime — round-trips the clipboard HTML through the editor parent
// over postMessage (the same way it already borrows the media picker and the HTML-source modal).
import { parseDocument } from 'htmlparser2';
// `isTag`/`isText` rather than `instanceof`: htmlparser2 bundles its OWN copy of domhandler, so the nodes
// parseDocument returns are NOT instances of the classes this module imports — an instanceof check here is
// silently always false and the whole walk becomes a no-op. The type-tag helpers work across both copies.
import { Element, isTag, isText, type AnyNode, type ChildNode } from 'domhandler';
import render from 'dom-serializer';
import { sanitizeRichHtml } from './sanitize-rich.js';
import {
  RICH_ALIGNS,
  RICH_COLORS,
  RICH_HIGHLIGHTS,
  RICH_CONTENT_SAFELIST,
  setGroupClass,
  RICH_ALIGN_CLASSES,
  RICH_COLOR_CLASSES,
  RICH_HIGHLIGHT_CLASSES,
  type CiSwatch,
} from './rich-toolbar.js';

/** The wording BOTH surfaces show when a foreign paste is detected, so the two prompts read identically. */
export const RICH_PASTE_PROMPT = {
  title: 'Clean up pasted formatting?',
  body:
    'This looks like it came from a word processor (Word, Google Docs, Pages…). Its private formatting ' +
    "won't follow your site's fonts, colours or theme. Cleaning keeps the text, links, lists, tables and " +
    'images, and snaps colours and alignment onto your site’s own styles.',
  clean: 'Clean up',
  keep: 'Keep original formatting',
} as const;

// --- Detection ---------------------------------------------------------------------------------

/** Signatures of a word-processor / external-editor clipboard payload. Deliberately specific: the
 *  platform's OWN copy-paste round-trip (editor → editor) emits none of these, so the prompt does not
 *  fire on an author moving a paragraph within their own site. */
const FOREIGN_MARKERS: readonly RegExp[] = [
  /mso-/i, //                                   Word inline style prefix
  /class=["']?Mso/i, //                          Word paragraph/character styles
  /<\/?o:p\b/i, //                               Word's empty-paragraph element
  /xmlns:(?:o|w|m|v)=/i, //                      Word's Office namespaces
  /urn:schemas-microsoft-com/i, //               ditto, on the root element
  /<!--\s*\[if\s+[^\]]*mso/i, //                 Word's conditional comments
  /docs-internal-guid/i, //                      Google Docs
  /<meta[^>]+content=["']?[^"'>]*(?:Microsoft Word|LibreOffice|OpenOffice|Pages)/i,
  /<font\b/i, //                                 legacy presentational markup
  /style=["'][^"']*font-(?:family|size)\s*:/i, // a per-run font stack: no toolbar of ours emits one
];

/**
 * True when `html` carries a foreign word-processor dialect worth offering to clean. Cheap string tests
 * only — this runs on the paste event's critical path, before anything is inserted.
 */
export function isForeignRichHtml(html: string): boolean {
  if (typeof html !== 'string' || html === '') return false;
  return FOREIGN_MARKERS.some((re) => re.test(html));
}

// --- Colour snapping ---------------------------------------------------------------------------

/** Parse `#rgb`/`#rrggbb`/`rgb()`/`rgba()` into a 0-255 triple, or null when it isn't a literal colour
 *  we can measure (a named colour, `transparent`, `inherit`, a var()). */
function parseRgb(value: string): [number, number, number] | null {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1]!;
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  }
  const fn = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/.exec(v);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  if (v === 'black') return [0, 0, 0];
  if (v === 'white') return [255, 255, 255];
  return null;
}

/** Squared euclidean distance in RGB — good enough to pick the obviously-closest swatch, and it avoids
 *  a colour-space dependency for what is a "which of eleven crayons is this" question. */
function rgbDistance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** How dark a pasted text colour has to be before we treat it as "just body text" and emit NO colour
 *  class. Word writes `color:black` / `#000000` on ordinary paragraphs; snapping that to the nearest
 *  palette entry would repaint every pasted word slate-grey. 72 ≈ #484848. */
const NEAR_BLACK = 72;
/** Likewise for highlights: anything this close to white (or fully transparent) is "no highlight". */
const NEAR_WHITE = 216;

/**
 * Snap a literal CSS colour onto the nearest TEXT-colour class from the standard palette plus the
 * project's CI colours, or `''` for "leave it as body text". Exported for testing.
 */
export function snapTextColor(value: string, ci: readonly CiSwatch[] = []): string {
  const rgb = parseRgb(value);
  if (!rgb) return '';
  if (Math.max(rgb[0], rgb[1], rgb[2]) <= NEAR_BLACK) return ''; // ordinary body text
  let best = '';
  let bestD = Infinity;
  for (const sw of [...ci, ...RICH_COLORS]) {
    const target = sw.value ? parseRgb(sw.value) : null;
    if (!sw.cls || !target) continue;
    const d = rgbDistance(rgb, target);
    if (d < bestD) {
      bestD = d;
      best = sw.cls;
    }
  }
  return best;
}

/** Snap a literal CSS background colour onto the nearest HIGHLIGHT class, or `''` for no highlight. */
export function snapHighlight(value: string): string {
  const v = value.trim().toLowerCase();
  if (v === 'transparent' || v === 'none') return '';
  const rgb = parseRgb(v);
  if (!rgb) return '';
  if (Math.min(rgb[0], rgb[1], rgb[2]) >= NEAR_WHITE) return ''; // white-ish → no highlight
  let best = '';
  let bestD = Infinity;
  for (const sw of RICH_HIGHLIGHTS) {
    const target = sw.value ? parseRgb(sw.value) : null;
    if (!sw.cls || !target) continue;
    const d = rgbDistance(rgb, target);
    if (d < bestD) {
      bestD = d;
      best = sw.cls;
    }
  }
  return best;
}

// --- The cleaner -------------------------------------------------------------------------------

/** Blocks that may carry an alignment class (an inline span cannot — `text-align` does nothing there). */
const BLOCK_TAGS = new Set([
  'p', 'div', 'blockquote', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'td', 'th', 'figure', 'figcaption',
  'section', 'article', 'header', 'footer', 'main', 'aside', 'pre', 'table', 'caption',
]);
/** Elements that only ever existed to carry foreign attributes — unwrap once they have none left. */
const UNWRAP_WHEN_BARE = new Set(['span', 'div', 'font']);
/** Never dropped for being "empty" — they ARE their emptiness. */
const VOID_OR_MEANINGFUL = new Set(['br', 'hr', 'img', 'source', 'track', 'wbr', 'td', 'th', 'iframe', 'video', 'audio']);
/** Table sizing declarations the toolbars themselves emit — kept, unlike every other foreign style. */
const KEPT_STYLE_PROPS = new Set(['width', 'height']);
const TABLE_TAGS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'col', 'colgroup']);

/** The class tokens that MEAN something on a published page: the toolbars' own palettes, the project's CI
 *  classes, and the heading look-alikes the render sanitizer synthesises. Everything else is foreign. */
function platformClassSet(ci: readonly CiSwatch[]): ReadonlySet<string> {
  return new Set<string>([...RICH_CONTENT_SAFELIST, ...ci.map((c) => c.cls)]);
}

/** Marks an inline style can imply, mapped to the semantic tag the toolbars emit for them. */
function markTagFor(prop: string, value: string): string | null {
  const v = value.trim().toLowerCase();
  if (prop === 'font-weight') return v === 'bold' || v === 'bolder' || /^[6-9]00$/.test(v) ? 'strong' : null;
  if (prop === 'font-style') return v === 'italic' || v === 'oblique' ? 'em' : null;
  if (prop === 'text-decoration' || prop === 'text-decoration-line') {
    if (v.includes('line-through')) return 's';
    if (v.includes('underline')) return 'u';
  }
  return null;
}

/** Wrap an element's children in `tag`, in place. Used to turn an inline `font-weight:bold` into the
 *  `<strong>` the toolbar would have produced. */
function wrapChildren(el: Element, tag: string): void {
  const wrapper = new Element(tag, {}, el.children as ChildNode[]);
  for (const child of wrapper.children) child.parent = wrapper;
  el.children = [wrapper];
  wrapper.parent = el;
}

/** Replace `el` with its own children (unwrap), keeping document order. */
function unwrap(el: Element): void {
  const parent = el.parent as Element | null;
  if (!parent) return;
  const idx = parent.children.indexOf(el);
  if (idx < 0) return;
  for (const child of el.children) child.parent = parent;
  parent.children.splice(idx, 1, ...(el.children as ChildNode[]));
}

/** True when the subtree holds nothing an author would miss — no text beyond whitespace/nbsp, and no
 *  element that stands on its own (an image, a rule, a line break). Word emits crowds of these. */
function isEmptyish(node: AnyNode): boolean {
  if (isText(node)) return node.data.replace(/[\s\u00a0]+/g, '') === '';
  if (!isTag(node)) return true; // comments/directives carry nothing
  if (VOID_OR_MEANINGFUL.has(node.name)) return false;
  return node.children.every((c) => isEmptyish(c));
}

function tokenize(cls: string | undefined): string[] {
  return (cls ?? '').split(/\s+/).filter(Boolean);
}

/**
 * Snap client-pasted HTML onto the platform's WYSIWYG primitives.
 *
 * Runs `sanitizeRichHtml` first (the XSS allowlist, which also rewrites headings), then:
 *  · drops every `class` token outside the toolbars' own palettes + the project's CI classes, and every `id`
 *    (Word's `MsoNormal`, Google Docs' `docs-internal-guid`);
 *  · turns an inline `font-weight`/`font-style`/`text-decoration` into the semantic `<strong>/<em>/<u>/<s>`
 *    the toolbar emits, and snaps `color`/`background-color`/`text-align` onto the nearest palette CLASS;
 *  · keeps `width`/`height` on table elements (the toolbars' own column/row sizes) and drops every other
 *    declaration;
 *  · unwraps `span`/`div`/`font` left with no attributes, drops paragraphs that hold only `&nbsp;`, and
 *    collapses the nbsp runs Word uses for indentation into ordinary spaces.
 *
 * `ci` is the project's brand palette (from `ciRichPalette`) so a pasted brand colour snaps to the brand
 * class rather than the nearest standard crayon. Pure: no DOM, safe on either surface and in Node.
 */
export function cleanPastedHtml(html: string, ci: readonly CiSwatch[] = []): string {
  if (typeof html !== 'string' || html === '') return '';
  const allowed = platformClassSet(ci);
  const colorGroup = new Set<string>([...RICH_COLOR_CLASSES, ...ci.map((c) => c.cls)]);
  const doc = parseDocument(sanitizeRichHtml(html));

  const visit = (node: AnyNode): void => {
    if (isText(node)) {
      // Word indents with runs of &nbsp;. As text they are unbreakable and immune to the site's own
      // spacing, so they become ordinary spaces; the surrounding whitespace collapses with them.
      node.data = node.data.replace(/\u00a0/g, ' ').replace(/[ \t]{2,}/g, ' ');
      return;
    }
    if (!isTag(node)) return;
    for (const child of [...node.children]) visit(child); // depth-first: children settle before the parent

    const attribs = node.attribs ?? {};
    const isTable = TABLE_TAGS.has(node.name);
    let classes = tokenize(attribs.class).filter((t) => allowed.has(t) || /^sw-h[1-6]$/.test(t));
    const marks: string[] = [];
    let style = '';

    for (const decl of (attribs.style ?? '').split(';')) {
      const colon = decl.indexOf(':');
      if (colon < 0) continue;
      const prop = decl.slice(0, colon).trim().toLowerCase();
      const value = decl.slice(colon + 1).trim();
      if (!value) continue;
      if (isTable && KEPT_STYLE_PROPS.has(prop)) {
        style = style ? `${style}; ${prop}: ${value}` : `${prop}: ${value}`;
        continue;
      }
      const mark = markTagFor(prop, value);
      if (mark) {
        if (!marks.includes(mark)) marks.push(mark);
        continue;
      }
      if (prop === 'color') {
        classes = tokenize(setGroupClass(classes.join(' '), colorGroup, snapTextColor(value, ci) || undefined));
      } else if (prop === 'background-color') {
        classes = tokenize(setGroupClass(classes.join(' '), RICH_HIGHLIGHT_CLASSES, snapHighlight(value) || undefined));
      } else if (prop === 'text-align' && BLOCK_TAGS.has(node.name)) {
        const hit = RICH_ALIGNS.find((a) => a.label.toLowerCase() === value.toLowerCase());
        classes = tokenize(setGroupClass(classes.join(' '), RICH_ALIGN_CLASSES, hit?.cls));
      }
      // every other declaration (font-family, font-size, margin, line-height, mso-*) is dropped
    }

    // `id` is dropped wholesale: the only ids in a paste are the foreign editor's own bookmarks, and a
    // duplicate id landing in the page is an accessibility bug the author never sees.
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(attribs)) {
      if (k === 'class' || k === 'style' || k === 'id') continue;
      next[k] = v;
    }
    if (classes.length) next.class = classes.join(' ');
    if (style) next.style = style;
    node.attribs = next;

    for (const mark of marks) wrapChildren(node, mark);

    if (UNWRAP_WHEN_BARE.has(node.name) && Object.keys(next).length === 0) unwrap(node);
    else if (node.name === 'p' && isEmptyish(node)) {
      // Word writes a blank line the author typed as `<p class=MsoNormal>&nbsp;</p>`. Deleting it would
      // silently close up their spacing, and unwrapping it would leak the nbsp into the surrounding flow;
      // the platform's own empty paragraph is `<p><br></p>`, so become that.
      const br = new Element('br', {});
      br.parent = node;
      node.children = [br];
    }
  };

  for (const child of [...doc.children]) visit(child);
  // Serialize, then let the sanitizer normalize the result — it is idempotent, so this only guarantees
  // that what we hand back is exactly what the render boundary would keep.
  return sanitizeRichHtml(render(doc.children, { decodeEntities: true })).trim();
}

/** Convenience for the surfaces: the plain-text fallback, escaped into paragraphs, when the clipboard
 *  carries no usable HTML at all. Blank lines split paragraphs; single newlines become `<br>`. */
export function plainTextToHtml(text: string): string {
  if (typeof text !== 'string' || text.trim() === '') return '';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
