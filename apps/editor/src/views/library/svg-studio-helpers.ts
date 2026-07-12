// Pure, DOM-only helpers for the SVG Animation Studio — parse/sanitize an imported SVG, stamp ids for
// tree linkage + click-selection, build the element tree (groups nested), and read a media asset back out
// of its URL. Kept separate from the React component so they're directly unit-testable.

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Elements the Studio can animate / show in the tree. */
export const ANIMATABLE = new Set(['path', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'rect', 'text', 'g', 'use', 'image']);

/** Parse + sanitize an SVG string into a detached <svg> (script/foreignObject/on* stripped; namespace
 *  repaired if missing). Returns null when the input isn't a usable SVG. */
export function parseSvg(text: string): SVGSVGElement | null {
  let t = text.trim();
  if (!t) return null;
  if (t.indexOf('xmlns') < 0) t = t.replace(/<svg/i, `<svg xmlns="${SVG_NS}"`);
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(t, 'image/svg+xml');
  } catch {
    return null;
  }
  if (doc.querySelector('parsererror')) return null;
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null;
  svg.querySelectorAll('script,foreignObject').forEach((n) => n.remove());
  const sanitizeEl = (n: Element) => {
    for (let i = n.attributes.length - 1; i >= 0; i--) {
      const a = n.attributes[i]!;
      if (/^on/i.test(a.name)) n.removeAttribute(a.name);
      else if (/(?:^|:)href$/i.test(a.name) && /^\s*(?:javascript|vbscript|data):/i.test(a.value)) n.setAttribute(a.name, '#');
    }
  };
  sanitizeEl(svg);
  svg.querySelectorAll('*').forEach(sanitizeEl);
  return svg as unknown as SVGSVGElement;
}

// Namespaces used only by SVG editors (Inkscape, Sodipodi, Adobe Illustrator) or RDF/Dublin-Core
// metadata. Nothing in them renders or drives animation, so every element/attribute here is cruft.
const EDITOR_NS = new Set([
  'http://www.inkscape.org/namespaces/inkscape',
  'http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  'http://purl.org/dc/elements/1.1/',
  'http://creativecommons.org/ns#',
  'http://web.resource.org/cc/',
  'http://ns.adobe.com/AdobeIllustrator/10.0/',
  'http://ns.adobe.com/Graphs/1.0/',
  'http://ns.adobe.com/AdobeSVGViewerExtensions/3.0/',
  'http://ns.adobe.com/Extensibility/1.0/',
  'http://ns.adobe.com/Flows/1.0/',
  'http://ns.adobe.com/ImageReplacement/1.0/',
  'http://ns.adobe.com/SaveForWeb/1.0/',
  'http://ns.adobe.com/Variables/1.0/',
  'http://ns.adobe.com/GenericCustomNamespace/1.0/',
  'http://ns.adobe.com/XPath/1.0/',
]);
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
/** Distinctive editor prefixes, used ONLY as a fallback when the parser left a prefix unresolved
 *  (a well-formed editor SVG resolves these via EDITOR_NS instead). Ambiguous single-letter prefixes
 *  (i/x/a) are intentionally excluded — a legitimate custom namespace could reuse them; when they really
 *  are Adobe's they resolve through the namespace-URI check below. */
const EDITOR_PREFIXES = new Set(['inkscape', 'sodipodi', 'rdf', 'dc', 'cc', 'graph']);
/** Elements whose text content is significant — never strip whitespace/comments inside these. */
const TEXTUAL = new Set(['text', 'tspan', 'textpath', 'tref', 'title', 'desc', 'style', 'altglyph']);
/** Pure editor-bookkeeping attributes (layer names) — safe to drop anywhere. Exact-match (not a prefix
 *  match), so `data-sw-*` animation directives are untouched. */
const JUNK_ATTRS = new Set(['data-name']);

/** Remove editor-only attributes from one element: namespaced (inkscape:*, sodipodi:*, i:* …), their
 *  leftover `xmlns:…` declarations, and layer-name attrs. Preserves id/class/style, xmlns, xmlns:xlink,
 *  xlink:href, xml:*, geometry, and every data-sw-* directive. */
function cleanAttrs(el: Element): void {
  for (let i = el.attributes.length - 1; i >= 0; i--) {
    const a = el.attributes[i]!;
    const ns = a.namespaceURI || '';
    if (ns === XMLNS_NS) {
      // A namespace declaration: drop it only when it BINDS a prefix to an editor namespace URI. Keeps
      // the default xmlns, xmlns:xlink, and any legitimate custom namespace — prefix name is irrelevant.
      if (a.localName !== 'xmlns' && EDITOR_NS.has(a.value)) el.removeAttribute(a.name);
    } else if (ns && EDITOR_NS.has(ns)) {
      el.removeAttribute(a.name); // resolved editor attr: inkscape:label, sodipodi:role, i:extraneous …
    } else if (JUNK_ATTRS.has(a.name.toLowerCase())) {
      el.removeAttribute(a.name); // data-name
    } else if (!ns) {
      // Fallback ONLY for an unresolved prefix (parser couldn't bind it): match a distinctive editor
      // prefix by name. A resolved non-editor attribute (ns set, not editor) is left untouched.
      const colon = a.name.indexOf(':');
      if (colon > 0 && EDITOR_PREFIXES.has(a.name.slice(0, colon).toLowerCase())) el.removeAttribute(a.name);
    }
  }
}

