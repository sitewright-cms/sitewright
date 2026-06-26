// POST-NATIVIZE re-fold: the import infers datasets + {{#each}} loops, but the nativize RENDERS those
// loops (with real entries) so the headless capture sees them styled — which EXPANDS them back to literal
// repeated cards (0 loops, datasets orphaned, high LOC). This pass re-folds a uniform card grid in the
// already-nativized page source back into a {{#each dataset.X}} loop + a fresh dataset/entries, reusing the
// import's conservative inference (same tag+class+leaf signature). SAFETY: each candidate fold is accepted
// ONLY if the loop, rendered with its entries, is byte-equal (whitespace-normalized) to the expanded cards
// rendered the same way — so a fold that would change the output (e.g. a grid with per-card SVG icons or
// per-image aspect classes the loop can't reproduce) is REJECTED and the cards stay literal. Zero fidelity
// risk by construction; the win is only where the grid is genuinely text/url-uniform.
import { validateTemplate } from '@sitewright/blocks';
import { textContent } from 'domutils';
import type { Dataset, Entry, Field } from '@sitewright/schema';
import { elements, getBody, isTag, parse, serialize, setText, type Element } from '../dom.js';
import { bgUrl, collectSlots, fieldNames, slugFor, slugifyId, type Slot, type SlotType } from '../transform/datasets.js';

const MIN_CHILDREN = 4;
const MAX_ENTRIES = 100;
const MAX_DATASETS_PER_PAGE = 6;

/** Render a fragment with the page's render context plus `extra` (the engine + helpers, async). */
export type RenderProbe = (template: string, extra: Record<string, unknown>) => Promise<string>;

export interface RefoldResult {
  html: string;
  datasets: Dataset[];
  entries: Entry[];
}

/** Compare-normalize (applied to BOTH sides equally): strip tag-adjacent whitespace + collapse runs, so
 *  the source's formatting whitespace around a value (`<h3> Title </h3>`) doesn't differ from the loop's
 *  trimmed field render (`<h3>Title</h3>`). Attribute order is stable — both sides go through `serialize`. */
function norm(s: string): string {
  // `whitespace-nowrap` is a per-card capture artifact (added when THAT card's text fit one line) → it
  // differs across cards; ignore it so it doesn't block an otherwise-equivalent fold (buildLoop also
  // drops it from the template, so a longer entry can't clip).
  return s.replace(/\bwhitespace-nowrap\b/g, '').replace(/>\s+/g, '>').replace(/\s+</g, '<').replace(/\s+/g, ' ').trim();
}

/** The LITERAL value of a slot in an ALREADY-nativized card (urls/text are final — no rewrite). */
function literalSlotValue(slot: Slot): string {
  if (slot.type === 'text') return textContent([slot.el]).trim();
  if (slot.type === 'bg') return bgUrl(slot.el) ?? '';
  if (slot.type === 'image') return (slot.el.attribs.src ?? '').trim();
  return (slot.el.attribs.href ?? '').trim();
}

/** Deep-clone an element via serialize→parse (so templatizing the loop body never mutates the doc cards). */
function cloneEl(el: Element): Element | undefined {
  const body = getBody(parse(`<body>${serialize(el)}</body>`));
  return body ? body.children.filter(isTag)[0] : undefined;
}

/** Templatize a (cloned) card: bind each slot to its field. Same bindings the import uses, so a clean grid
 *  renders identically; `{{sw-url}}` is identity for already-resolved /media + same-locale routes. */
function buildLoop(child: Element, types: readonly string[], names: readonly string[], slug: string): string | null {
  const slots = collectSlots(child);
  if (slots.length !== types.length) return null;
  for (let i = 0; i < slots.length; i += 1) {
    const s = slots[i]!;
    if (s.type !== types[i]) return null;
    const field = names[i]!;
    // href/src MUST use {{sw-url …}} (the validator forbids a bare value in a URL attribute). The entry
    // value is the ALREADY-resolved nativized url, and sw-url is idempotent on a resolved root-relative
    // path (sw-url('/x') → '/x'), so the loop renders identically to the expanded cards — and the per-group
    // render-equivalence check below rejects any case where it wouldn't.
    if (s.type === 'text') setText(s.el, `{{${field}}}`);
    else if (s.type === 'image') { s.el.attribs.src = `{{sw-url ${field}}}`; delete s.el.attribs.srcset; }
    else if (s.type === 'bg') {
      s.el.attribs['data-sw-bg'] = `{{sw-url ${field}}}`;
      const style = (s.el.attribs.style ?? '').replace(/background-image\s*:\s*url\([^)]*\)\s*;?/i, '').replace(/;\s*$/, '').trim();
      if (style) s.el.attribs.style = style; else delete s.el.attribs.style;
    } else s.el.attribs.href = `{{sw-url ${field}}}`;
  }
  // Drop the per-card `whitespace-nowrap` capture artifact from EVERY element so the single template can't
  // impose card-0's nowrap on a longer entry (which would clip it). Safe: it's only ever added to text that
  // already fit one line, so removing it never changes the layout of the cards that had it.
  for (const e of elements([child])) {
    if (!e.attribs.class || !/\bwhitespace-nowrap\b/.test(e.attribs.class)) continue;
    const c = e.attribs.class.replace(/\bwhitespace-nowrap\b/g, '').replace(/\s+/g, ' ').trim();
    if (c) e.attribs.class = c; else delete e.attribs.class;
  }
  const loop = `{{#each dataset.${slug}}}${serialize(child)}{{/each}}`;
  try { validateTemplate(loop); return loop; } catch { return null; }
}

