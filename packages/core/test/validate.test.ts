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

  it('does not flag duplicate_page_path for multiple slugless link placeholders (ids still checked)', () => {
    const bundle = validBundle();
    const stub: Page['root'] = { id: 'r', type: 'Section' };
    bundle.pages = [
      page('home', '', stub),
      page('l1', '', stub, { kind: 'link', link: { target: 'https://a.test' }, nav: { slots: ['header'] } }),
      page('l2', '', stub, { kind: 'link', link: { target: 'https://b.test' }, nav: { slots: ['header'] } }),
    ];
    expect(codes(bundle)).not.toContain('duplicate_page_path');
    // Their ids are still uniqueness-checked (a second 'l1' link trips duplicate_page_id).
    bundle.pages = [...bundle.pages, page('l1', '', stub, { kind: 'link', link: { target: '#x' }, nav: { slots: ['header'] } })];
    expect(codes(bundle)).toContain('duplicate_page_id');
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

  it('flags duplicate page ids, page paths, and dataset slugs', () => {
    const bundle = validBundle();
    bundle.pages = [
      page('dup', '/same', { id: 'r1', type: 'Section' }),
      page('dup', '/same', { id: 'r2', type: 'Section' }),
    ];
    bundle.datasets = [products, { ...products, id: 'd2' }];
    const result = codes(bundle);
    expect(result).toContain('duplicate_page_id');
    expect(result).toContain('duplicate_page_path');
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
});
