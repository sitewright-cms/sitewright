import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { extractClassNames, MAX_EXTRACTED_CLASS_TOKENS } from '@sitewright/core';
import { knownUtilityVerdict, type UtilityProbe } from '@sitewright/tailwind';

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
 * ★ Only classes that COMPILE TO A RULE count. Rendered markup is full of classes that are no utility — the
 * platform's own `sw-icon-*`, an imported blog's `wp-image-1234` — and they must neither crowd genuine
 * utilities out of the bounded set nor make a utility-free site start shipping (and linking) a stylesheet.
 * Each class is judged once, by Tailwind's own design system (`createUtilityProbe`), which is loaded only
 * when a class actually needs asking about. A site whose pages render no utility beyond their sources
 * builds byte-identically to before.
 */

/**
 * Site-wide ceiling on render-only UTILITIES (classes that compile to a rule — junk never counts). Bounds
 * the compiler's work; real sites add a handful. Past it, further utilities are dropped and reported.
 */
export const MAX_RENDERED_CLASS_TOKENS = 8192;

/**
 * How many classes the harvest remembers as junk (or as utilities refused by the cap) so later pages don't
 * ask again. Memory only: past it, a class is simply judged again when it reappears.
 */
const VERDICT_MEMO = 65_536;

/** Pages read + rewritten at once by {@link relinkStylesheet}. */
const RELINK_CONCURRENCY = 8;

/** What the harvest found, and what it had to leave out. */
export interface RenderedClassStats {
  /** Render-only classes that compile to a rule and are in the sheet. */
  utilities: number;
  /** Distinct render-only utilities left out because {@link MAX_RENDERED_CLASS_TOKENS} was reached. */
  droppedUtilities: number;
  /** Scans of one page's body or slot that hit extractClassNames' per-call cap (classes past it are unseen). */
  cappedScans: number;
}

export interface RenderedClassHarvest {
  /**
   * Record the classes in one page's rendered markup (body and chrome slots). Resolves whether that markup
   * renders a class the source scan missed that compiles to a rule — such a page needs the utility sheet
   * even when the source scan found nothing at all.
   */
  add(markup: readonly (string | undefined)[]): Promise<boolean>;
  /** The render-only utilities, SORTED so the sheet and its token are deterministic. */
  utilities(): string[];
  stats(): RenderedClassStats;
}

export interface RenderedClassHarvestOptions {
  /** Loads the utility probe — called at most once, and only when a class needs a compiler's verdict. */
  probe: () => Promise<UtilityProbe>;
  /** Override {@link MAX_RENDERED_CLASS_TOKENS} (tests). */
  max?: number;
}

/** A harvest seeded with the build's source-scan candidates (`sourceClasses`), which it never repeats. */
export function renderedClassHarvest(
  sourceClasses: readonly string[],
  opts: RenderedClassHarvestOptions,
): RenderedClassHarvest {
  const max = opts.max ?? MAX_RENDERED_CLASS_TOKENS;
  const known = new Set(sourceClasses);
  const kept = new Set<string>();
  const overCap = new Set<string>();
  const junk = new Set<string>();
  let probe: Promise<UtilityProbe> | undefined;
  let cappedScans = 0;
  const remember = (set: Set<string>, token: string): void => {
    if (set.size < VERDICT_MEMO) set.add(token);
  };
  const accept = (token: string): void => {
    if (kept.size < max) kept.add(token);
    else remember(overCap, token);
  };
  return {
    async add(markup) {
      let renders = false;
      const unjudged = new Set<string>();
      for (const html of markup) {
        if (!html) continue;
        const classes = extractClassNames(html);
        if (classes.length >= MAX_EXTRACTED_CLASS_TOKENS) cappedScans += 1;
        for (const token of classes) {
          if (known.has(token) || junk.has(token)) continue;
          if (kept.has(token) || overCap.has(token)) {
            renders = true;
            continue;
          }
          const verdict = knownUtilityVerdict(token);
          if (verdict === undefined) unjudged.add(token);
          else if (verdict) {
            accept(token);
            renders = true;
          } else remember(junk, token);
        }
      }
      if (unjudged.size > 0) {
        const tokens = [...unjudged];
        probe ??= opts.probe();
        const verdicts = (await probe).produces(tokens);
        tokens.forEach((token, i) => {
          if (verdicts.at(i)) {
            accept(token);
            renders = true;
          } else remember(junk, token);
        });
      }
      return renders;
    },
    utilities: () => [...kept].sort(),
    stats: () => ({ utilities: kept.size, droppedUtilities: overCap.size, cappedScans }),
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