/** Remove comment nodes + insignificant (whitespace-only) indentation text, skipping text/CSS subtrees.
 *  Iterative (explicit stack) so a pathologically deep SVG can't overflow the call stack. */
function stripCommentsAndSpace(root: Element): void {
  const stack: Element[] = [root];
  while (stack.length) {
    const el = stack.pop()!;
    if (TEXTUAL.has(el.localName.toLowerCase())) continue;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 8 /* Comment */) el.removeChild(child);
      else if (child.nodeType === 3 /* Text */ && !/\S/.test(child.nodeValue || '')) el.removeChild(child);
      else if (child.nodeType === 1 /* Element */) stack.push(child as Element);
    }
  }
}

/**
 * Optional "clean up code" pass for imported SVGs: strip everything design tools leave behind that has no
 * effect on rendering or animation — XML comments (`<!-- Generator: … -->`), `<metadata>`/RDF blocks,
 * editor namespaces (Inkscape / Sodipodi / Illustrator) and their attributes, `data-name` layer labels,
 * and indentation whitespace. Deliberately PRESERVES everything relevant: `<style>`/class/inline-style
 * (CSS), ids (animation targeting + `url(#…)` refs), `<defs>` gradients/filters/masks, geometry, and all
 * `data-sw-*` directives. Idempotent. Mutates in place (like {@link stampIds}); run before stampIds.
 */
export function cleanupSvg(svg: Element): void {
  // 1. Drop editor-only elements: <metadata> and anything in an editor/RDF namespace (collect first —
  //    querySelectorAll is static, so removing as we go is safe; nested doomed nodes .remove() as no-ops).
  const doomed: Element[] = [];
  svg.querySelectorAll('*').forEach((el) => {
    if (el.localName.toLowerCase() === 'metadata' || EDITOR_NS.has(el.namespaceURI || '')) doomed.push(el);
  });
  doomed.forEach((el) => el.remove());
  // 2. Comments + insignificant whitespace.
  stripCommentsAndSpace(svg);
  // 3. Editor attributes / leftover xmlns declarations / layer names (root + every descendant).
  cleanAttrs(svg);
  svg.querySelectorAll('*').forEach(cleanAttrs);
}

const INDENT = '  ';
/** Escape a text node for XML output (& and < are the only required escapes in character data). */
function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
/** The element's open tag with verbatim attributes — INCLUDING xmlns declarations (they're plain
 *  attributes), so the printed markup is namespace-correct without a serializer re-declaring anything. */
function openTag(el: Element, selfClose: boolean): string {
  let s = `<${el.tagName}`;
  for (const a of Array.from(el.attributes)) s += ` ${a.name}="${escText(a.value).replace(/"/g, '&quot;')}"`;
  return s + (selfClose ? '/>' : '>');
}
function hasElementChild(el: Element): boolean {
  for (const c of Array.from(el.childNodes)) if (c.nodeType === 1) return true;
  return false;
}
/** A direct text child with non-whitespace content → mixed/textual content (reformatting would change it). */
function hasSignificantText(el: Element): boolean {
  for (const c of Array.from(el.childNodes)) if (c.nodeType === 3 && /\S/.test(c.nodeValue || '')) return true;
  return false;
}
/** Serialize a node subtree on ONE line with whitespace preserved EXACTLY — for text/CSS-bearing and leaf
 *  subtrees where indentation would change rendering. Iterative so a pathologically deep inline subtree
 *  (e.g. nested <tspan>) can't overflow the stack. CDATA (`<![CDATA[…]]>`, as Inkscape/Illustrator wrap
 *  `<style>` CSS) is emitted as escaped text — semantically identical, and never dropped. */
function inlineNode(root: Node): string {
  let out = '';
  const stack: Array<{ node: Node } | { close: string }> = [{ node: root }];
  while (stack.length) {
    const f = stack.pop()!;
    if ('close' in f) {
      out += f.close;
      continue;
    }
    const node = f.node;
    if (node.nodeType === 3 || node.nodeType === 4) {
      out += escText(node.nodeValue || ''); // text / CDATA
      continue;
    }
    if (node.nodeType === 8) {
      out += `<!--${(node as Comment).data}-->`;
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const kids = Array.from(el.childNodes);
    if (!kids.length) {
      out += openTag(el, true);
      continue;
    }
    out += openTag(el, false);
    stack.push({ close: `</${el.tagName}>` });
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i]! });
  }
  return out;
}

