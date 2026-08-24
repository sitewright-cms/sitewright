import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import { pagePath, pagesById, withResolvedParent } from '@sitewright/core';

/**
 * `scripts/backfill-page-parents.mjs` carries its own copy of the page-tree resolution, because it has
 * to run from a bare checkout where `scripts/` can resolve no workspace package. A copy that drifts from
 * the real resolver would write a DIFFERENT tree than the API would — quietly, across every project on
 * an instance — so this pins the two together. If it fails, the script and the core changed apart.
 */
interface ScriptApi {
  pagePath: (page: Page, byId: Map<string, Page>) => string;
  pagesById: (pages: readonly Page[]) => Map<string, Page>;
  withResolvedParent: (
    page: Page,
    pages: readonly Page[],
    defaultLocale: string,
    opts?: { repairDangling?: boolean },
  ) => Page;
}

// A non-literal specifier: the script is plain JS with no declarations, and a static import would be a
// resolution error rather than the parity check this file is for.
const scriptUrl = new URL('../../../scripts/backfill-page-parents.mjs', import.meta.url).href;
const script = (await import(scriptUrl)) as ScriptApi;

const page = (over: Partial<Page>): Page => ({ id: 'p', path: '', title: 'T', ...over }) as Page;

const home = page({ id: 'home', path: '', title: 'Home' });
const deHome = page({ id: 'home-de', path: 'de', locale: 'de', parent: 'home', translationGroup: 'home' });
const about = page({ id: 'about', path: 'about' });
const services = page({ id: 'services', path: 'services', parent: 'home' });
const nested = page({ id: 'web', path: 'web-design', parent: 'services' });
const deChild = page({ id: 'kontakt', path: 'kontakt', locale: 'de' });
const frChild = page({ id: 'svc-fr', path: 'services', locale: 'fr' });
const placeholder = page({ id: 'grp', path: '', kind: 'link' } as Partial<Page>);
const dangling = page({ id: 'ghost', path: 'ghost', parent: 'no-such-page' });
const selfParent = page({ id: 'loop', path: 'loop', parent: 'loop' });
const cycleA = page({ id: 'a', path: 'a', parent: 'b' });
const cycleB = page({ id: 'b', path: 'b', parent: 'a' });

const CASES: { name: string; page: Page; pages: Page[]; repair?: boolean }[] = [
  { name: 'default-locale page', page: about, pages: [home, about] },
  { name: 'the root home itself', page: home, pages: [home, about] },
  { name: 'locale home', page: deHome, pages: [home, deHome] },
  { name: 'non-default-locale page with a locale home', page: deChild, pages: [home, deHome, deChild] },
  { name: 'non-default-locale page WITHOUT one', page: frChild, pages: [home, frChild] },
  { name: 'already nested', page: nested, pages: [home, services, nested] },
  { name: 'nav placeholder at the empty slug', page: placeholder, pages: [home, placeholder] },
  { name: 'no home in the project at all', page: about, pages: [about] },
  { name: 'dangling parent, no repair', page: dangling, pages: [home, dangling] },
  { name: 'dangling parent, repairing', page: dangling, pages: [home, dangling], repair: true },
  { name: 'self-parent', page: selfParent, pages: [home, selfParent] },
  { name: 'self-parent, repairing', page: selfParent, pages: [home, selfParent], repair: true },
  { name: 'mutual cycle, repairing', page: cycleA, pages: [home, cycleA, cycleB], repair: true },
  { name: 'mutual cycle, no repair', page: cycleA, pages: [home, cycleA, cycleB] },
];

describe('the backfill script resolves parents exactly like @sitewright/core', () => {
  it.each(CASES)('$name', ({ page: p, pages, repair }) => {
    const opts = repair ? { repairDangling: true } : undefined;
    const mine = script.withResolvedParent(p, pages, 'en', opts);
    const core = withResolvedParent(p, pages, 'en', opts);
    expect(mine.parent, 'resolved parent').toBe(core.parent);
  });

  it('computes the same routes, which is what the URL-change report is built from', () => {
    const all = [home, deHome, services, nested, deChild];
    const mineById = script.pagesById(all);
    const coreById = pagesById(all);
    for (const p of all) {
      expect(script.pagePath(p, mineById), p.id).toBe(pagePath(p, coreById));
    }
  });

  it('reports the same route AFTER a whole-project pass — the number the operator acts on', () => {
    // The report's "URL change" column compares before/after across the resolved set, so parity on one
    // page is not enough: the locale home must move first for its children's route to be right.
    const all = [home, deHome, deChild, about, dangling];
    const mine = all.map((p) => script.withResolvedParent(p, all, 'en', { repairDangling: true }));
    const core = all.map((p) => withResolvedParent(p, all, 'en', { repairDangling: true }));
    const mineById = script.pagesById(mine);
    const coreById = pagesById(core);
    for (const [i, p] of mine.entries()) {
      expect(script.pagePath(p, mineById), p.id).toBe(pagePath(core[i]!, coreById));
    }
  });
});
