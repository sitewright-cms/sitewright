// CONSERVATIVE dataset/template inference. A container with ≥4 structurally-identical children (a card
// grid, a team list, a post list) is turned into a Dataset + Entries + a single {{#each}} card template,
// so the repeated content becomes editable structured data instead of copy-pasted HTML. Deliberately
// safe: it only fires when every child shares the SAME leaf signature, generic field names are used, the
// generated loop is validateTemplate-checked, and ANYTHING uncertain leaves the literal HTML untouched
// (the AI rewrite stage handles the nuanced cases). The container's children are replaced by a sentinel
// text marker; build.ts swaps the marker for the generated loop after the page transform.
import { validateTemplate } from '@sitewright/blocks';
import { textContent } from 'domutils';
import type { Dataset, Entry, Field } from '@sitewright/schema';
import { elements, isTag, isText, serialize, setText, type AnyNode, type Document, type Element } from '../dom.js';
import { pickFromSrcset, rewriteHref } from '../url-util.js';
import { effectiveBg, effectiveSrc, effectiveSrcset } from './assets.js';
import { imageRef, sanitizeForSource, type TransformCtx } from './page.js';

const MIN_CHILDREN = 4;
const MAX_ENTRIES = 100;
const MAX_DATASETS_PER_PAGE = 3;
const MAX_SLOTS = 12;
const MAX_DEPTH = 64;

export type SlotType = 'text' | 'image' | 'link' | 'bg';
export interface Slot {
  type: SlotType;
  el: Element;
}

/** A real background-image URL on an element — lazy (`data-background-image` etc.) or inline `style`.
 *  Excludes data: URIs / gradients (no per-item value to field-ize). */
export function bgUrl(el: Element): string | undefined {
  const fromStyle = (el.attribs.style ?? '').match(/background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i)?.[1];
  const url = (effectiveBg(el.attribs) || fromStyle || '').trim();
  return url && !/^data:/i.test(url) ? url : undefined;
}

export interface DatasetInference {
  datasets: Dataset[];
  entries: Entry[];
  /** sentinel marker (placed in the doc) → the {{#each}} loop + its dataset slug, for build.ts to
   *  splice into the page source (and to drop the dataset if the marker didn't survive the transform). */
  markers: Map<string, { loop: string; slug: string }>;
}

/** Ordered slots of a card subtree: a (lazy) BACKGROUND image, <img> (image), <a href> (link), and leaf
 *  text elements. The card ROOT itself is inspected first — a clickable card (`<a href>`) and/or a
 *  background-image card carries its per-item link/image ON THE ROOT, which the descendant walk never sees
 *  (so without this they'd bake static into the loop — every tile the same link + image). */
/** Does `el` contain an `<img>`, a real `<a href>` link, or a background image anywhere below it? Such a
 *  node must be RECURSED (to field-ize the media/link), not flattened into a single text slot. */
function hasMediaDescendant(el: Element): boolean {
  const stack: AnyNode[] = [...el.children];
  let guard = 0;
  while (stack.length > 0 && guard++ < 500) {
    const n = stack.pop();
    if (!n || !isTag(n)) continue;
    if (n.name === 'img' || bgUrl(n)) return true;
    const href = (n.attribs.href ?? '').trim();
    if (n.name === 'a' && href !== '' && !href.startsWith('#')) return true;
    stack.push(...n.children);
  }
  return false;
}

