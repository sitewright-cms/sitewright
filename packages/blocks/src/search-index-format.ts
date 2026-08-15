// The ON-DISK CONTRACT for the site-search index: the shape of the two emitted files and the delta
// decoder that reads them. Lives HERE, not in the publish build, because BOTH sides need it — the
// build writes these files and the browser runtime reads them. A private copy on either side would
// drift, and the failure would be silent (a search that returns nothing).
//
// See docs/site-search.md §3.3. Pure and dependency-free: no node built-ins, safe to ship to a browser.

/** One page row in the emitted index. Keys are terse because they repeat once per page. */
export interface SearchIndexPage {
  /** Root-relative route path, e.g. `/leistungen/`. Resolve it against the INDEX FILE's own URL —
   *  published sites are portable across a domain root, a sub-folder and `/sites/<slug>/`. */
  u: string;
  t: string;
  d?: string;
  /** Body token count, for BM25 length normalization. */
  n: number;
  /** Tree depth — a ranking prior. */
  dep: number;
  /** 1 when the page is in the main nav — a ranking prior. */
  nv: 0 | 1;
  /** Duplicate-group id: pages with identical body text share one, and a group contributes only ONE
   *  result — whichever member ranks highest for that query. There is no canonical flag in the
   *  format, so which URL wins can differ between queries when the members' priors differ
   *  (docs/site-search.md §5.5). */
  g: number;
  /** Short fields as ordered token lists: `t`, `d`, `h1`…`h6`. Empty fields are omitted. */
  f: Record<string, string[]>;
}

export interface SearchIndexFile {
  v: 1;
  /** The locale this index was built for; the runtime checks it against `<html lang>`. */
  lang: string;
  /**
   * Resolved diacritic folding for this index (absent = folded, the default). Written INTO the file
   * because the browser cannot read website settings — if the build stopped folding and the runtime
   * kept folding, queries would silently stop matching.
   */
  fold?: false;
  pages: SearchIndexPage[];
  /**
   * BODY postings: term → [pageIndex, delta-encoded ordinals][].
   *
   * ★ Read with `Object.hasOwn` — this is a plain object, so `terms['constructor']` or
   * `terms['toString']` would otherwise return an inherited FUNCTION and be treated as a posting list.
   */
  terms: Record<string, Array<[number, number[]]>>;
}

export interface SearchTextFile {
  v: 1;
  /** Per page, the extracted plain text — the source for context snippets. */
  text: string[];
  /** Per page, delta-encoded character offsets, indexed by body token ordinal. */
  offsets: number[][];
}

/** Delta-encode an ascending list of non-negative integers (first value kept absolute). */
export function encodeDeltas(values: readonly number[]): number[] {
  const out: number[] = [];
  let prev = 0;
  for (const v of values) {
    out.push(v - prev);
    prev = v;
  }
  return out;
}

/** Inverse of {@link encodeDeltas}. Used by the build's tests and by the browser runtime. */
export function decodeDeltas(deltas: readonly number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const d of deltas) {
    acc += d;
    out.push(acc);
  }
  return out;
}
