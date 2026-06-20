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
import { effectiveSrc, effectiveSrcset } from './assets.js';
import { imageRef, sanitizeForSource, type TransformCtx } from './page.js';

const MIN_CHILDREN = 4;
const MAX_ENTRIES = 100;
const MAX_DATASETS_PER_PAGE = 3;
const MAX_SLOTS = 12;
const MAX_DEPTH = 64;

type SlotType = 'text' | 'image' | 'link';
interface Slot {
  type: SlotType;
  el: Element;
}

export interface DatasetInference {
  datasets: Dataset[];
  entries: Entry[];
  /** sentinel marker (placed in the doc) → the {{#each}} loop + its dataset slug, for build.ts to
   *  splice into the page source (and to drop the dataset if the marker didn't survive the transform). */
  markers: Map<string, { loop: string; slug: string }>;
}

/** Ordered leaf slots of a card subtree: <img> (image), <a href> (link), and leaf text elements. */
function collectSlots(root: Element): Slot[] {
  const out: Slot[] = [];
  const visit = (nodes: AnyNode[], depth: number): void => {
    if (depth > MAX_DEPTH) return; // guard pathologically deep card markup (stack safety)
    for (const n of nodes) {
      if (out.length >= MAX_SLOTS) break;
      if (!isTag(n)) continue;
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

/** Generic, unique-per-dataset field names for a slot-type sequence (the user/AI renames later). */
function fieldNames(types: SlotType[]): string[] {
  let t = 0;
  let i = 0;
  let l = 0;
  return types.map((ty) => {
    if (ty === 'image') return i++ === 0 ? 'image' : `image${i}`;
    if (ty === 'link') return l++ === 0 ? 'link' : `link${l}`;
    const n = t++;
    return n === 0 ? 'title' : n === 1 ? 'text' : `text${n}`;
  });
}

function slotValue(slot: Slot, ctx: TransformCtx): string {
  if (slot.type === 'text') return textContent([slot.el]).trim();
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

/** A friendly hyphenless slug from a nearby heading (so `{{#each dataset.<slug>}}` needs no [brackets]). */
function slugFor(container: Element, usedSlugs: Set<string>): string {
  let base = '';
  for (let sib = container.prev; sib && !base; sib = sib.prev) {
    if (isTag(sib) && /^h[1-4]$/.test(sib.name)) base = slugify(textContent([sib]));
  }
  if (!base) base = slugify(container.attribs.class ?? '') || 'items';
  let slug = base;
  for (let n = 2; usedSlugs.has(slug); n += 1) slug = `${base}${n}`;
  usedSlugs.add(slug);
  return slug;
}

/** Are these element children uniform enough to be a dataset (same tag + class + leaf signature)? */
function uniformChildren(children: Element[]): { types: SlotType[] } | null {
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

/** Infer datasets from a page document (mutates: qualifying containers → a sentinel marker). */
export function inferDatasets(doc: Document, ctx: TransformCtx, usedSlugs: Set<string>, markerPrefix: string): DatasetInference {
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
    const uniform = uniformChildren(children);
    if (!uniform) continue;
    const names = fieldNames(uniform.types);
    const slug = slugFor(el, usedSlugs);
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
    const fields: Field[] = uniform.types.map((ty, idx) => ({ name: names[idx]!, type: ty === 'image' ? 'image' : 'text', required: false, localized: false }));
    datasets.push({ id: slug, name: titleCase(slug), slug, fields });
    rows.forEach((values, n) => entries.push({ id: `${slug}-${n + 1}`, dataset: slug, status: 'published', order: n, values }));
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

function titleCase(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}
