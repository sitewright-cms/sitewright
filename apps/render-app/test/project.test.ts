import { describe, it, expect } from 'vitest';
import { datasetEntries, loadBundle, pathToSlug, resolvedPages } from '../src/lib/project.js';
import { knownBlockTypes, isKnownBlockType } from '../src/blocks/registry.js';

describe('sample project loading', () => {
  const bundle = loadBundle();

  it('loads and validates the sample project (no integrity issues)', () => {
    expect(bundle.project.name).toBe('Northwind Studio');
    expect(bundle.pages.map((p) => p.id).sort()).toEqual(['about', 'home']);
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
