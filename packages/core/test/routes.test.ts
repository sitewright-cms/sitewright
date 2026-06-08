import { describe, expect, it } from 'vitest';
import type { Entry, Page } from '@sitewright/schema';
import type { ProjectBundle } from '../src/validate.js';
import {
  allRoutes,
  collectionRoutes,
  datasetEntries,
  entrySlug,
  pagePath,
  pagesById,
  pathToSlug,
  publishedPages,
  resolvedPages,
} from '../src/routes.js';

function page(partial: Partial<Page> & { id: string; path: string }): Page {
  return {
    title: partial.id,
    root: { id: `${partial.id}-root`, type: 'Section' },
    ...partial,
  } as Page;
}

describe('publishedPages', () => {
  it('drops draft pages and keeps published + status-absent (legacy) pages', () => {
    const pages = [
      page({ id: 'home', path: '' }), // no status → published
      page({ id: 'live', path: 'live', status: 'published' }),
      page({ id: 'wip', path: 'wip', status: 'draft' }),
    ];
    expect(publishedPages(pages).map((p) => p.id)).toEqual(['home', 'live']);
  });
});

function bundle(over: Partial<ProjectBundle> = {}): ProjectBundle {
  return {
    project: {
      formatVersion: 2,
      id: 'p',
      name: 'P',
      slug: 'p',
      identity: { name: 'P', colors: {} },
      settings: { defaultLocale: 'en', locales: ['en'] },
    },
    pages: [],
    partials: [],
    datasets: [],
    entries: [],
    ...over,
  } as ProjectBundle;
}

describe('pathToSlug', () => {
  it('maps "/" to undefined and strips slashes', () => {
    expect(pathToSlug('/')).toBeUndefined();
    expect(pathToSlug('/about')).toBe('about');
    expect(pathToSlug('/blog/')).toBe('blog');
  });
});

describe('pagePath', () => {
  it('computes the full route from the parent chain (slug segments)', () => {
    const pages = [
      page({ id: 'home', path: '' }),
      page({ id: 'about', path: 'about', parent: 'home' }),
      page({ id: 'de', path: 'de', parent: 'home' }),
      page({ id: 'leistungen', path: 'leistungen', parent: 'de' }),
      page({ id: 'orphan', path: 'x', parent: 'missing' }), // unknown parent → treated as root
    ];
    const byId = pagesById(pages);
    expect(pagePath(pages[0]!, byId)).toBe('/'); // home (empty slug, no parent)
    expect(pagePath(pages[1]!, byId)).toBe('/about');
    expect(pagePath(pages[3]!, byId)).toBe('/de/leistungen'); // two levels deep
    expect(pagePath(pages[4]!, byId)).toBe('/x'); // parent not found → root
  });

  it('is cycle-safe (a broken parent chain stops at the first repeat)', () => {
    const pages = [page({ id: 'a', path: 'a', parent: 'b' }), page({ id: 'b', path: 'b', parent: 'a' })];
    const byId = pagesById(pages);
    expect(() => pagePath(pages[0]!, byId)).not.toThrow();
  });
});

describe('entrySlug', () => {
  const entry: Entry = { id: 'e1', dataset: 'posts', status: 'published', values: { slug: 'hello-world' } };
  it('uses a safe field value', () => {
    expect(entrySlug(entry, 'slug')).toBe('hello-world');
  });
  it('falls back to the id for unsafe/missing values', () => {
    expect(entrySlug({ ...entry, values: { slug: '../etc' } }, 'slug')).toBe('e1');
    expect(entrySlug({ ...entry, values: {} }, 'slug')).toBe('e1');
  });
});

describe('datasetEntries', () => {
  it('groups entries by dataset (drafts included)', () => {
    const entries: Entry[] = [
      { id: 'a', dataset: 'posts', status: 'published', values: {} },
      { id: 'b', dataset: 'posts', status: 'draft', values: {} },
      { id: 'c', dataset: 'authors', status: 'published', values: {} },
    ];
    const grouped = datasetEntries(bundle({ entries }));
    expect(grouped.posts).toHaveLength(2);
    expect(grouped.authors).toHaveLength(1);
  });

  it('sorts each group by the entry `order` (absent last, id tie-break)', () => {
    const entries: Entry[] = [
      { id: 'z', dataset: 'posts', status: 'published', values: {} }, // no order → last
      { id: 'b', dataset: 'posts', status: 'published', values: {}, order: 1 },
      { id: 'a', dataset: 'posts', status: 'published', values: {}, order: 0 },
    ];
    expect(datasetEntries(bundle({ entries })).posts!.map((e) => e.id)).toEqual(['a', 'b', 'z']);
  });
});

describe('resolvedPages / allRoutes', () => {
  it('returns static page routes (slugs computed from the parent chain)', () => {
    const b = bundle({ pages: [page({ id: 'home', path: '' }), page({ id: 'about', path: 'about', parent: 'home' })] });
    expect(resolvedPages(b)).toHaveLength(2);
    expect(allRoutes(b).map((r) => r.slug)).toEqual([undefined, 'about']);
  });

  it('throws on duplicate routes', () => {
    const b = bundle({ pages: [page({ id: 'a', path: 'dup' }), page({ id: 'b', path: 'dup' })] });
    expect(() => allRoutes(b)).toThrow(/Duplicate/);
  });
});

describe('collectionRoutes', () => {
  it('expands a collection page once per published entry, nested under its parent', () => {
    const blog = page({ id: 'blog', path: 'blog' });
    const posts = page({
      id: 'post',
      path: '[slug]',
      parent: 'blog',
      collection: { dataset: 'posts', param: 'slug' },
    });
    const entries: Entry[] = [
      { id: 'p1', dataset: 'posts', status: 'published', values: { slug: 'first' } },
      { id: 'p2', dataset: 'posts', status: 'published', values: { slug: 'second' } },
      { id: 'p3', dataset: 'posts', status: 'draft', values: { slug: 'hidden' } },
    ];
    const routes = collectionRoutes(bundle({ pages: [blog, posts], entries }));
    expect(routes.map((r) => r.slug).sort()).toEqual(['blog/first', 'blog/second']);
    expect(routes.every((r) => r.entry)).toBe(true);
  });
});