export function collectSlots(root: Element): Slot[] {
  const out: Slot[] = [];
  const rootHref = (root.attribs.href ?? '').trim();
  if (root.name === 'a' && rootHref !== '' && !rootHref.startsWith('#')) out.push({ type: 'link', el: root });
  if (bgUrl(root)) out.push({ type: 'bg', el: root });
  const visit = (nodes: AnyNode[], depth: number): void => {
    if (depth > MAX_DEPTH) return; // guard pathologically deep card markup (stack safety)
    for (const n of nodes) {
      if (out.length >= MAX_SLOTS) break;
      if (!isTag(n)) continue;
      if (bgUrl(n)) out.push({ type: 'bg', el: n }); // an inner element's background image (e.g. a card thumb)
      if (n.name === 'img') {
        out.push({ type: 'image', el: n });
        continue;
      }
      const href = (n.attribs.href ?? '').trim();
      if (n.name === 'a' && href !== '' && !href.startsWith('#')) {
        out.push({ type: 'link', el: n });
        visit(n.children, depth + 1); // an <a> may wrap an <img>
        continue;
      }
      const childEls = n.children.filter(isTag);
      const directText = n.children.filter(isText).map((t) => t.data).join('').trim();
      // A TEXT BLOCK — direct text plus only inline styling (a `<span>`/`<b>`/… with NO media/link
      // descendant) → ONE text slot capturing the WHOLE node's text. Previously leading text before an
      // inner element was DROPPED and only the inner element field-ized, so a repeated card baked the first
      // card's leading text as fixed and bound every other card's value into the span (burmeister
      // management: every director read "Mr. Ronald L. Kubas <their name>").
      if (directText !== '' && !hasMediaDescendant(n)) {
        out.push({ type: 'text', el: n });
        continue;
      }
      if (childEls.length === 0 && directText !== '') {
        out.push({ type: 'text', el: n });
        continue;
      }
      visit(n.children, depth + 1);
    }
  };
  visit(root.children, 0);
  return out;
}

/** Readable, unique-per-dataset field names for a slot-type sequence (the user/AI renames later):
 *  first text → title, second → description, then text3…; first image → image, first link → link. */
export function fieldNames(types: SlotType[]): string[] {
  let t = 0;
  let i = 0;
  let l = 0;
  return types.map((ty) => {
    if (ty === 'image' || ty === 'bg') return i++ === 0 ? 'image' : `image${i}`;
    if (ty === 'link') return l++ === 0 ? 'link' : `link${l}`;
    const n = t++;
    return n === 0 ? 'title' : n === 1 ? 'description' : `text${n + 1}`;
  });
}

/** A hyphenated, human-ish slug for an ENTRY id (hyphens are fine in ids — unlike the hyphenless dataset
 *  slug used in `{{#each dataset.<slug>}}`). Empty when the source text has no usable characters. */
