// Build-time assembly of the site-search index. Runs inside the publish build, in the same pass that
// renders the HTML, so the index can never describe a version of the site that is not the one being
// served. See docs/site-search.md §3.
//
// This module is BUILD-ONLY. What it SHARES with the browser runtime — the tokenizer and the file
// format/codec — lives in @sitewright/blocks, because a private copy on either side would drift and
// the failure would be silent (a search that returns nothing).
import { createHash } from 'node:crypto';
import {
  encodeDeltas,
  terms as termsOf,
  tokenize,
  type SearchIndexFile,
  type SearchIndexPage,
  type SearchTextFile,
} from '@sitewright/blocks';

// The file SHAPE + the delta codec live in @sitewright/blocks because the browser runtime reads
// what this writes. Re-exported so build-side callers and tests have one import site.
export { decodeDeltas, encodeDeltas } from '@sitewright/blocks';
export type { SearchIndexFile, SearchIndexPage, SearchTextFile } from '@sitewright/blocks';
import { extractHeadings, decodeEntities } from '../render/heading-outline.js';

/** What the build knows about one indexable page. `bodyHtml` is the page's OWN body — never chrome. */
export interface SearchPageInput {
  /** Root-relative route path, e.g. `/leistungen/`. */
  url: string;
  title: string;
  description?: string;
  /** The rendered page body ONLY. Passing chrome here would make every page match every nav term. */
  bodyHtml: string;
  /** Tree depth from the parent chain (home = 0) — a ranking prior. */
  depth: number;
  /** Whether the page sits in the main nav — a ranking prior. */
  inNav: boolean;
}




export interface BuildSearchIndexOptions {
  /** Fold combining marks over a Latin base (default true). Per-locale — docs/site-search.md §4. */
  fold?: boolean;
}

/**
 * Tags that END a text block. Two words separated by one of these are NOT adjacent for phrase
 * search, however close they look in the flattened text.
 */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'main', 'nav',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tr', 'td', 'th', 'blockquote', 'pre', 'figure',
  'figcaption', 'form', 'fieldset', 'legend', 'hr', 'br', 'address', 'details', 'summary',
]);

/** Regions whose text is markup or code, never page content. */
const SKIP_TAGS = new Set(['script', 'style', 'svg', 'noscript', 'template']);

/** Read the tag name at `lt` (which must point at `<`). Returns null when it is not a tag. */
function tagAt(html: string, lt: number): { name: string; closing: boolean } | null {
  let i = lt + 1;
  // eslint-disable-next-line security/detect-object-injection -- numeric scan index into a string
  const closing = html[i] === '/';
  if (closing) i += 1;
  const start = i;
  while (i < html.length) {
    const c = html.charCodeAt(i);
    const isAlpha = (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    const isDigit = c >= 48 && c <= 57;
    if (!(isAlpha || (i > start && (isDigit || c === 45)))) break;
    i += 1;
  }
  if (i === start) return null;
  return { name: html.slice(start, i).toLowerCase(), closing };
}

/** `alt="…"` out of one `<img …>` tag's text. Quoted or bare; missing → ''. */
function altOf(tagText: string): string {
  const m = /\salt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tagText);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
}

/**
 * Reduce rendered page HTML to the plain text the index stores.
 *
 * Keeps text nodes and `<img alt>`; drops script/style/svg/noscript/template regions, comments, and
 * every other attribute. Each tag becomes a space, so `<p>alpha</p><p>beta</p>` yields two terms
 * rather than the single term `alphabeta`.
 *
 * ★ A single LINEAR forward scan (`indexOf`, no backtracking), for the same reason
 * {@link extractHeadings} is one: a lazy-quantifier region regex (`<script>[\s\S]*?</script>`) goes
 * quadratic on unclosed tags and can freeze the event loop. Raw-fidelity imports are not indexed at
 * all, so this only ever sees our own renderer's output — but the cheap linear form costs nothing and
 * removes the hazard by construction.
 */
export function extractIndexBlocks(html: string): string[] {
  const blocks: string[] = [];
  const out: string[] = [];
  // ★ Lowercased ONCE. This used to be `html.toLowerCase().indexOf(...)` INSIDE the loop, which
  // re-lowered the whole document for every script/style/svg/noscript/template element — quadratic
  // on exactly the pages the scan claims to handle cheaply. Phosphor icons render as inline <svg>,
  // so an icon grid is the common case: measured 11ms at 2,000 icons, 705ms at 8,000.
  const lower = html.toLowerCase();
  const flush = (): void => {
    const text = decodeEntities(out.join('')).replace(/\s+/g, ' ').trim();
    out.length = 0;
    if (text) blocks.push(text);
  };
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out.push(html.slice(i));
      break;
    }
    if (lt > i) out.push(html.slice(i, lt));
    out.push(' '); // a tag boundary is a word boundary

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    const tag = tagAt(html, lt);
    const gt = html.indexOf('>', lt);
    if (!tag || gt === -1) {
      // Not a tag (a bare `<` in text) — consume the character and carry on.
      i = lt + 1;
      continue;
    }
    if (!tag.closing && SKIP_TAGS.has(tag.name)) {
      // Skip to this element's close tag; an unclosed one swallows the remainder, which is the
      // correct read of malformed markup and stays linear either way.
      const close = lower.indexOf(`</${tag.name}`, gt);
      if (close === -1) break;
      const closeGt = html.indexOf('>', close);
      i = closeGt === -1 ? n : closeGt + 1;
      continue;
    }
    if (!tag.closing && tag.name === 'img') {
      const alt = altOf(html.slice(lt, gt + 1));
      if (alt) out.push(alt, ' ');
    }
    // A BLOCK boundary ends the segment. Inline tags (<strong>, <a>, <em>…) do not: a phrase may
    // legitimately run through them. Without this, the last word of one card and the first word of
    // the next were at consecutive ordinals, and a quoted "alpha beta" matched a page where those
    // words never appear together.
    if (BLOCK_TAGS.has(tag.name)) flush();
    i = gt + 1;
  }
  flush();
  return blocks;
}

