import { describe, it, expect } from 'vitest';
import { summarizeContentItem, summarizeContentList, kindHasSummary } from '../src/repo/content-summary.js';

describe('summarizeContentItem', () => {
  it('keeps metadata and describes the omitted page body', () => {
    const page = {
      id: 'about',
      path: 'about',
      title: 'About',
      status: 'published',
      nav: { title: 'About', slots: ['header'] },
      source: '<h1>hello</h1>',
      data: { swImport: { sourceUrl: 'https://x.test/' }, heading: 'About', body: 'lots of text' },
    };
    const out = summarizeContentItem('page', page) as Record<string, unknown>;
    // everything an agent needs to PLAN survives…
    expect(out.id).toBe('about');
    expect(out.path).toBe('about');
    expect(out.title).toBe('About');
    expect(out.status).toBe('published');
    expect(out.nav).toEqual(page.nav);
    // …and the two heavy fields are gone, described instead
    expect(out.source).toBeUndefined();
    expect(out.data).toBeUndefined();
    expect(out._summary).toEqual({
      omitted: { source: { bytes: 14 }, data: { keys: ['swImport', 'heading', 'body'] } },
      hint: expect.stringContaining('get_page'),
    });
  });

  it('measures source in BYTES, not characters (multi-byte content is what actually blows the limit)', () => {
    const out = summarizeContentItem('template', { id: 't', source: '€€€' }) as { _summary: { omitted: { source: { bytes: number } } } };
    expect(out._summary.omitted.source.bytes).toBe(9); // 3 × 3-byte euro sign
  });

  it('omits the descriptor entirely when the heavy field is absent', () => {
    const out = summarizeContentItem('page', { id: 'link', path: '', title: 'Link', kind: 'link' }) as Record<string, unknown>;
    expect(out._summary).toBeUndefined();
    expect(out).toEqual({ id: 'link', path: '', title: 'Link', kind: 'link' });
  });

  it('describes arrays by length and scalars by presence', () => {
    const entry = summarizeContentItem('entry', { id: 'e', dataset: 'team', values: { name: 'A', role: 'B' } }) as { _summary: { omitted: Record<string, unknown> } };
    expect(entry._summary.omitted).toEqual({ values: { keys: ['name', 'role'] } });
    const tr = summarizeContentItem('translation', { id: 'tr', entries: [1, 2, 3] }) as { _summary: { omitted: Record<string, unknown> } };
    expect(tr._summary.omitted).toEqual({ entries: { items: 3 } });
  });

  it('passes through kinds with no heavy body, and non-objects, untouched', () => {
    expect(kindHasSummary('dataset')).toBe(false);
    expect(kindHasSummary('page')).toBe(true);
    const ds = { id: 'team', name: 'Team', fields: [{ key: 'name' }] };
    expect(summarizeContentItem('dataset', ds)).toBe(ds);
    expect(summarizeContentItem('page', null)).toBeNull();
    expect(summarizeContentItem('page', 'nope')).toBe('nope');
  });

  it('is a big win on a realistic imported list', () => {
    // The case that motivated this: 22 pages each carrying ~12 KB of Handlebars source.
    const pages = Array.from({ length: 22 }, (_, i) => ({
      id: `p${i}`,
      path: `p${i}`,
      title: `Page ${i}`,
      source: 'x'.repeat(12_000),
      data: { swImport: { sourceUrl: 'https://x.test/' } },
    }));
    const full = JSON.stringify(pages).length;
    const summarised = JSON.stringify(summarizeContentList('page', pages)).length;
    expect(full).toBeGreaterThan(250_000);
    expect(summarised).toBeLessThan(5_000);
  });
});
