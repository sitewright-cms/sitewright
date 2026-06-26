// Detect repeated site chrome across the captured pages and hoist each region into its website skeleton
// slot (header→mainNav, footer→footer, asides→sidebarLeft/Right), removing it from every page body so it
// isn't duplicated. Regions are matched by landmark tag + ARIA role + common class/id patterns.
// Conservative: a region is only hoisted when an exact (class/id-insensitive) match appears on ≥60% of
// pages; otherwise each page keeps it inline (still renders, just not consolidated). JS-driven overlays
// (preloader, cookie banner) are REMOVED from every page (they'd block/persist without their stripped
// scripts); a detected preloader instead enables the platform's own preloader effect.
import { findOne, removeElement } from 'domutils';
import { isTag } from 'domhandler';
import { serialize, type Document, type Element } from '../dom.js';
import { transformFragment, type TransformCtx } from './page.js';
import type { ImportLimits } from '../types.js';

type Matcher = (el: Element) => boolean;
const cls = (el: Element, rx: RegExp): boolean => rx.test(el.attribs.class ?? '') || rx.test(el.attribs.id ?? '');

// Region matchers split into the SEMANTIC landmark (tag/role) and a CLASS fallback — picks prefer the
// landmark so a real `<header>` wins over a nested `div.navbar`. The class leading anchor is `(?:^|\s)`
// (a class TOKEN boundary, not `-`/`_`) so "no-sidebar"/"main-sidebar" don't substring-match "sidebar".
const isHeader: Matcher = (el) => el.name === 'header' || el.attribs.role === 'banner';
const isFooter: Matcher = (el) => el.name === 'footer' || el.attribs.role === 'contentinfo';
const isAside: Matcher = (el) => el.name === 'aside' || el.attribs.role === 'complementary';
const byClass = (rx: RegExp): Matcher => (el) => cls(el, rx);
const HEADER_CLASS = byClass(/(?:^|\s)(?:site-?header|page-?header|masthead|top-?bar|top-?nav|nav-?bar|nav-?wrapper|navbar|main-?nav|primary-?nav|menu-?bar)(?:$|[\s_-])/i);
const FOOTER_CLASS = byClass(/(?:^|\s)(?:site-?footer|page-?footer|footer-?wrapper|colophon|bottom-?bar)(?:$|[\s_-])/i);
// Left anchor is start-or-whitespace ONLY (not `-`): a token must BEGIN with the sidebar word, so a
// `#side-bar-left-wrapper` matches but a modifier like `no-sidebar`/`hide-sidebar` does not.
const ASIDE_CLASS = byClass(/(?:^|\s)(?:side-?bar|side-?panel|sidebar-?(?:left|right))(?:$|[\s_-])/i);
const PRELOADER: Matcher = byClass(/(?:^|\s)(?:preloader|pre-?load|loading-?overlay|page-?loader|site-?loader|loader-?wrap|spinner-?overlay)(?:$|[\s_-])/i);
const COOKIE: Matcher = byClass(/(?:^|\s)(?:cookie|consent|gdpr)(?:$|[\s_-])/i);

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
    // Drop attributes that legitimately vary per page for the SAME chrome — active-state (class/id/aria),
    // lazy-load hints (srcset/sizes/loading/decoding/fetchpriority), framework data-*, and style/title/
    // target/rel/tabindex — so "this header, with the current link active" reads as one shared region.
    .replace(/\s+(?:class|id|style|title|target|rel|tabindex|srcset|sizes|loading|decoding|fetchpriority|aria-current|aria-selected)="[^"]*"/gi, '')
    .replace(/\s+data-[\w-]+(?:="[^"]*")?/gi, '')
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
  // The region is confirmed shared chrome → replace EVERY page's variant with the one hoisted slot
  // (remove from all candidates, not just the matched group), so a page whose copy differs only by
  // per-page noise — e.g. the active link or a lazy-load hint — doesn't end up rendering it twice.
  for (const c of candidates) removeElement(c.el);
  return html;
}

/** All matching descendant elements, in document order. */
function findAllMatch(body: Element, m: Matcher): Element[] {
  const out: Element[] = [];
  const walk = (nodes: Element['children']): void => {
    for (const n of nodes) {
      if (!isTag(n)) continue;
      if (m(n)) out.push(n);
      walk(n.children);
    }
  };
  walk(body.children);
  return out;
}
const findFirst = (body: Element, m: Matcher): Element | undefined => (findOne(m, body.children, true) as Element | null) ?? undefined;
const findLast = (body: Element, m: Matcher): Element | undefined => findAllMatch(body, m).at(-1);

export interface ChromeResult {
  mainNav?: string;
  sidebarLeft?: string;
  sidebarRight?: string;
  footer?: string;
  /** A detected foreign preloader → enable the platform's own preloader effect (the foreign one is removed). */
  preloaderEffect?: 'spinner';
  extracted: boolean;
}

/** Extract shared chrome into its slots; mutates the page docs (removes the hoisted/cruft elements). */
export function extractChrome(pages: ParsedPage[], ctx: ChromeCtx): ChromeResult {
  // JS-driven overlays (preloader, cookie banner) would block/persist without their stripped scripts.
  // Remove them — but ONLY when they're SHARED site chrome (≥60% of pages, via extractRegion's gate), so
  // page-specific content that merely matches the pattern (e.g. a `cookie-recipe` article) is never lost.
  // The hoisted HTML is discarded (we don't reproduce the broken overlay); a preloader enables the
  // platform's own effect instead.
  const preloaderFound = extractRegion(pages, ctx, (body) => findFirst(body, PRELOADER)) !== undefined;
  extractRegion(pages, ctx, (body) => findFirst(body, COOKIE));

  // Header → mainNav (a slide-out mobile menu nested in the header travels with it; the platform's
  // single Main Navigation slot has no separate mobile slot). Footer = the LAST match. Up to two
  // asides → left/right sidebars.
  const mainNav = extractRegion(pages, ctx, (body) => findFirst(body, isHeader) ?? findFirst(body, HEADER_CLASS));
  const footer = extractRegion(pages, ctx, (body) => findLast(body, isFooter) ?? findLast(body, FOOTER_CLASS));
  // Left = the first aside; right = whatever aside REMAINS after the left is hoisted+removed (so a
  // single-aside site yields only a left sidebar, and a two-aside site fills both — no index drift).
  const sidebarLeft = extractRegion(pages, ctx, (body) => findFirst(body, isAside) ?? findFirst(body, ASIDE_CLASS));
  const sidebarRight = extractRegion(pages, ctx, (body) => findLast(body, isAside) ?? findLast(body, ASIDE_CLASS));

  const result: ChromeResult = {
    extracted: Boolean(mainNav || footer || sidebarLeft || sidebarRight || preloaderFound),
  };
  if (mainNav) result.mainNav = mainNav;
  if (footer) result.footer = footer;
  if (sidebarLeft) result.sidebarLeft = sidebarLeft;
  if (sidebarRight) result.sidebarRight = sidebarRight;
  if (preloaderFound) result.preloaderEffect = 'spinner';
  return result;
}
