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