/**
 * Pretty-print an SVG DOM to indented, multi-line markup — so a saved/exported file reads cleanly instead
 * of collapsing onto one line. Container elements are block-indented; but any text-significant subtree
 * (`<text>`/`<tspan>`/`<style>`/`<title>`/`<desc>`… and any element carrying mixed text) is emitted INLINE
 * so its whitespace — and its rendered layout — is preserved exactly. Attributes (incl. xmlns declarations)
 * are written verbatim, so the output is namespace-correct. Iterative over the block (container) nesting so
 * a deep SVG can't overflow the stack.
 */
export function prettySvg(svg: Element): string {
  const out: string[] = [];
  const stack: Array<{ node: Node; depth: number } | { close: string; depth: number }> = [{ node: svg, depth: 0 }];
  while (stack.length) {
    const f = stack.pop()!;
    if ('close' in f) {
      out.push(INDENT.repeat(f.depth) + f.close);
      continue;
    }
    const { node, depth } = f;
    const pad = INDENT.repeat(depth);
    if (node.nodeType === 8) {
      out.push(pad + `<!--${(node as Comment).data}-->`);
      continue;
    }
    if (node.nodeType === 3 || node.nodeType === 4) {
      const t = (node.nodeValue || '').trim();
      if (t) out.push(pad + escText(t)); // text / CDATA
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    // Inline (verbatim, single line) when the subtree is text-significant, mixed, or a leaf.
    if (TEXTUAL.has(el.localName.toLowerCase()) || hasSignificantText(el) || !hasElementChild(el)) {
      out.push(pad + inlineNode(el));
      continue;
    }
    // Block: open tag, element children indented (indentation whitespace dropped), aligned close.
    out.push(pad + openTag(el, false));
    stack.push({ close: `</${el.tagName}>`, depth });
    const kids = Array.from(el.childNodes).filter((c) => !(c.nodeType === 3 && !/\S/.test(c.nodeValue || '')));
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i]!, depth: depth + 1 });
  }
  return out.join('\n');
}

/** True when an upload looks like an SVG (by MIME type or `.svg` extension). */
export function isSvgUpload(file: File): boolean {
  return file.type === 'image/svg+xml' || file.type === 'image/svg' || /\.svg$/i.test(file.name);
}

/**
 * Best-effort "clean up code" for an uploaded SVG File: strip editor cruft ({@link cleanupSvg}) and
 * pretty-print ({@link prettySvg}), returning a NEW File with the tidied bytes (same name, image/svg+xml).
 * A non-SVG file, or SVG that fails to parse, is returned UNCHANGED — cleanup never blocks an upload, and
 * the server still sanitizes on store. Preserves CSS, ids, geometry and animation; removes comments,
 * `<metadata>`, Inkscape/Illustrator namespaces, `data-name`, and indentation.
 */
export async function cleanSvgFile(file: File): Promise<File> {
  if (!isSvgUpload(file)) return file;
  let text: string;
  try {
    text = await readAsText(file); // FileReader (not Blob.text) — universally supported incl. test env
  } catch {
    return file;
  }
  const svg = parseSvg(text);
  if (!svg) return file; // not a usable SVG → leave it for the server to handle/reject
  cleanupSvg(svg);
  return new File([prettySvg(svg)], file.name, { type: 'image/svg+xml' });
}
/** Read a Blob as UTF-8 text via FileReader (Promise-wrapped). */
function readAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsText(blob);
  });
}

let stampCounter = 0;
/** TEST-ONLY: reset the stamp counter so ids are deterministic. */
export function resetStampCounter(): void {
  stampCounter = 0;
}
/** Give every animatable element without an id a stable id (used for tree linkage + click selection). */
export function stampIds(svg: Element): void {
  svg.querySelectorAll('*').forEach((el) => {
    if (ANIMATABLE.has(el.tagName.toLowerCase()) && !el.getAttribute('id')) el.setAttribute('id', `sw-el-${++stampCounter}`);
  });
}

export interface TreeNode {
  id: string;
  tag: string;
  label: string;
  authored: boolean;
  depth: number;
  children: TreeNode[];
}

/** Build the element tree (groups nested). `authored` = the id was in the source (not a stamped id). */
export function buildTree(el: Element, depth: number): TreeNode[] {
  const out: TreeNode[] = [];
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    if (!ANIMATABLE.has(tag)) continue;
    const id = child.getAttribute('id') || '';
    const authored = !/^sw-el-\d+$/.test(id);
    out.push({ id, tag, label: tag, authored, depth, children: tag === 'g' ? buildTree(child, depth + 1) : [] });
  }
  return out;
}

/** {id, filename} of the media asset the SVG was imported from (enables in-place overwrite on save). */
export interface SourceAsset {
  id: string;
  filename: string;
}
/** The media URL for an SVG asset is `/media/<slug>/<assetId>/<name>` — pull the assetId + filename back. */
export function assetFromUrl(url: string): SourceAsset | null {
  const m = url.match(/\/media\/[^/]+\/([^/]+)\/(?:file\/)?([^/?#]+)/);
  return m ? { id: m[1]!, filename: decodeURIComponent(m[2]!) } : null;
}

/** Escape a value for use inside a `[id="…"]` attribute selector. */
export function cssEsc(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}
