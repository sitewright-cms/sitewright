import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { extractClassNames } from '@sitewright/core';

/**
 * ★ THE PUBLISHED UTILITY SHEET ALSO COMPILES WHAT THE PAGES RENDERED — the editor preview's own rule.
 *
 * The build's candidate set is a SOURCE scan (page sources, slots, snippets, plus the DB-resident markup fed
 * in explicitly), while the editor preview compiles from the RENDERED page. Every class that materializes
 * only at render time therefore looked right in the editor and shipped unstyled: an interpolated name
 * (`bg-{{tone}}-600`), a helper's own markup, a data value carrying HTML. Each such gap used to be closed one
 * feed at a time, after it bit. Harvesting the rendered body + chrome slots of every page — the same markup
 * the preview scans — closes the class of bug instead: whatever a published page renders, its sheet compiles.
 *
 * The source scan stays the primary set (it also covers branches this publish did not render), and the
 * harvest only ADDS what it missed. A site whose pages render nothing beyond their sources builds
 * byte-identically to before.
 */

/**
 * Site-wide ceiling on harvested render-only class tokens. The harvest reads author content (an imported
 * blog's per-image `wp-image-1234` classes are all distinct), and every token is a Tailwind candidate, so the
 * union is bounded like each scan is. Real sites add a few hundred; past the cap, further tokens are dropped.
 */
export const MAX_RENDERED_CLASS_TOKENS = 8192;

/** Pages read + rewritten at once by {@link relinkStylesheet}. */
const RELINK_CONCURRENCY = 8;

export interface RenderedClassHarvest {
  /**
   * Record the classes in one page's rendered markup (body and chrome slots). Returns whether that markup
   * carries any class at all — such a page needs the utility sheet even when the source scan found none.
   */
  add(markup: readonly (string | undefined)[]): boolean;
  /** The harvested tokens the source scan did not find, SORTED so the sheet and its token are deterministic. */
  extras(): string[];
}

/** A harvest seeded with the build's source-scan candidates (`sourceClasses`), which it never repeats. */
export function renderedClassHarvest(
  sourceClasses: readonly string[],
  max: number = MAX_RENDERED_CLASS_TOKENS,
): RenderedClassHarvest {
  const known = new Set(sourceClasses);
  const extra = new Set<string>();
  return {
    add(markup) {
      let any = false;
      for (const html of markup) {
        if (!html) continue;
        for (const token of extractClassNames(html)) {
          any = true;
          if (extra.size < max && !known.has(token)) extra.add(token);
        }
      }
      return any;
    },
    extras: () => [...extra].sort(),
  };
}

/**
 * The `?v=` token of a utility sheet whose bytes depend on what the pages RENDERED: the build's asset token
 * folded with the compiled CSS. The asset token is derived from the source scan alone, so it cannot move when
 * only render-time content changes (a dataset edit turning `bg-emerald-600` into `bg-rose-600`) — and a visitor
 * holding the immutable `styles.css?v=<token>` would never fetch the new rule. Same length as `assetVer`, so
 * re-pointing a link never changes a page's byte count.
 */
export function renderedStylesheetVersion(assetVer: string, css: string): string {
  return createHash('sha256').update(assetVer).update('\x00').update(css).digest('hex').slice(0, assetVer.length);
}

/**
 * Re-point every written page's stylesheet link from `from` to `to` (each `<file>?v=<token>`, equal length),
 * once the sheet's final token is known. Pages are written as they render (never buffered — a large site
 * would not fit), while the render-time classes are known only after the last page, so the link is
 * corrected in place. A page without the link (an error document, a raw-HTML page) is left untouched.
 * Returns how many pages changed.
 */
export async function relinkStylesheet(paths: Iterable<string>, from: string, to: string): Promise<number> {
  if (from.length !== to.length) throw new Error('stylesheet relink must keep the link length');
  const queue = [...paths];
  let next = 0;
  let changed = 0;
  // A few files in flight at once: the pass is pure I/O, and one-at-a-time made it the largest cost this
  // feature adds to a build (measured ~105 ms per 600 pages sequential). Bounded, so a large site never holds
  // more than RELINK_CONCURRENCY pages in memory.
  const worker = async (): Promise<void> => {
    while (next < queue.length) {
      const path = queue[next++]!;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the build's own written pages, confined to its tmp dir
      const html = await readFile(path, 'utf8');
      if (!html.includes(from)) continue;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the build's own written pages, confined to its tmp dir
      await writeFile(path, html.split(from).join(to), 'utf8');
      changed += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(RELINK_CONCURRENCY, queue.length) }, worker));
  return changed;
}
