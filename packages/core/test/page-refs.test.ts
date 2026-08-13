import { describe, it, expect } from 'vitest';
import type { Dataset, Entry, Page } from '@sitewright/schema';
import { hasPageField, resolveDatasetPageRefs } from '../src/page-refs.js';

/**
 * A `page` field stores an ID and READS as the page. These pin both halves of that trade: the id is
 * what survives a rename/move (so the resolution has to be by id, at render time), and a template that
 * gets handed the raw id can do nothing with it.
 */

const page = (id: string, title: string, path: string, parent?: string, extra: Partial<Page> = {}): Page =>
  ({ id, title, path, ...(parent ? { parent } : {}), status: 'published', ...extra }) as Page;

const PAGES: Page[] = [
  page('home', 'Home', ''),
  page('svc', 'Services', 'services', 'home'),
  page('web', 'Web design', 'web-design', 'svc', { description: 'We design', image: '/hero.jpg' }),
];

const field = (name: string, type: string, fields?: unknown): unknown => ({ name, type, required: false, localized: false, ...(fields ? { fields } : {}) });
const ds = (slug: string, fields: unknown[]): Dataset => ({ id: slug, name: slug, slug, fields } as Dataset);
const entry = (id: string, dataset: string, values: Record<string, unknown>): Entry =>
  ({ id, dataset, status: 'published', values }) as Entry;

describe('hasPageField', () => {
  it('finds a page field at any depth, and says no for an ordinary dataset', () => {
    expect(hasPageField([field('t', 'text')] as never)).toBe(false);
    expect(hasPageField([field('t', 'text'), field('p', 'page')] as never)).toBe(true);
    expect(hasPageField([field('g', 'object', [field('p', 'page')])] as never)).toBe(true);
    expect(hasPageField([field('l', 'list', [field('g', 'object', [field('p', 'page')])])] as never)).toBe(true);
    expect(hasPageField(undefined)).toBe(false);
  });
});

describe('resolveDatasetPageRefs', () => {
  const schemas = [ds('promos', [field('label', 'text'), field('target', 'page')])];

  it('swaps the stored id for the page’s attributes, with the FULL parent-chain route', () => {
    const out = resolveDatasetPageRefs({ promos: [entry('a', 'promos', { label: 'Our work', target: 'web' })] }, schemas, PAGES, 'en');
    expect(out.promos![0]!.values).toEqual({
      label: 'Our work',
      // The path is computed from the parent chain — a template links with {{sw-url target.path}} and
      // must get `/services/web-design`, not the bare slug the page row stores.
      target: { id: 'web', title: 'Web design', slug: 'web-design', path: '/services/web-design', locale: 'en', description: 'We design', image: '/hero.jpg' },
    });
  });

  it('reads as EMPTY when the id resolves to nothing — never the raw id', () => {
    // A deleted (or unpublished) page should leave a blank in the output, not a link to a 404 and not a
    // stray `pg_7f3a` in the copy. The publish path passes only PUBLISHED pages, so this is the normal
    // case for a reference to a draft, not an edge case.
    const out = resolveDatasetPageRefs({ promos: [entry('a', 'promos', { label: 'Gone', target: 'deleted' })] }, schemas, PAGES, 'en');
    expect(out.promos![0]!.values.target).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('deleted');
  });

  it('resolves inside object groups and list items', () => {
    const nested = [ds('blocks', [field('group', 'object', [field('link', 'page')]), field('items', 'list', [field('to', 'page')])])];
    const out = resolveDatasetPageRefs(
      { blocks: [entry('a', 'blocks', { group: { link: 'svc' }, items: [{ to: 'web' }, { to: 'home' }] })] },
      nested,
      PAGES,
      'en',
    );
    const v = out.blocks![0]!.values as { group: { link: { path: string } }; items: { to: { path: string } }[] };
    expect(v.group.link.path).toBe('/services');
    expect(v.items.map((i) => i.to.path)).toEqual(['/services/web-design', '/']);
  });

  it('returns the SAME object when no dataset declares a page field', () => {
    // The gate that keeps the overwhelming majority of projects from being walked or copied at all.
    const datasets = { promos: [entry('a', 'promos', { label: 'x' })] };
    expect(resolveDatasetPageRefs(datasets, [ds('promos', [field('label', 'text')])], PAGES, 'en')).toBe(datasets);
  });

  it('applies a base dataset’s schema to its LOCALE variants', () => {
    // `services_de` is a separate entity that may carry no schema row of its own; the fields are the
    // base dataset's. Without the fallback a translated page's loop would print raw ids.
    const out = resolveDatasetPageRefs({ promos_de: [entry('a', 'promos_de', { target: 'web' })] }, schemas, PAGES, 'en');
    expect((out.promos_de![0]!.values.target as { path: string }).path).toBe('/services/web-design');
  });

  it('leaves every other field untouched', () => {
    const out = resolveDatasetPageRefs(
      { promos: [entry('a', 'promos', { label: 'keep', target: 'web', extra: 42 })] },
      schemas,
      PAGES,
      'en',
    );
    expect(out.promos![0]!.values.label).toBe('keep');
    expect(out.promos![0]!.values.extra).toBe(42);
    expect(out.promos![0]!.id).toBe('a'); // the envelope survives — id/dataset/status are how a row is addressed
    expect(out.promos![0]!.status).toBe('published');
  });
});
