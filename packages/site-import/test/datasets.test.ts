import { describe, expect, it } from 'vitest';
import { validateTemplate } from '@sitewright/blocks';
import { inferDatasets } from '../src/transform/datasets.js';
import { getBody, serialize, parse } from '../src/dom.js';
import { DEFAULT_LIMITS } from '../src/limits.js';
import type { TransformCtx } from '../src/transform/page.js';

const ctx: TransformCtx = {
  pageUrl: 'https://ex.com/team',
  siteBase: 'https://ex.com/',
  internalRoutes: new Map(),
  assetMap: new Map([['https://ex.com/a.jpg', '/media/x/a.jpg']]),
  limits: DEFAULT_LIMITS,
};

const card = (i: number): string => `<div class="card"><img src="/a.jpg"><h3>Name ${i}</h3><p>Role ${i}</p><a href="/p${i}">Profile</a></div>`;
const grid = (n: number, heading = '<h2>Our Team</h2>'): string =>
  `<html><body>${heading}<section class="team">${Array.from({ length: n }, (_, i) => card(i)).join('')}</section></body></html>`;

function infer(html: string) {
  const doc = parse(html);
  const inf = inferDatasets(doc, ctx, new Set<string>(), '@@D_');
  return { inf, doc };
}

describe('inferDatasets', () => {
  it('reads a lazy-loaded (data-src) image into the entry value, not an empty string', () => {
    // A carousel of logos where the real URL is in data-src (the loader script is stripped on import).
    const cards = Array.from({ length: 4 }, () => '<div class="logo"><img src="data:image/gif;base64,PLACEHOLDER" data-src="/a.jpg"></div>').join('');
    const { inf } = infer(`<html><body><section class="partners">${cards}</section></body></html>`);
    expect(inf.entries).toHaveLength(4);
    expect(inf.entries.every((e) => e.values.image === '/media/x/a.jpg')).toBe(true); // hosted ref, not ''
  });

  it('turns a uniform card grid into a dataset + entries + an {{#each}} loop', () => {
    const { inf, doc } = infer(grid(4));
    expect(inf.datasets).toHaveLength(1);
    const ds = inf.datasets[0]!;
    expect(ds.slug).toBe('ourteam'); // from the preceding <h2>, hyphenless
    expect(ds.fields.map((f) => `${f.name}:${f.type}`)).toEqual(['image:image', 'title:text', 'text:text', 'link:text']);
    expect(inf.entries).toHaveLength(4);
    expect(inf.entries[0]!.values).toEqual({ image: '/media/x/a.jpg', title: 'Name 0', text: 'Role 0', link: '/p0' });
    expect(inf.entries[0]!.dataset).toBe('ourteam');
    expect(inf.entries[0]!.status).toBe('published');

    // The grid's children were replaced by the sentinel; the loop is valid Handlebars.
    const loop = [...inf.markers.values()][0]!.loop;
    expect(loop).toContain('{{#each dataset.ourteam}}');
    expect(loop).toContain('{{title}}');
    expect(loop).toContain('src="{{sw-url image}}"');
    expect(loop).toContain('href="{{sw-url link}}"');
    expect(() => validateTemplate(loop)).not.toThrow();
    // The doc now holds the marker (not the 4 cards).
    expect(serialize(getBody(doc)!.children)).toContain([...inf.markers.keys()][0]);
  });

  it('does not infer a dataset below the minimum child count', () => {
    expect(infer(grid(3)).inf.datasets).toHaveLength(0);
  });

  it('skips a non-uniform grid (different child structures)', () => {
    const mixed = '<html><body><section>' + card(0) + card(1) + '<div class="card"><h3>Only text</h3></div>' + card(3) + '</section></body></html>';
    expect(infer(mixed).inf.datasets).toHaveLength(0);
  });

  it('falls back to "items" + a heading-less container, and keeps slugs unique', () => {
    const used = new Set<string>();
    const doc = parse(`<html><body><section class="x">${Array.from({ length: 4 }, (_, i) => `<article><h3>P${i}</h3><p>B${i}</p></article>`).join('')}</section><section class="y">${Array.from({ length: 4 }, (_, i) => `<article><h3>Q${i}</h3><p>C${i}</p></article>`).join('')}</section></body></html>`);
    const inf = inferDatasets(doc, ctx, used, '@@D_');
    expect(inf.datasets.map((d) => d.slug)).toEqual(['x', 'y']); // class-derived, unique
  });
});