/** The whole page as one string — the display text stored for snippets. */
export function extractIndexText(html: string): string {
  return extractIndexBlocks(html).join(' ');
}


/** Stable content hash for duplicate detection. */
function textHash(text: string): string {
  return createHash('sha256').update(text).digest('base64url').slice(0, 22);
}

/**
 * Assemble the index + text files for ONE locale's pages.
 *
 * Callers pass only indexable pages — noindex, `kind:'link'`, drafts and raw-fidelity imports are
 * filtered upstream (docs/site-search.md §3.1), because "which pages exist" is the build's knowledge,
 * not this module's.
 */
export function buildSearchIndex(
  lang: string,
  pages: readonly SearchPageInput[],
  options: BuildSearchIndexOptions = {},
): { index: SearchIndexFile; text: SearchTextFile } {
  const tokenOpts = { locale: lang, fold: options.fold };
  const indexPages: SearchIndexPage[] = [];
  // ★ A MAP, not a plain object. Terms are author words, and `obj['__proto__'] = …` does not create
  // an own property — it mutates the prototype, so the term vanishes from the emitted JSON entirely.
  // ICU segments `__proto__` as a single word, so a page that merely mentions it (a docs site about
  // templating, say) would silently lose that term. `Object.fromEntries` defines a real own property.
  const terms = new Map<string, Array<[number, number[]]>>();
  const text: string[] = [];
  const offsets: number[][] = [];
  const groupIds = new Map<string, number>();

  for (const [pageIndex, page] of pages.entries()) {
    // Tokenized BLOCK BY BLOCK, with an ordinal GAP between blocks. Phrase search decides adjacency
    // from consecutive ordinals, so without the gap the last word of one element and the first word
    // of the next read as a phrase — a quoted "alpha beta" matched pages where that phrase does not
    // exist. The gap slot holds a placeholder offset that no posting ever references.
    const blocks = extractIndexBlocks(page.bodyHtml);
    const plain = blocks.join(' ');

    const perTerm = new Map<string, number[]>();
    const tokenOffsets: number[] = [];
    let ordinal = 0;
    let base = 0;
    let tokenCount = 0;
    for (const [blockIndex, block] of blocks.entries()) {
      for (const tok of tokenize(block, tokenOpts)) {
        const list = perTerm.get(tok.term);
        if (list) list.push(ordinal);
        else perTerm.set(tok.term, [ordinal]);
        tokenOffsets[ordinal] = base + tok.start;
        ordinal += 1;
        tokenCount += 1;
      }
      base += block.length + 1; // the single space `blocks.join(' ')` inserts
      if (blockIndex < blocks.length - 1) {
        tokenOffsets[ordinal] = base; // unreferenced placeholder; keeps the offset list ascending
        ordinal += 1;
      }
    }
    for (const [term, ordinals] of perTerm) {
      const postings = terms.get(term) ?? [];
      postings.push([pageIndex, encodeDeltas(ordinals)]);
      terms.set(term, postings);
    }

    const fields: Record<string, string[]> = {};
    const titleTokens = termsOf(page.title, tokenOpts);
    if (titleTokens.length > 0) fields.t = titleTokens;
    if (page.description) {
      const d = termsOf(page.description, tokenOpts);
      if (d.length > 0) fields.d = d;
    }
    for (const h of extractHeadings(page.bodyHtml)) {
      const key = `h${h.level}`;
      const ht = termsOf(h.text, tokenOpts);
      // eslint-disable-next-line security/detect-object-injection -- `key` is `h${level}` with level 1-6 from extractHeadings, never author text
      if (ht.length > 0) fields[key] = [...(fields[key] ?? []), ...ht];
    }

    const hash = textHash(plain);
    let group = groupIds.get(hash);
    if (group === undefined) {
      group = groupIds.size;
      groupIds.set(hash, group);
    }

    indexPages.push({
      u: page.url,
      t: page.title,
      ...(page.description ? { d: page.description } : {}),
      n: tokenCount,
      dep: page.depth,
      nv: page.inNav ? 1 : 0,
      g: group,
      f: fields,
    });
    text.push(plain);
    offsets.push(encodeDeltas(tokenOffsets));
  }

  return {
    // `fromEntries` (not assignment) so a `__proto__` term survives as an own property — see above.
    index: {
      v: 1,
      lang,
      // Only when OFF: the default stays absent so an unconfigured site's index is unchanged.
      ...(options.fold === false ? { fold: false as const } : {}),
      pages: indexPages,
      terms: Object.fromEntries(terms),
    },
    text: { v: 1, text, offsets },
  };
}
