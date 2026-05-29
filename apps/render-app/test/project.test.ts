import { describe, it, expect } from 'vitest';
import type { Entry, Page, Project } from '@sitewright/schema';
import type { ProjectBundle } from '@sitewright/core';
import {
  allRoutes,
  collectionRoutes,
  datasetEntries,
  entrySlug,
  loadBundle,
  pathToSlug,
  resolvedPages,
} from '../src/lib/project.js';
import { knownBlockTypes, isKnownBlockType } from '../src/blocks/registry.js';

function entry(values: Record<string, unknown>, id = 'e1'): Entry {
  return { id, dataset: 'd', status: 'published', values };
}

const PROJECT: Project = {
  formatVersion: 1,
  id: 'p',
  name: 'P',
  slug: 'p',
  brand: { name: 'P', colors: {} },
  settings: { defaultLocale: 'en', locales: ['en'] },
};

const COLLECTION_PAGE: Page = {
  id: 'post',
  path: '/posts/[slug]',
  title: 'Post',
  root: { id: 'r', type: 'Section' },
  collection: { dataset: 'posts', param: 'slug' },
};

function postsBundle(entries: Entry[]): ProjectBundle {
  return {
    project: PROJECT,
    pages: [COLLECTION_PAGE],
    partials: [],
    datasets: [{ id: 'd', name: 'Posts', slug: 'posts', fields: [] }],
    entries,
  };
}

describe('sample project loading', () => {
  const bundle = loadBundle();

  it('loads and validates the sample project (no integrity issues)', () => {
    expect(bundle.project.name).toBe('Northwind Studio');
    expect(bundle.pages.map((p) => p.id).sort()).toEqual(['about', 'feature-detail', 'home']);
    expect(bundle.partials.map((p) => p.id).sort()).toEqual(['site-footer', 'site-header']);
    expect(bundle.datasets.map((d) => d.slug)).toEqual(['features']);
    expect(bundle.entries.length).toBe(4); // 3 published + 1 draft
  });

  it('expands partials on resolved pages (no partialRef remains)', () => {
    const home = resolvedPages(bundle).find((p) => p.page.id === 'home');
    const header = home?.root.children?.[0];
    expect(header?.id).toBe('hdr-slot'); // host id preserved
    expect(header?.type).toBe('Header'); // expanded from the partial
    expect(header?.partialRef).toBeUndefined();
  });

  it('groups dataset entries by slug', () => {
    expect(datasetEntries(bundle).features?.length).toBe(4);
  });

  it('expands a collection page into one route per published entry', () => {
    const routes = collectionRoutes(bundle);
    expect(routes.map((r) => r.slug).sort()).toEqual([
      'features/built-in-cms',
      'features/reusable-partials',
      'features/static-first-output',
    ]);
    // draft entry excluded
    expect(routes.some((r) => r.slug === 'features/draft-feature')).toBe(false);
    // each route carries its bound entry
    expect(routes.every((r) => r.entry !== undefined)).toBe(true);
  });

  it('allRoutes includes static pages and collection routes', () => {
    const slugs = allRoutes(bundle).map((r) => r.slug);
    expect(slugs).toContain(undefined); // home "/"
    expect(slugs).toContain('about');
    expect(slugs).toContain('features/built-in-cms');
  });
});

describe('entrySlug (path-traversal safe)', () => {
  it('uses a safe slug field value', () => {
    expect(entrySlug(entry({ slug: 'my-post' }), 'slug')).toBe('my-post');
  });

  it('falls back to the entry id for unsafe slug values', () => {
    expect(entrySlug(entry({ slug: '../../etc/passwd' }, 'safe-id'), 'slug')).toBe('safe-id');
    expect(entrySlug(entry({ slug: 'Has Spaces' }, 'safe-id'), 'slug')).toBe('safe-id');
    expect(entrySlug(entry({}, 'safe-id'), 'slug')).toBe('safe-id');
  });

  it('falls back to the entry id for an over-long slug', () => {
    expect(entrySlug(entry({ slug: 'a'.repeat(200) }, 'safe-id'), 'slug')).toBe('safe-id');
  });
});

describe('allRoutes / collectionRoutes edge cases', () => {
  it('throws on two entries that resolve to the same slug', () => {
    const bundle = postsBundle([
      { id: 'a', dataset: 'posts', status: 'published', values: { slug: 'dup' } },
      { id: 'b', dataset: 'posts', status: 'published', values: { slug: 'dup' } },
    ]);
    expect(() => allRoutes(bundle)).toThrow(/Duplicate route/);
  });

  it('generates no routes when every entry is a draft', () => {
    const bundle = postsBundle([
      { id: 'a', dataset: 'posts', status: 'draft', values: { slug: 'x' } },
    ]);
    expect(collectionRoutes(bundle)).toEqual([]);
  });

  it('preserves the collection page metadata on each route', () => {
    const bundle = postsBundle([
      { id: 'a', dataset: 'posts', status: 'published', values: { slug: 'hello' } },
    ]);
    const [route] = collectionRoutes(bundle);
    expect(route?.slug).toBe('posts/hello');
    expect(route?.page.collection?.dataset).toBe('posts');
  });
});

describe('pathToSlug', () => {
  it('maps "/" to undefined and "/about" to "about"', () => {
    expect(pathToSlug('/')).toBeUndefined();
    expect(pathToSlug('/about')).toBe('about');
    expect(pathToSlug('/blog/post/')).toBe('blog/post');
  });
});

describe('block registry', () => {
  it('registers the expected block types', () => {
    expect(knownBlockTypes).toContain('Hero');
    expect(knownBlockTypes).toContain('Grid');
    expect(isKnownBlockType('Section')).toBe(true);
    expect(isKnownBlockType('Nope')).toBe(false);
  });
});