function isAncestor(a: Element, n: Element): boolean {
  for (let p = n.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

/** A child's fold signature: tag + class + leaf-slot types (the same identity uniformChildren uses). */
function childSig(el: Element): string {
  return `${el.name}|${el.attribs.class ?? ''}|${collectSlots(el).map((s) => s.type).join(',')}`;
}

/** The LONGEST run of adjacent same-signature children (≥MIN), so a grid with an odd sibling — a heading
 *  row above the data rows, a special "blue" card after the uniform ones — still folds its uniform part. */
function largestRun(children: readonly Element[]): { run: Element[]; types: SlotType[] } | null {
  let best: Element[] = [];
  for (let i = 0; i < children.length; ) {
    const sig = childSig(children[i]!);
    let j = i + 1;
    while (j < children.length && childSig(children[j]!) === sig) j += 1;
    if (j - i > best.length) best = children.slice(i, j);
    i = j;
  }
  if (best.length < MIN_CHILDREN) return null;
  const types = collectSlots(best[0]!).map((s) => s.type);
  return types.length > 0 ? { run: best, types } : null;
}

/**
 * Re-fold uniform card grids in `html` (already-nativized page source) into `{{#each}}` loops + datasets,
 * keeping ONLY render-equivalent folds. `usedSlugs` is shared across the whole site (unique slugs). `probe`
 * renders a fragment against the page's render context. Returns the (possibly) rewritten html + new
 * datasets/entries (empty when nothing folds — the caller then keeps the literal html unchanged).
 */
export async function refoldLoops(html: string, usedSlugs: Set<string>, probe: RenderProbe): Promise<RefoldResult> {
  const doc = parse(`<body>${html}</body>`);
  const body = getBody(doc);
  if (!body) return { html, datasets: [], entries: [] };

  const datasets: Dataset[] = [];
  const entries: Entry[] = [];
  const replacements: Array<{ from: string; to: string }> = []; // run-html → loop, applied after serialize
  const taken: Element[] = [];
  let folded = 0;

  // Largest grids first; skip a container nested in one already folded.
  const candidates = elements(body.children)
    .map((el) => ({ el, children: el.children.filter(isTag) }))
    .filter((c) => c.children.length >= MIN_CHILDREN)
    .sort((a, b) => b.children.length - a.children.length);

  for (const { el, children } of candidates) {
    if (folded >= MAX_DATASETS_PER_PAGE) break;
    if (taken.some((t) => isAncestor(t, el) || isAncestor(el, t))) continue;
    const found = largestRun(children);
    if (!found) continue;
    const { run, types } = found;
    const rowEls = run.slice(0, MAX_ENTRIES);
    const names = fieldNames(types);
    const { slug, name } = slugFor(el, usedSlugs);
    const release = (): void => { usedSlugs.delete(slug); };

    const rows = rowEls.map((c) => {
      const values: Record<string, string> = {};
      collectSlots(c).forEach((s, i) => { values[names[i]!] = literalSlotValue(s); });
      return values;
    });
    const clone = cloneEl(rowEls[0]!);
    if (!clone) { release(); continue; }
    const loop = buildLoop(clone, types, names, slug);
    if (!loop) { release(); continue; }

    // The run AS IT APPEARS in the source (its children + the whitespace between them) — the exact substring
    // we'll swap for the loop, and the baseline the loop must reproduce.
    const all = el.children;
    const slice = all.slice(all.indexOf(rowEls[0]!), all.indexOf(rowEls[rowEls.length - 1]!) + 1);
    const runHtml = serialize(slice);

    // SAFETY: the loop (with its entries) must render byte-equal to the expanded run, or we don't fold.
    let ok = false;
    try {
      const [renderedExpanded, renderedLoop] = await Promise.all([probe(runHtml, {}), probe(loop, { dataset: { [slug]: rows } })]);
      ok = renderedExpanded !== '' && norm(renderedExpanded) === norm(renderedLoop);
    } catch { ok = false; }
    if (!ok) { release(); continue; }

    const fields: Field[] = types.map((ty, i) => ({ name: names[i]!, type: ty === 'image' || ty === 'bg' ? 'image' : 'text', required: false, localized: false }));
    datasets.push({ id: slug, name, slug, fields });
    const titleField = fields.find((f) => f.type === 'text')?.name;
    const usedEntryIds = new Set<string>();
    rows.forEach((values, n) => {
      const fromTitle = titleField ? slugifyId(values[titleField] ?? '') : '';
      let id = fromTitle ? `${slug}-${fromTitle}` : `${slug}-${n + 1}`;
      for (let k = 2; usedEntryIds.has(id); k += 1) id = `${slug}-${fromTitle || n + 1}-${k}`;
      usedEntryIds.add(id);
      entries.push({ id, dataset: slug, status: 'published', order: n, values });
    });
    replacements.push({ from: runHtml, to: loop });
    taken.push(el);
    folded += 1;
  }

  if (replacements.length === 0) return { html, datasets: [], entries: [] };
  let out = serialize(body.children);
  for (const { from, to } of replacements) out = out.replace(from, () => to); // fn form → no $-substitution
  return { html: out, datasets, entries };
}
