// CROSS-PAGE template extraction: many nativized pages that share ONE skeleton (e.g. burmeister's service
// pages — hero + intro + projects loop + CTA, differing only in content) are collapsed into a single
// reusable `template` entity + a tiny `page.data` per page. The page then renders the template's Handlebars
// against its own `page.data` (the platform's `Page.template` model). Repetitive per-page loops (a refolded
// `{{#each dataset.<slug>}}` projects table) become `{{#each page.data.<key>}}` so the loop body lives once
// in the template and only the rows live in each page's data.
//
// SAFETY — zero fidelity risk by construction: a group is kept ONLY if, for EVERY member, the template
// rendered with that page's data is whitespace-normalized byte-equal to the page's own source rendered
// standalone (the same per-page render-equivalence used by the re-fold). Anything that wouldn't reproduce
// is left as an ordinary page.
import { parse, getBody, serialize, serializeTemplate, isTag, isText, elements, type AnyNode, type Element } from '../dom.js';
import { textContent } from 'domutils';
import type { RenderProbe } from './refold.js';

const MIN_GROUP = 3; // need at least this many same-skeleton pages to be worth a template
const MIN_TEMPLATE_ELEMENTS = 8; // …and a non-trivial shared structure (don't templatize a 1-div page)

/** Resolve a (now-orphaned) re-folded dataset slug to its row objects, for the page.data.<key> array. */
export type DatasetItems = (slug: string) => Record<string, string>[];

export interface TemplateMember {
  id: string;
  data: Record<string, unknown>;
  consumedSlugs: string[]; // per-page projects datasets folded into page.data → caller deletes them
}
export interface TemplateGroup {
  templateSource: string;
  members: TemplateMember[];
}

