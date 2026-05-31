import { describe, it, expect } from 'vitest';
import type { Dataset, Page, Project } from '@sitewright/schema';
import { validateProject, type ProjectBundle } from '../src/index.js';

const project: Project = {
  formatVersion: 2,
  id: 'p1',
  name: 'Acme',
  slug: 'acme',
  identity: { name: 'Acme', colors: {} },
  settings: { defaultLocale: 'en', locales: ['en'] },
};

const products: Dataset = { id: 'd1', name: 'Products', slug: 'products', fields: [] };

function page(id: string, path: string, root: Page['root'], extra: Partial<Page> = {}): Page {
  return { id, path, title: id, root, ...extra };
}

function validBundle(): ProjectBundle {
  return {
    project,
    datasets: [products],
    partials: [{ id: 'header', name: 'Header', root: { id: 'h', type: 'Header' } }],
    entries: [{ id: 'e1', dataset: 'products', status: 'published', values: {} }],
    pages: [
      page('home', '/', {
        id: 'r',
        type: 'Section',
        children: [
          { id: 'slot', type: 'Slot', partialRef: 'header' },
          { id: 'list', type: 'Grid', binding: { dataset: 'products', mode: 'list' } },
        ],
      }),
      page(
        'product',
        '/products/[slug]',
        { id: 'pr', type: 'Section' },
        { collection: { dataset: 'products', param: 'slug' } },
      ),
    ],
  };
}

const codes = (bundle: ProjectBundle): string[] =>
  validateProject(bundle).map((issue) => issue.code);

describe('validateProject', () => {
  it('returns no issues for a valid project', () => {
    expect(validateProject(validBundle())).toEqual([]);
  });

  it('flags an unknown partial reference', () => {
    const bundle = validBundle();
    bundle.pages = [page('home', '/', { id: 'r', type: 'Slot', partialRef: 'ghost' })];
    expect(codes(bundle)).toContain('unknown_partial');
  });

  it('flags a binding to an unknown dataset', () => {
    const bundle = validBundle();
    bundle.pages = [
      page('home', '/', { id: 'r', type: 'Grid', binding: { dataset: 'ghost', mode: 'list' } }),
    ];
    expect(codes(bundle)).toContain('unknown_binding_dataset');
  });

  it('flags a collection page bound to an unknown dataset', () => {
    const bundle = validBundle();
    bundle.pages = [
      page('p', '/x/[slug]', { id: 'r', type: 'Section' }, {
        collection: { dataset: 'ghost', param: 'slug' },
      }),
    ];
    expect(codes(bundle)).toContain('unknown_collection_dataset');
  });

  it('flags an entry referencing an unknown dataset', () => {
    const bundle = validBundle();
    bundle.entries = [{ id: 'x', dataset: 'ghost', status: 'draft', values: {} }];
    expect(codes(bundle)).toContain('unknown_dataset');
  });

  it('flags duplicate entry ids', () => {
    const bundle = validBundle();
    bundle.entries = [
      { id: 'dup', dataset: 'products', status: 'published', values: {} },
      { id: 'dup', dataset: 'products', status: 'published', values: {} },
    ];
    expect(codes(bundle)).toContain('duplicate_entry_id');
  });

  it('flags duplicate page ids, page paths, partial ids, and dataset slugs', () => {
    const bundle = validBundle();
    bundle.pages = [
      page('dup', '/same', { id: 'r1', type: 'Section' }),
      page('dup', '/same', { id: 'r2', type: 'Section' }),
    ];
    bundle.partials = [
      { id: 'pp', name: 'A', root: { id: 'a', type: 'X' } },
      { id: 'pp', name: 'B', root: { id: 'b', type: 'Y' } },
    ];
    bundle.datasets = [products, { ...products, id: 'd2' }];
    const result = codes(bundle);
    expect(result).toContain('duplicate_page_id');
    expect(result).toContain('duplicate_page_path');
    expect(result).toContain('duplicate_partial_id');
    expect(result).toContain('duplicate_dataset_slug');
  });

  it('flags duplicate node ids within a page', () => {
    const bundle = validBundle();
    bundle.pages = [
      page('home', '/', {
        id: 'r',
        type: 'Section',
        children: [
          { id: 'dupe', type: 'A' },
          { id: 'dupe', type: 'B' },
        ],
      }),
    ];
    expect(codes(bundle)).toContain('duplicate_node_id');
  });

  it('flags an unknown partial referenced from within another partial', () => {
    const bundle = validBundle();
    bundle.partials = [
      { id: 'header', name: 'Header', root: { id: 'h', type: 'Slot', partialRef: 'ghost' } },
    ];
    expect(codes(bundle)).toContain('unknown_partial');
  });
});
