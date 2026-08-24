import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import { defaultParentFor, withResolvedParent } from '../src/index.js';

// `path` is a SLUG SEGMENT (empty for home); full routes come from the parent chain.
const page = (over: Partial<Page>): Page => ({ id: 'p', path: '', title: 'T', ...over }) as Page;

const home = page({ id: 'home', path: '', title: 'Home' });
// A locale home is the home's translation-group sibling carrying the language slug.
const deHome = page({ id: 'home-de', path: 'de', title: 'Startseite', locale: 'de', parent: 'home', translationGroup: 'home' });

describe('defaultParentFor', () => {
  it('leaves the root home parentless', () => {
    expect(defaultParentFor(home, [home], 'en')).toBeUndefined();
  });

  it('parents a default-locale page to the root home', () => {
    const about = page({ id: 'about', path: 'about' });
    expect(defaultParentFor(about, [home, about], 'en')).toBe('home');
  });

  it('parents a non-default-locale page to its own locale home', () => {
    const leistungen = page({ id: 'leistungen', path: 'leistungen', locale: 'de' });
    expect(defaultParentFor(leistungen, [home, deHome, leistungen], 'en')).toBe('home-de');
  });

  it('falls back to the root home when the language has no home of its own', () => {
    const services = page({ id: 'svc', path: 'services', locale: 'fr' });
    expect(defaultParentFor(services, [home, services], 'en')).toBe('home');
  });

  it('parents a locale home to the root home, never to itself', () => {
    expect(defaultParentFor(deHome, [home, deHome], 'en')).toBe('home');
  });

  it('yields nothing when the project has no home at all', () => {
    const orphan = page({ id: 'o', path: 'orphan' });
    expect(defaultParentFor(orphan, [orphan], 'en')).toBeUndefined();
  });

  it('never returns a parent that descends from the page (cycle guard)', () => {
    // Corrupt data: the home already sits under the page we are parenting.
    const stray = page({ id: 'stray', path: 'stray' });
    const sunkHome = page({ id: 'home', path: '', title: 'Home', parent: 'stray' });
    expect(defaultParentFor(stray, [sunkHome, stray], 'en')).toBeUndefined();
  });

  it('treats a nav placeholder at the empty slug as a normal page, not the home', () => {
    const placeholder = page({ id: 'grp', path: '', kind: 'link' });
    expect(defaultParentFor(placeholder, [home, placeholder], 'en')).toBe('home');
  });
});

describe('withResolvedParent', () => {
  it('keeps an author-set parent untouched', () => {
    const child = page({ id: 'web', path: 'web-design', parent: 'services' });
    const services = page({ id: 'services', path: 'services', parent: 'home' });
    expect(withResolvedParent(child, [home, services, child], 'en')).toBe(child);
  });

  it('fills an absent parent', () => {
    const about = page({ id: 'about', path: 'about' });
    expect(withResolvedParent(about, [home, about], 'en').parent).toBe('home');
  });

  it('returns the page unchanged when there is nothing to parent it to', () => {
    const orphan = page({ id: 'o', path: 'orphan' });
    expect(withResolvedParent(orphan, [orphan], 'en')).toBe(orphan);
  });

  it('repairs a page parented to ITSELF, with or without the repair flag', () => {
    // Unlike a forward reference, a self-parent can never be made good by a later write.
    const self = page({ id: 'x', path: 'x', parent: 'x' });
    expect(withResolvedParent(self, [home, self], 'en').parent).toBe('home');
    expect(withResolvedParent(self, [home, self], 'en', { repairDangling: true }).parent).toBe('home');
  });

  it('breaks a MUTUAL parent cycle during a whole-project pass', () => {
    // a→b→a: both ids exist, so an existence check calls this healthy while the pair floats rootless.
    const a = page({ id: 'a', path: 'a', parent: 'b' });
    const b = page({ id: 'b', path: 'b', parent: 'a' });
    const all = [home, a, b];
    expect(withResolvedParent(a, all, 'en', { repairDangling: true }).parent).toBe('home');
    expect(withResolvedParent(b, all, 'en', { repairDangling: true }).parent).toBe('home');
    // A single write cannot judge a cycle, and must not second-guess a parent that exists.
    expect(withResolvedParent(a, all, 'en')).toBe(a);
  });

  it('leaves a healthy deep chain alone during a repair pass', () => {
    const services = page({ id: 'services', path: 'services', parent: 'home' });
    const web = page({ id: 'web', path: 'web-design', parent: 'services' });
    const all = [home, services, web];
    expect(withResolvedParent(web, all, 'en', { repairDangling: true })).toBe(web);
  });

  it('repairs a dangling parent only when asked', () => {
    const dangling = page({ id: 'd', path: 'd', parent: 'ghost' });
    expect(withResolvedParent(dangling, [home, dangling], 'en')).toBe(dangling);
    expect(withResolvedParent(dangling, [home, dangling], 'en', { repairDangling: true }).parent).toBe('home');
  });
});