const norm = (s: string): string =>
  s.replace(/class="([^"]*)"/g, (_m, c: string) => `class="${c.split(/\s+/).filter((t) => t && !/^(?:[a-z]+:)?(?:grid-cols-\[|h-\d|h-\[|min-h-\d|min-h-\[)|^whitespace-nowrap$/.test(t)).join(' ')}"`)
    .replace(/style="([^"]*)"/g, (_m, st: string) => `style="${st.split(';').map((d) => d.trim()).filter(Boolean).sort().join(';')}"`) // CSS prop ORDER is irrelevant (data-sw-bg appends background-image)
    .replace(/\s+\/>/g, '/>') // self-closing spacing (`<path … />` vs `…/>`) is HTML-identical — don't let it block a fold
    .replace(/>\s+/g, '>').replace(/\s+</g, '<').replace(/\s+/g, ' ').trim();

/** Replace each `{{#each dataset.<slug>}}` with `{{#each page.data.<key>}}` (projects, list2, …) so the loop
 *  body becomes template-shared + the rows become per-page data. Returns the rewritten source + slug→key. */
function liftLoops(source: string): { source: string; loops: Array<{ key: string; slug: string }> } {
  const loops: Array<{ key: string; slug: string }> = [];
  const out = source.replace(/\{\{#each\s+dataset\.([A-Za-z0-9_]+)\s*\}\}/g, (_m, slug: string) => {
    const key = loops.length === 0 ? 'projects' : `list${loops.length + 1}`;
    loops.push({ key, slug });
    return `{{#each page.data.${key}}}`;
  });
  return { source: out, loops };
}

// Text-leaf tags whose REPEATED siblings are content variation (a page with 3 paragraphs vs 1), not a
// structural difference — collapsed in the grouping fingerprint so content-varying siblings still group,
// while a genuinely different layout (extra structural blocks) separates into its own group.
const TEXT_TAGS = new Set(['p', 'li', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'b', 'strong', 'em', 'i', 'a', 'small']);

/** Grouping fingerprint: tag nesting with CONSECUTIVE same text-leaf siblings collapsed + block-helper
 *  markers kept (so the projects loop is part of the signature). Pages with the same fingerprint share a
 *  layout up to content-count variation. */
function textSkeleton(nodes: readonly AnyNode[]): string {
  let out = '';
  let last = '';
  for (const n of nodes) {
    if (isTag(n)) {
      if (TEXT_TAGS.has(n.name) && n.name === last) continue;
      last = TEXT_TAGS.has(n.name) ? n.name : '';
      out += `<${n.name}>${textSkeleton(n.children)}</${n.name}>`;
    } else if (isText(n) && /\{\{[#/]/.test(n.data)) { out += n.data.replace(/\s+/g, ''); last = ''; }
  }
  return out;
}

/** Deep-clone via serialize→parse (preserves Handlebars verbatim — verified). */
function cloneBody(body: Element): Element | undefined {
  const b = getBody(parse(`<body>${serialize(body.children)}</body>`));
  return b ?? undefined;
}

/**
 * Bind the VARYING parts of `tplNodes` (a clone of member 0) to `data-sw-*="page.data.fK"` and record each
 * member's value in `data[i]`. Returns false on a structural divergence that can't be templated. Aligned
 * children recurse (fine-grained fields); a subtree whose CHILD STRUCTURE differs across members becomes a
 * single `data-sw-html` field (e.g. an intro with a different number of bullets per page).
 */
function bind(tplNodesRaw: AnyNode[], peerNodesRaw: AnyNode[][], data: Array<Record<string, unknown>>, ctr: { n: number }): boolean {
  // Align only MEANINGFUL nodes — formatting/whitespace text nodes differ across the serialized pages and
  // would otherwise break the positional alignment (the render-equivalence check tolerates whitespace).
  const ws = (n: AnyNode): boolean => isText(n) && n.data.trim() === '';
  const tplNodes = tplNodesRaw.filter((n) => !ws(n));
  const peerNodes = peerNodesRaw.map((ns) => ns.filter((n) => !ws(n)));
  if (peerNodes.some((ns) => ns.length !== tplNodes.length)) return false;
  for (let i = 0; i < tplNodes.length; i += 1) {
    const tn = tplNodes[i]!;
    const peers = peerNodes.map((ns) => ns[i]!);
    if (isText(tn)) { if (peers.some((p) => !isText(p))) return false; continue; } // text handled at element level
    if (!isTag(tn) || peers.some((p) => !isTag(p) || p.name !== tn.name)) return false;
    for (const [attr, dir] of [['src', 'data-sw-src'], ['href', 'data-sw-href']] as const) {
      if (tn.attribs[attr] !== undefined && new Set(peers.map((p) => (p as Element).attribs[attr])).size > 1) {
        const f = `f${ctr.n++}`;
        tn.attribs[dir] = `page.data.${f}`;
        peers.forEach((p, pi) => { data[pi]![f] = (p as Element).attribs[attr] ?? ''; });
      }
    }
    // varying inline-style background-image (a per-page hero image) → data-sw-bg (renders back to the inline bg)
    const BG = /background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i;
    const bgOf = (el: Element): string | undefined => (el.attribs.style ?? '').match(BG)?.[1];
    if (bgOf(tn) && new Set(peers.map((p) => bgOf(p as Element))).size > 1) {
      const f = `f${ctr.n++}`;
      tn.attribs['data-sw-bg'] = `page.data.${f}`;
      const st = (tn.attribs.style ?? '').replace(BG, '').replace(/;\s*;/g, ';').replace(/^\s*;|;\s*$/g, '').trim();
      if (st) tn.attribs.style = st; else delete tn.attribs.style;
      peers.forEach((p, pi) => { data[pi]![f] = bgOf(p as Element) ?? ''; });
    }
    const childEls = tn.children.filter(isTag);
    if (childEls.length === 0) {
      const texts = peers.map((p) => textContent([p]).trim());
      if (new Set(texts).size > 1) {
        if (texts.some((t) => /\{\{/.test(t))) return false; // a varying cell carrying a helper → can't text-bind
        const f = `f${ctr.n++}`;
        tn.attribs['data-sw-text'] = `page.data.${f}`;
        peers.forEach((p, pi) => { data[pi]![f] = textContent([p]).trim(); });
      }
    } else if (!bind(tn.children, peers.map((p) => (p as Element).children), data, ctr)) {
      // children structure diverges across members → bind the whole element's inner HTML as one rich field.
      const f = `f${ctr.n++}`;
      tn.attribs['data-sw-html'] = `page.data.${f}`;
      tn.children = []; // the template element is now an empty editable region
      peers.forEach((p, pi) => { data[pi]![f] = serialize((p as Element).children); });
    }
  }
  return true;
}

/** Extract shared templates from a set of nativized pages. Pages are grouped by `group` (the caller passes
 *  each page's PARENT — sibling pages are the template candidates; skeleton matching is too brittle for real
 *  pages that differ in inner content). Pure except for `probe`/`datasetItems`. */
export async function extractTemplates(
  pages: ReadonlyArray<{ id: string; source: string; group?: string }>,
  datasetItems: DatasetItems,
  probe: RenderProbe,
): Promise<TemplateGroup[]> {
  const prepared = pages.map((p) => { const { source, loops } = liftLoops(p.source); const doc = parse(`<body>${source}</body>`); return { id: p.id, group: p.group, source, loops, doc, body: getBody(doc) }; })
    .filter((p): p is typeof p & { body: Element } => Boolean(p.body) && Boolean(p.group));
  // Group by PARENT + a content-tolerant structural fingerprint — siblings that share a layout (ignoring
  // how many paragraphs/items each has) cluster; a structurally different sibling separates out.
  const groups = new Map<string, typeof prepared>();
  for (const p of prepared) { const sig = `${p.group}|${textSkeleton(p.body.children)}`; const arr = groups.get(sig) ?? []; arr.push(p); groups.set(sig, arr); }

  const out: TemplateGroup[] = [];
  for (const members of groups.values()) {
    if (members.length < MIN_GROUP) continue;
    if (elements(members[0]!.body.children).length < MIN_TEMPLATE_ELEMENTS) continue; // trivial structure → not worth a template
    const tplBody = cloneBody(members[0]!.body);
    if (!tplBody) continue;
    const data: Array<Record<string, unknown>> = members.map(() => ({}));
    if (!bind(tplBody.children, members.map((m) => m.body.children), data, { n: 0 })) continue;
    const templateSource = serializeTemplate(tplBody.children); // terminal template output → keep emitted `{{…}}` tokens intact

    // Fold each member's lifted loops into its page.data.
    const built: TemplateMember[] = members.map((m, i) => {
      const memberData = { ...data[i]! };
      for (const { key, slug } of m.loops) memberData[key] = datasetItems(slug);
      return { id: m.id, data: memberData, consumedSlugs: m.loops.map((l) => l.slug) };
    });

    // QUALITY GATE: only worth a template if it MEANINGFULLY shrinks total LOC — i.e. the pages genuinely
    // share structure. Dissimilar siblings collapse into mostly-`data-sw-html` (the per-page content moves
    // to page.data with no real sharing) and fail this.
    // Compare STRUCTURE to structure: the per-page SCALAR data (title/intro) lived in the page source too,
    // but the loop ARRAYS (projects) were dataset entries — not page source — so excluding them keeps the
    // comparison honest (it measures eliminated duplicate structure, not relocated data).
    const scalarLen = (d: Record<string, unknown>): number => JSON.stringify(Object.fromEntries(Object.entries(d).filter(([, v]) => !Array.isArray(v)))).length;
    const origLOC = members.reduce((n, m) => n + m.source.length, 0);
    const newLOC = templateSource.length + built.reduce((n, b) => n + scalarLen(b.data), 0);
    if (newLOC > origLOC * 0.8) continue; // require a meaningful reduction (≥20% of the shared structure)

    // SAFETY: the TEMPLATE + each member's data must render byte-identical to that member's own source (both
    // rendered with the member's data, so any difference is a structural binding error, not data).
    let ok = true;
    for (let i = 0; i < members.length && ok; i += 1) {
      try {
        const [tpl, self] = await Promise.all([probe(templateSource, { page: { data: built[i]!.data } }), probe(members[i]!.source, { page: { data: built[i]!.data } })]);
        ok = self !== '' && norm(tpl) === norm(self);
      } catch { ok = false; }
    }
    if (ok) out.push({ templateSource, members: built });
  }
  return out;
}