export function slugifyId(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function slotValue(slot: Slot, ctx: TransformCtx): string {
  if (slot.type === 'text') return textContent([slot.el]).trim();
  if (slot.type === 'bg') {
    const url = bgUrl(slot.el);
    return url ? imageRef(url, ctx) ?? '' : '';
  }
  if (slot.type === 'image') {
    // Lazy-aware: a carousel/grid image often keeps its real URL in data-src (the loader script is
    // stripped), so read the effective src — otherwise the inferred dataset gets empty images.
    const srcset = effectiveSrcset(slot.el.attribs);
    const src = effectiveSrc(slot.el.attribs) || (srcset ? pickFromSrcset(srcset) : undefined);
    return src ? imageRef(src, ctx) ?? '' : '';
  }
  const d = rewriteHref(slot.el.attribs.href ?? '', ctx.pageUrl, ctx.siteBase, ctx.internalRoutes);
  return d.kind === 'set' ? d.value : d.kind === 'keep' ? (slot.el.attribs.href ?? '').trim() : '#';
}

/** Build the validated `{{#each dataset.<slug>}}…{{/each}}` body from a representative child, or null. */
function buildLoop(child: Element, types: SlotType[], names: string[], slug: string, ctx: TransformCtx): string | null {
  sanitizeForSource([child], ctx, []); // structure → safe literal HTML (urls rewritten, scripts/on* stripped)
  const slots = collectSlots(child);
  if (slots.length !== types.length) return null; // sanitize changed the slot set → bail (stay literal)
  for (let idx = 0; idx < slots.length; idx += 1) {
    const s = slots[idx]!;
    if (s.type !== types[idx]) return null;
    const field = names[idx]!;
    if (s.type === 'text') setText(s.el, `{{${field}}}`);
    else if (s.type === 'image') {
      s.el.attribs.src = `{{sw-url ${field}}}`;
      delete s.el.attribs.srcset;
    } else if (s.type === 'bg') {
      // Bind the background via the data-sw-bg DIRECTIVE (a quoted attr — the validator forbids interpolation
      // in `style`). The engine resolves it to a real background at render time, so each entry's image
      // renders + is captured at nativize, and it stays editable through the dataset. Strip the static
      // background-image promoteLazyAttrs baked into the inline style so it can't shadow the binding.
      s.el.attribs['data-sw-bg'] = `{{sw-url ${field}}}`;
      const style = (s.el.attribs.style ?? '').replace(/background-image\s*:\s*url\([^)]*\)\s*;?/i, '').replace(/;\s*$/, '').trim();
      if (style) s.el.attribs.style = style; else delete s.el.attribs.style;
      for (const a of ['data-bg', 'data-background', 'data-background-image']) delete s.el.attribs[a];
    } else {
      s.el.attribs.href = `{{sw-url ${field}}}`;
    }
  }
  const loop = `{{#each dataset.${slug}}}${serialize(child)}{{/each}}`;
  try {
    validateTemplate(loop);
    return loop;
  } catch {
    return null;
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
}

/** Class patterns marking a JS slider/carousel — excluded from dataset inference (needs its own DOM+JS). */
const CAROUSEL_CLASS = /(?:^|[\s_-])(?:slider|carousel|swiper|slick|owl|flickity|splide|glide|embla|marquee)(?:$|[\s_-])/i;

/** Tailwind/Bootstrap-style utility class tokens that make poor dataset names. */
const UTILITY_CLASS = /^(?:d|w|h|p|m|p[xytblr]|m[xytblr]|col|row|grid|flex|order|gap|text|bg|border|rounded|shadow|align|justify|items|self|wow|lazy|animated|fade\w*|relative|absolute|fixed|sticky|container|no|vh|vw)([-\d]|$)/i;

/** The nearest preceding heading at the container's level OR any ANCESTOR level (so a section's `<h2>`
 *  before the grid's wrapper is found, not just an immediate sibling). '' if none. */
function nearestHeading(container: Element): string {
  for (let node: Element | null = container; node; node = node.parent && isTag(node.parent) ? node.parent : null) {
    for (let sib = node.prev; sib; sib = sib.prev) {
      if (isTag(sib) && /^h[1-6]$/.test(sib.name)) {
        const t = textContent([sib]).trim().replace(/\s+/g, ' ').slice(0, 60);
        if (t) return t;
      }
    }
  }
  return '';
}

/** A hyphenless slug (for `{{#each dataset.<slug>}}` — no [brackets] needed) PLUS a human display name.
 *  Prefers a nearby heading ("Our Team"); else the first MEANINGFUL class token ("Team", not the whole
 *  utility-class blob); else a generic "List". */
export function slugFor(container: Element, usedSlugs: Set<string>, hint?: string): { slug: string; name: string } {
  let base = '';
  let name = '';
  // An explicit hint (e.g. a "RECENT PROJECTS" label right before the rows) wins — the container's own
  // class is often just a utility wrapper (`sw-container`), giving an ugly slug.
  if (hint && slugify(hint)) {
    base = slugify(hint);
    name = hint;
  }
  const heading = base ? '' : nearestHeading(container);
  if (heading) {
    base = slugify(heading);
    name = heading;
  }
  if (!base) {
    const token = (container.attribs.class ?? '').split(/\s+/).find((c) => c && !UTILITY_CLASS.test(c));
    if (token) {
      base = slugify(token);
      name = titleCase(token.replace(/[-_]+/g, ' ').trim());
    }
  }
  const generic = !base;
  if (generic) base = 'items';
  let slug = base;
  for (let n = 2; usedSlugs.has(slug); n += 1) slug = `${base}${n}`;
  usedSlugs.add(slug);
  // A heading/token name stays as-is; a generic name is made UNIQUE from the deduped slug ("List 2").
  if (generic) name = slug === 'items' ? 'List' : `List ${slug.slice('items'.length)}`;
  return { slug, name };
}

/** Are these element children uniform enough to be a dataset (same tag + class + leaf signature)? */
export function uniformChildren(children: Element[]): { types: SlotType[] } | null {
  if (children.length < MIN_CHILDREN) return null;
  const tag = children[0]!.name;
  const cls = children[0]!.attribs.class ?? '';
  const sig = collectSlots(children[0]!).map((s) => s.type);
  if (sig.length === 0) return null;
  const sigStr = sig.join(',');
  for (const c of children) {
    if (c.name !== tag || (c.attribs.class ?? '') !== cls) return null;
    if (collectSlots(c).map((s) => s.type).join(',') !== sigStr) return null;
  }
  return { types: sig };
}

/**
 * Infer datasets from a page document (mutates: qualifying containers → a sentinel marker).
 *
 * `usedEntryIds` is threaded across EVERY page of the import (like `usedSlugs`) because an entry id is
 * the content row's storage key — entries are stored under `(projectId, kind:'entry', entityId)`, so the
 * id must be unique across ALL datasets in the project, not just within its own. Two pages that repeat the
 * same content (e.g. a service grid shown on both `/` and `/services/`) would otherwise infer two datasets
 * whose entries collide on the same bare id and fail the bundle's referential-integrity check.
 */
export function inferDatasets(
  doc: Document,
  ctx: TransformCtx,
  usedSlugs: Set<string>,
  usedEntryIds: Set<string>,
  markerPrefix: string,
): DatasetInference {
  const datasets: Dataset[] = [];
  const entries: Entry[] = [];
  const markers = new Map<string, { loop: string; slug: string }>();

  // Candidate containers: an element whose DIRECT element children are a uniform grid. Largest first;
  // skip a container nested inside one we already took (avoid double-processing).
  const taken: Element[] = [];
  const candidates = elements(doc.children)
    .map((el) => ({ el, children: el.children.filter(isTag) }))
    .filter((c) => c.children.length >= MIN_CHILDREN)
    .sort((a, b) => b.children.length - a.children.length);

  for (const { el, children } of candidates) {
    if (markers.size >= MAX_DATASETS_PER_PAGE) break;
    if (taken.some((t) => isAncestor(t, el) || isAncestor(el, t))) continue;
    // Skip JS carousels/sliders: turning their slides into a {{#each}} loop breaks the widget's own DOM
    // (it needs its literal structure + script to initialize); leave them literal so the hosted JS works.
    if (CAROUSEL_CLASS.test(el.attribs.class ?? '') || CAROUSEL_CLASS.test(children[0]!.attribs.class ?? '')) continue;
    const uniform = uniformChildren(children);
    if (!uniform) continue;
    const names = fieldNames(uniform.types);
    const { slug, name: datasetName } = slugFor(el, usedSlugs);
    // Extract entries from the (original) children BEFORE templatizing the first one.
    const rows = children.slice(0, MAX_ENTRIES).map((child) => {
      const slots = collectSlots(child);
      const values: Record<string, string> = {};
      slots.forEach((s, idx) => {
        values[names[idx]!] = slotValue(s, ctx);
      });
      return values;
    });
    const loop = buildLoop(children[0]!, uniform.types, names, slug, ctx);
    if (!loop) {
      usedSlugs.delete(slug); // release the reserved slug — this container stays literal
      continue;
    }
    const fields: Field[] = uniform.types.map((ty, idx) => ({ name: names[idx]!, type: ty === 'image' || ty === 'bg' ? 'image' : 'text', required: false, localized: false }));
    datasets.push({ id: slug, name: datasetName, slug, fields });
    // Entry id from its title value (e.g. `team-jane-doe`) so entries read meaningfully; deduped, with a
    // positional fallback. The first text field is the title (fieldNames puts it first).
    const titleField = fields.find((f) => f.type === 'text')?.name;
    rows.forEach((values, n) => {
      // Entry ids are ITEM KEYS — used as `{{item.<dataset>.<id>.<field>}}` Handlebars PATHS and as
      // data-sw-entry edit handles — so they must be underscore identifiers (no hyphens) and NOT prefixed
      // with the dataset slug. Derive from the title; fall back to a neutral row key. Deduped against the
      // BUNDLE-WIDE set so the id is unique across every dataset (the entry storage key is project-global).
      const base = (titleField ? slugifyId(values[titleField] ?? '').replace(/-/g, '_') : '') || `row_${n + 1}`;
      let id = base;
      for (let k = 2; usedEntryIds.has(id); k += 1) id = `${base}_${k}`;
      usedEntryIds.add(id);
      entries.push({ id, dataset: slug, status: 'published', order: n, values });
    });
    const marker = `${markerPrefix}${markers.size}@@`;
    markers.set(marker, { loop, slug });
    setText(el, marker); // replace the grid's children with the sentinel (build.ts swaps it for `loop`)
    taken.push(el);
  }
  return { datasets, entries, markers };
}

function isAncestor(maybeAncestor: Element, node: Element): boolean {
  for (let p = node.parent; p; p = p.parent) if (p === maybeAncestor) return true;
  return false;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
