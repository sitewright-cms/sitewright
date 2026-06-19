// Detect repeated site chrome (a shared <header> / <footer>) across the captured pages and hoist it
// into the website skeleton slots (topNav / footer), removing it from each page body so it isn't
// duplicated. Conservative: only an exact (class/id-insensitive) match on ≥60% of pages is extracted;
// otherwise each page keeps its own chrome inline (still renders, just not consolidated).
import { removeElement } from 'domutils';
import { allByName, firstByName, serialize, type Document, type Element } from '../dom.js';
import { transformFragment, type TransformCtx } from './page.js';
import type { ImportLimits } from '../types.js';

export interface ParsedPage {
  url: string;
  doc: Document;
  body: Element | undefined;
}

export interface ChromeCtx {
  siteBase: string;
  internalRoutes: ReadonlyMap<string, string>;
  assetMap: ReadonlyMap<string, string>;
  limits: ImportLimits;
}

/** Comparison signature: serialized HTML with volatile attributes (class/id/aria-current) and whitespace removed. */
function signature(el: Element): string {
  return serialize(el)
    .replace(/\s+(?:class|id|aria-current|aria-selected)="[^"]*"/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRegion(pages: ParsedPage[], ctx: ChromeCtx, pick: (body: Element) => Element | undefined): string | undefined {
  const candidates = pages
    .map((p) => ({ p, el: p.body ? pick(p.body) : undefined }))
    .filter((x): x is { p: ParsedPage; el: Element } => x.el !== undefined);
  if (candidates.length < 2) return undefined;

  const groups = new Map<string, { p: ParsedPage; el: Element }[]>();
  for (const c of candidates) {
    const sig = signature(c.el);
    groups.set(sig, [...(groups.get(sig) ?? []), c]);
  }
  let best: { p: ParsedPage; el: Element }[] | undefined;
  for (const g of groups.values()) if (!best || g.length > best.length) best = g;
  if (!best || best.length < 2 || best.length / pages.length < 0.6) return undefined;

  const rep = best[0]!;
  const tctx: TransformCtx = {
    pageUrl: rep.p.url,
    siteBase: ctx.siteBase,
    internalRoutes: ctx.internalRoutes,
    assetMap: ctx.assetMap,
    limits: ctx.limits,
  };
  const html = transformFragment(rep.el, tctx, ctx.limits.maxSlotBytes);
  if (!html) return undefined;
  for (const c of best) removeElement(c.el);
  return html;
}

/** Extract shared chrome into slots; mutates the page docs (removes the hoisted elements). */
export function extractChrome(pages: ParsedPage[], ctx: ChromeCtx): { topNav?: string; footer?: string; extracted: boolean } {
  const topNav = extractRegion(pages, ctx, (body) => firstByName(body.children, 'header'));
  const footer = extractRegion(pages, ctx, (body) => {
    const all = allByName(body.children, 'footer');
    return all[all.length - 1];
  });
  const result: { topNav?: string; footer?: string; extracted: boolean } = { extracted: Boolean(topNav || footer) };
  if (topNav) result.topNav = topNav;
  if (footer) result.footer = footer;
  return result;
}
