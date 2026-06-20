// Multilingual handling. A crawled `/de/about` already lands (via routes.ts) as an `about` page nested
// under a `de` page — which is EXACTLY Sitewright's locale-variant shape (a locale's home slug is the
// locale code; its pages nest under it). So this is a post-pass: label those prefixed pages with their
// `locale` + a shared `translationGroup` (linking each variant to its default-locale owner), derive the
// project's locale list, and clear duplicate cross-locale nav. Mono-lingual sites are a no-op.
import type { Page } from '@sitewright/schema';
import { pagePath, pagesById } from '@sitewright/core';
import type { Document } from '../dom.js';
import { allByName, firstByName } from '../dom.js';

// A plausible BCP-47-ish locale code (lang or lang-region); excludes garbage hreflang values.
// Linear: anchored, fixed-bounded quantifiers + a single optional group (not ReDoS).
// eslint-disable-next-line security/detect-unsafe-regex
const LOCALE_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/;

/** The set of locales the site advertises — from `<html lang>` + `<link rel="alternate" hreflang>`. */
export function detectLocaleSet(pages: { doc: Document }[]): Set<string> {
  const set = new Set<string>();
  const add = (raw?: string): void => {
    if (!raw) return;
    const l = raw.trim().toLowerCase();
    if (l === '' || l === 'x-default') return;
    if (LOCALE_RE.test(l)) set.add(l);
  };
  for (const { doc } of pages) {
    add(firstByName(doc.children, 'html')?.attribs.lang);
    for (const link of allByName(doc.children, 'link')) {
      if (/(^|\s)alternate(\s|$)/i.test(link.attribs.rel ?? '')) add(link.attribs.hreflang);
    }
  }
  return set;
}

export interface LocaleResult {
  locales: string[];
  defaultLocale: string;
}

/**
 * Label locale-prefixed pages with `locale` + `translationGroup` (shared with their default-locale
 * owner), and return the project's locale list. Mutates `pages`. No-op for a single-locale site.
 */
export function applyLocales(pages: Page[], localeSet: Set<string>, defaultLocaleHint: string): LocaleResult {
  const realLocales = [...localeSet];
  if (realLocales.length < 2) return { locales: [defaultLocaleHint], defaultLocale: defaultLocaleHint };

  const byId = pagesById(pages);
  const routeOf = new Map<string, string>();
  for (const p of pages) routeOf.set(p.id, pagePath(p, byId));
  const firstSeg = (route: string): string | undefined => route.split('/').filter(Boolean)[0]?.toLowerCase();

  // Which locales actually appear as a URL prefix (so the others are served unprefixed = default).
  const prefixLocales = new Set<string>();
  for (const p of pages) {
    const s = firstSeg(routeOf.get(p.id)!);
    if (s && localeSet.has(s)) prefixLocales.add(s);
  }
  const unprefixed = realLocales.filter((l) => !prefixLocales.has(l));
  const defaultLocale = unprefixed.includes(defaultLocaleHint)
    ? defaultLocaleHint
    : unprefixed[0] ?? (localeSet.has(defaultLocaleHint) ? defaultLocaleHint : realLocales[0]!);

  const strip = (route: string, seg: string): string => (route === `/${seg}` ? '/' : route.slice(`/${seg}`.length));

  // Translation owners (the default-locale pages), keyed by their CANONICAL (prefix-stripped) route — so
  // variants link correctly whether the default is served unprefixed (/about) or prefixed (/en/about,
  // the all-locales-prefixed shape). An unprefixed owner wins over a prefixed one for the same route.
  const ownerByRoute = new Map<string, Page>();
  for (const p of pages) {
    const route = routeOf.get(p.id)!;
    const s = firstSeg(route);
    if (!s || !prefixLocales.has(s)) ownerByRoute.set(route, p); // unprefixed default-locale page
    else if (s === defaultLocale && !ownerByRoute.has(strip(route, s))) ownerByRoute.set(strip(route, s), p); // prefixed default
  }

  for (const p of pages) {
    const route = routeOf.get(p.id)!;
    const seg = firstSeg(route);
    if (!seg || !prefixLocales.has(seg) || seg === defaultLocale) continue; // default-locale page → leave as-is
    p.locale = seg;
    delete p.nav; // the default locale owns the auto-nav; variants would just duplicate header items
    const owner = ownerByRoute.get(strip(route, seg)); // prefix-stripped → the default-locale owner
    if (owner) {
      const group = owner.translationGroup ?? owner.id;
      owner.translationGroup = group;
      p.translationGroup = group;
    }
  }

  // Deterministic order (default first, then the rest alphabetically) — independent of crawl order.
  return { locales: [defaultLocale, ...realLocales.filter((l) => l !== defaultLocale).sort()], defaultLocale };
}
