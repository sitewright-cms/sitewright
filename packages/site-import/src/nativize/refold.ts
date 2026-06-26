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

// PER-ELEMENT CAPTURE ARTIFACTS — class tokens the headless capture bakes from each element's measured box,
// so they differ across otherwise-identical repeated cards/rows (the column fractions + row height of a
// table row, the one-line `whitespace-nowrap`). They're NOT design intent (the responsive md:/lg: values
// the capture produces ARE uniform), so we ignore them for uniformity + the render-equivalence compare, and
// drop the height ones from the loop template (auto height → a longer entry can't clip). `grid-cols-[…]` is
// KEPT in the template (a grid needs its columns; `fr` units stay proportional, so one row's is consistent
// for all). NOTE: `aspect-[…]` is deliberately NOT here — a real per-image ratio, so image grids still
// (correctly) refuse to fold. */
const BP = '(?:[a-z]+:)?';
const DIM_CMP = new RegExp(`^(?:${BP}(?:grid-cols-\\[|h-\\d|h-\\[|min-h-\\d|min-h-\\[)|whitespace-nowrap$)`); // sig + compare
const DIM_TPL = new RegExp(`^(?:${BP}(?:h-\\d|h-\\[|min-h-\\d|min-h-\\[)|whitespace-nowrap$)`); // template (keep grid-cols)
const stripCls = (cls: string, re: RegExp): string => cls.split(/\s+/).filter((t) => t && !re.test(t)).join(' ');

/** Render a fragment with the page's render context plus `extra` (the engine + helpers, async). */
export type RenderProbe = (template: string, extra: Record<string, unknown>) => Promise<string>;

export interface RefoldResult {
  html: string;
  datasets: Dataset[];
  entries: Entry[];
}

/** Compare-normalize (applied to BOTH sides equally): drop per-element capture-artifact classes from every
 *  class attr, then strip tag-adjacent whitespace + collapse runs (so `<h3> Title </h3>` matches the loop's
 *  trimmed `<h3>Title</h3>`). Attribute order is stable — both sides go through `serialize`. */
function norm(s: string): string {
  return s
    .replace(/class="([^"]*)"/g, (_m, c: string) => `class="${stripCls(c, DIM_CMP)}"`)
    .replace(/>\s+/g, '>').replace(/\s+</g, '<').replace(/\s+/g, ' ').trim();
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

/** Templatize a (cloned) card: bind each VARYING slot to its field (`slotFields[i]`); a CONSTANT slot
 *  (null) keeps row-0's literal content — e.g. a shared `{{sw-icon "eye"}} VIEW` cell that's identical on
 *  every row stays static, instead of being baked into a field value (which would render escaped). */
function buildLoop(child: Element, types: readonly string[], slotFields: readonly (string | null)[], slug: string): string | null {
  const slots = collectSlots(child);
  if (slots.length !== types.length) return null;
  for (let i = 0; i < slots.length; i += 1) {
    const s = slots[i]!;
    if (s.type !== types[i]) return null;
    const field = slotFields[i];
    if (!field) continue; // constant slot → leave literal
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
  // Drop the per-element capture-artifact HEIGHT/nowrap classes from EVERY element so the single template
  // can't impose card-0's measured height (or one-line nowrap) on a longer entry and clip it — height goes
  // auto (content-driven, which is what the source intended before the capture baked a px value). grid-cols
  // is KEPT (a grid needs columns; row-0's `fr` ratios apply consistently to all rows).
  for (const e of elements([child])) {
    if (!e.attribs.class) continue;
    const c = stripCls(e.attribs.class, DIM_TPL);
    if (c === e.attribs.class) continue;
    if (c) e.attribs.class = c; else delete e.attribs.class;
  }
  const loop = `{{#each dataset.${slug}}}${serialize(child)}{{/each}}`;
  try { validateTemplate(loop); return loop; } catch { return null; }
}

function isAncestor(a: Element, n: Element): boolean {
  for (let p = n.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

/** A child's fold signature: tag + class (minus per-element capture artifacts) + leaf-slot types — so two
 *  table rows that differ only in their captured `grid-cols-[…]`/`h-…` still count as the same shape. */
function childSig(el: Element): string {
  return `${el.name}|${stripCls(el.attribs.class ?? '', DIM_CMP)}|${collectSlots(el).map((s) => s.type).join(',')}`;
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

    // Per-slot values across every row, then split CONSTANT slots (same on all rows → stay static in the
    // template) from VARYING slots (→ fields). A constant cell is often a shared `{{sw-icon …}} VIEW` label
    // that must NOT be field-ized (a {{x}} field renders its value ESCAPED, breaking the helper).
    const perRow = rowEls.map((c) => collectSlots(c).map(literalSlotValue));
    const nSlots = types.length;
    if (perRow.some((r) => r.length !== nSlots)) continue; // a row's slot shape shifted under sanitize → skip
    const varying = types.map((_t, i) => new Set(perRow.map((r) => r[i])).size > 1);
    const varIdx = types.map((_t, i) => i).filter((i) => varying[i]);
    if (varIdx.length === 0) continue; // every cell identical → not data (a repeated decorative block)
    const varNames = fieldNames(varIdx.map((i) => types[i]!));
    const slotFields: (string | null)[] = types.map(() => null);
    varIdx.forEach((i, k) => { slotFields[i] = varNames[k]!; });

    // A short label right before the rows (e.g. "RECENT PROJECTS") makes a far better slug than the
    // container's utility class (`sw-container` → "swcontainer").
    let hint = '';
    for (let sib = rowEls[0]!.prev; sib; sib = sib.prev) {
      if (!isTag(sib)) continue;
      const t = textContent([sib]).trim().replace(/\s+/g, ' ');
      hint = t.length > 0 && t.length <= 40 ? t : '';
      break;
    }
    const { slug, name } = slugFor(el, usedSlugs, hint);
    const release = (): void => { usedSlugs.delete(slug); };
    const rows = perRow.map((r) => { const v: Record<string, string> = {}; varIdx.forEach((i, k) => { v[varNames[k]!] = r[i]!; }); return v; });
    const clone = cloneEl(rowEls[0]!);
    if (!clone) { release(); continue; }
    const loop = buildLoop(clone, types, slotFields, slug);
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

    const fields: Field[] = varIdx.map((i, k) => ({ name: varNames[k]!, type: types[i] === 'image' || types[i] === 'bg' ? 'image' : 'text', required: false, localized: false }));
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
