import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import { pageRemovalRefusal, planPageRemoval } from '../src/index.js';

// `path` is a SLUG SEGMENT (empty for home); full routes come from the parent chain.
const page = (over: Partial<Page>): Page => ({ id: 'p', path: '', title: 'T', ...over }) as Page;

const home = page({ id: 'home', path: '', title: 'Home' });
const deHome = page({ id: 'home-de', path: 'de', locale: 'de', parent: 'home', translationGroup: 'home' });

describe('planPageRemoval', () => {
  it('moves children up to the removed page’s own parent — one level, keeping the subtree', () => {
    const services = page({ id: 'services', path: 'services', parent: 'home' });
    const web = page({ id: 'web', path: 'web', parent: 'services' });
    const seo = page({ id: 'seo', path: 'seo', parent: 'web' });
    const plan = planPageRemoval([home, services, web, seo], ['web'], 'en');

    expect(plan.removed.map((p) => p.id)).toEqual(['web']);
    // `seo` lands where `web` was (under `services`); nothing else moves.
    expect(plan.reparented).toEqual([{ ...seo, parent: 'services' }]);
    expect(plan.clashes).toEqual([]);
  });

  it('walks past every removed ancestor to the nearest one that stays', () => {
    const a = page({ id: 'a', path: 'a', parent: 'home' });
    const b = page({ id: 'b', path: 'b', parent: 'a' });
    const c = page({ id: 'c', path: 'c', parent: 'b' });
    const plan = planPageRemoval([home, a, b, c], ['a', 'b'], 'en');
    expect(plan.reparented.map((p) => [p.id, p.parent])).toEqual([['c', 'home']]);
  });

  it('terminates on a parent CYCLE among removed pages, falling back to the home', () => {
    const a = page({ id: 'a', path: 'a', parent: 'b' });
    const b = page({ id: 'b', path: 'b', parent: 'a' });
    const c = page({ id: 'c', path: 'c', parent: 'a' });
    const plan = planPageRemoval([home, a, b, c], ['a', 'b'], 'en');
    expect(plan.reparented.map((p) => [p.id, p.parent])).toEqual([['c', 'home']]);
  });

  it('terminates on a SELF-parented removed page too', () => {
    const a = page({ id: 'a', path: 'a', parent: 'a' });
    const c = page({ id: 'c', path: 'c', parent: 'a' });
    expect(planPageRemoval([home, a, c], ['a'], 'en').reparented.map((p) => [p.id, p.parent])).toEqual([['c', 'home']]);
  });

  it('falls back to the language home when the whole chain above goes', () => {
    // A German page under a German parent with no parent of its own: both removed → its language home.
    const orphanParent = page({ id: 'x', path: 'x', locale: 'de' });
    const child = page({ id: 'y', path: 'y', locale: 'de', parent: 'x' });
    const plan = planPageRemoval([home, deHome, orphanParent, child], ['x'], 'en');
    expect(plan.reparented.map((p) => [p.id, p.parent])).toEqual([['y', 'home-de']]);
  });

  it('★ refuses (reports) a move onto an address another page already has', () => {
    const services = page({ id: 'services', path: 'services', parent: 'home' });
    const nested = page({ id: 'nested-about', path: 'about', parent: 'services' }); // /services/about/
    const about = page({ id: 'about', path: 'about', parent: 'home' }); //            /about/
    const plan = planPageRemoval([home, services, nested, about], ['services'], 'en');
    expect(plan.clashes).toEqual([{ route: '/about/', pageIds: ['nested-about', 'about'] }]);
  });

  it('does not blame a removal for a duplicate that was already there', () => {
    const one = page({ id: 'one', path: 'dup', parent: 'home' });
    const two = page({ id: 'two', path: 'dup', parent: 'home' });
    const leaf = page({ id: 'leaf', path: 'leaf', parent: 'home' });
    expect(planPageRemoval([home, one, two, leaf], ['leaf'], 'en').clashes).toEqual([]);
  });

  it('ignores link placeholders when looking for clashes (they have no address)', () => {
    const group = page({ id: 'group', path: 'about', parent: 'home' });
    const child = page({ id: 'child', path: 'team', parent: 'group' });
    const link = page({ id: 'link', path: 'team', parent: 'home', kind: 'link' } as Partial<Page>);
    expect(planPageRemoval([home, group, child, link], ['group'], 'en').clashes).toEqual([]);
  });

  it('with cascadeVariants, takes the variants that follow a main-language page and detaches the ones with code', () => {
    const about = page({ id: 'about', path: 'about', parent: 'home', translationGroup: 'about', source: '<h1>x</h1>' });
    const aboutDe = page({ id: 'about-de', path: 'about', locale: 'de', parent: 'home-de', translationGroup: 'about' }); // inherits
    const aboutFr = page({ id: 'about-fr', path: 'about', locale: 'fr', parent: 'home', translationGroup: 'about', source: '<h1>fr</h1>' }); // forked
    const all = [home, deHome, about, aboutDe, aboutFr];

    const plan = planPageRemoval(all, ['about'], 'en', { cascadeVariants: true });
    expect(plan.removed.map((p) => p.id)).toEqual(['about', 'about-de']);
    expect(plan.cascaded.map((p) => p.id)).toEqual(['about-de']);
    expect(plan.detached).toHaveLength(1);
    expect(plan.detached[0]).toMatchObject({ id: 'about-fr', source: '<h1>fr</h1>' });
    expect(plan.detached[0]).not.toHaveProperty('translationGroup');

    // Without the option, only what was asked for goes.
    expect(planPageRemoval(all, ['about'], 'en').removed.map((p) => p.id)).toEqual(['about']);
  });

  it('finds the variants of a main page that never carried `translationGroup` itself (the group is its id)', () => {
    const about = page({ id: 'about', path: 'about', parent: 'home' });
    const aboutDe = page({ id: 'about-de', path: 'about', locale: 'de', parent: 'home-de', translationGroup: 'about' });
    const plan = planPageRemoval([home, deHome, about, aboutDe], ['about'], 'en', { cascadeVariants: true });
    expect(plan.cascaded.map((p) => p.id)).toEqual(['about-de']);
  });

  it('a removed variant’s children move up within their own language', () => {
    const about = page({ id: 'about', path: 'about', parent: 'home', translationGroup: 'about' });
    const aboutDe = page({ id: 'about-de', path: 'about', locale: 'de', parent: 'home-de', translationGroup: 'about' });
    const teamDe = page({ id: 'team-de', path: 'team', locale: 'de', parent: 'about-de' });
    const plan = planPageRemoval([home, deHome, about, aboutDe, teamDe], ['about'], 'en', { cascadeVariants: true });
    expect(plan.reparented.map((p) => [p.id, p.parent])).toEqual([['team-de', 'home-de']]);
  });

  it('ignores ids that are not pages', () => {
    expect(planPageRemoval([home], ['nope'], 'en')).toEqual({ removed: [], cascaded: [], reparented: [], detached: [], clashes: [] });
  });
});

describe('pageRemovalRefusal', () => {
  it('refuses the root home and a language home while pages hang under them', () => {
    const about = page({ id: 'about', path: 'about', parent: 'home' });
    const ueber = page({ id: 'ueber', path: 'ueber', locale: 'de', parent: 'home-de' });
    const all = [home, deHome, about, ueber];
    expect(pageRemovalRefusal(home, all, 'en')).toMatch(/home page cannot be deleted while 2 pages hang under it/);
    expect(pageRemovalRefusal(deHome, all, 'en')).toMatch(/removed together with its language \(1 page hangs under it\)/);
    expect(pageRemovalRefusal(about, all, 'en')).toBeNull();
  });

  it('lets an empty home go — with nothing under it there is nothing to strand', () => {
    expect(pageRemovalRefusal(home, [home], 'en')).toBeNull();
    // A slugless nav placeholder is never a home, whatever is under it.
    const link = page({ id: 'l', path: '', kind: 'link' } as Partial<Page>);
    expect(pageRemovalRefusal(link, [link, page({ id: 'c', path: 'c', parent: 'l' })], 'en')).toBeNull();
  });
});
