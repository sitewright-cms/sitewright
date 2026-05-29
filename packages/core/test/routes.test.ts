import { describe, expect, it } from 'vitest';
import type { Entry, Page } from '@sitewright/schema';
import type { ProjectBundle } from '../src/validate.js';
import {
  allRoutes,
  collectionRoutes,
  datasetEntries,
  entrySlug,
  pathToSlug,
  resolvedPages,
} from '../src/routes.js';

function page(partial: Partial<Page> & { id: string; path: string }): Page {
  return {
    title: partial.id,
    root: { id: `${partial.id}-root`, type: 'Section' },
    ...partial,
  } as Page;
}

function bundle(over: Partial<ProjectBundle> = {}): ProjectBundle {
  return {
    project: {
      id: 'p',
      name: 'P',
      slug: 'p',
      brand: { name: 'P', colors: {} },
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
});

describe('resolvedPages / allRoutes', () => {
  it('returns static page routes', () => {
    const b = bundle({ pages: [page({ id: 'home', path: '/' }), page({ id: 'about', path: '/about' })] });
    expect(resolvedPages(b)).toHaveLength(2);
    expect(allRoutes(b).map((r) => r.slug)).toEqual([undefined, 'about']);
  });

  it('throws on duplicate routes', () => {
    const b = bundle({ pages: [page({ id: 'a', path: '/dup' }), page({ id: 'b', path: '/dup' })] });
    expect(() => allRoutes(b)).toThrow(/Duplicate/);
  });
});

describe('collectionRoutes', () => {
  it('expands a collection page once per published entry', () => {
    const posts = page({
      id: 'post',
      path: '/blog/[slug]',
      collection: { dataset: 'posts', param: 'slug' },
    });
    const entries: Entry[] = [
      { id: 'p1', dataset: 'posts', status: 'published', values: { slug: 'first' } },
      { id: 'p2', dataset: 'posts', status: 'published', values: { slug: 'second' } },
      { id: 'p3', dataset: 'posts', status: 'draft', values: { slug: 'hidden' } },
    ];
    const routes = collectionRoutes(bundle({ pages: [posts], entries }));
    expect(routes.map((r) => r.slug).sort()).toEqual(['blog/first', 'blog/second']);
    expect(routes.every((r) => r.entry)).toBe(true);
  });
});
