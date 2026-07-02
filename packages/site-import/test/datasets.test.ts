import { describe, expect, it } from 'vitest';
import { validateTemplate } from '@sitewright/blocks';
import { inferDatasets, uniquifyEntryIds } from '../src/transform/datasets.js';
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

function infer(html: string, usedEntryIds: Set<string> = new Set<string>()) {
  const doc = parse(html);
  const inf = inferDatasets(doc, ctx, new Set<string>(), usedEntryIds, '@@D_');
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

  it('field-izes a clickable card ROOT link + a (lazy) BACKGROUND image (not baked static)', () => {
    // Burmeister-style tiles: <a href data-background-image> with an inner title — the link AND the bg live
    // on the card ROOT, which the descendant walk never sees. Without root capture both bake static (every
    // tile the same link + image).
    const tile = (i: number) => `<a href="/s${i}" data-background-image="/bg${i}.jpg" class="tile"><div class="overlay"><div class="h6">Service ${i}</div></div></a>`;
    const html = `<html><body><h2>Our Services</h2><section class="grid">${Array.from({ length: 4 }, (_, i) => tile(i)).join('')}</section></body></html>`;
    const { inf } = infer(html);
    expect(inf.datasets).toHaveLength(1);
    const types = inf.datasets[0]!.fields.map((f) => `${f.name}:${f.type}`);
    expect(types).toContain('link:text'); // root href → link field
    expect(types).toContain('image:image'); // root background → image field
    expect(new Set(inf.entries.map((e) => e.values.link)).size).toBe(4); // DISTINCT per-tile links
    expect(new Set(inf.entries.map((e) => e.values.image)).size).toBe(4); // DISTINCT per-tile backgrounds
    const loop = [...inf.markers.values()][0]!.loop;
    expect(loop).toContain('data-sw-bg="{{sw-url image}}"'); // bg bound via the directive (validator-safe)
    expect(loop).toContain('href="{{sw-url link}}"');
    expect(loop).not.toMatch(/style="[^"]*background-image/); // NOT baked into an inline style
    expect(() => validateTemplate(loop)).not.toThrow();
  });

  it('captures a card text block (leading text + inline span) as ONE field — no first-card text baked across the grid', () => {
    // Regression: burmeister directors read "<p>Name <span>role</span></p>"; dropping the leading text and
    // field-izing only the span baked the FIRST card's name into every card ("Mr. Ronald L. Kubas <name>").
    const cards = [0, 1, 2, 3].map((i) => `<div class="card"><img src="/a.jpg"><p>Person ${i} <span>(role ${i})</span></p></div>`).join('');
    const { inf } = infer(`<html><body><h2>Team</h2><section class="team">${cards}</section></body></html>`);
    expect(inf.datasets).toHaveLength(1);
    expect(inf.entries.map((e) => e.values.title)).toEqual(['Person 0 (role 0)', 'Person 1 (role 1)', 'Person 2 (role 2)', 'Person 3 (role 3)']);
  });

  it('turns a uniform card grid into a dataset + entries + an {{#each}} loop', () => {
    const { inf, doc } = infer(grid(4));
    expect(inf.datasets).toHaveLength(1);
    const ds = inf.datasets[0]!;
    expect(ds.slug).toBe('ourteam'); // from the preceding <h2>, hyphenless
    expect(ds.name).toBe('Our Team'); // display name = the real heading text (not "Ourteam")
    expect(ds.fields.map((f) => `${f.name}:${f.type}`)).toEqual(['image:image', 'title:text', 'description:text', 'link:text']);
    expect(inf.entries).toHaveLength(4);
    expect(inf.entries[0]!.values).toEqual({ image: '/media/x/a.jpg', title: 'Name 0', description: 'Role 0', link: '/p0' });
    expect(inf.entries[0]!.id).toBe('name_0'); // item key = underscore identifier from the title value, un-prefixed (was 'ourteam-name-0')
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

  it('does NOT dataset-ify a JS carousel/slider (it needs its literal DOM + script)', () => {
    const slides = Array.from({ length: 4 }, (_, i) => `<div class="slide"><img src="/a.jpg"><h3>S${i}</h3></div>`).join('');
    const inf = inferDatasets(parse(`<html><body><div class="slider owl-carousel">${slides}</div></body></html>`), ctx, new Set<string>(), new Set<string>(), '@@D_');
    expect(inf.datasets).toHaveLength(0); // left literal, not turned into {{#each}}
  });

  it('falls back to "items" + a heading-less container, and keeps slugs unique', () => {
    const used = new Set<string>();
    const doc = parse(`<html><body><section class="x">${Array.from({ length: 4 }, (_, i) => `<article><h3>P${i}</h3><p>B${i}</p></article>`).join('')}</section><section class="y">${Array.from({ length: 4 }, (_, i) => `<article><h3>Q${i}</h3><p>C${i}</p></article>`).join('')}</section></body></html>`);
    const inf = inferDatasets(doc, ctx, used, new Set<string>(), '@@D_');
    expect(inf.datasets.map((d) => d.slug)).toEqual(['x', 'y']); // class-derived, unique
  });

  it('keeps entry ids unique ACROSS datasets/pages via the shared used-id set (no bundle-invalid collision)', () => {
    // Regression: the SAME content repeated on two pages (e.g. a service grid on `/` and `/services/`)
    // inferred two datasets whose entries collided on the same bare id — entries are stored under a
    // project-global `(projectId,'entry',entityId)` key, so the duplicate failed referential integrity and
    // aborted the whole import. The bundle-wide used-id set must suffix the repeats.
    const shared = new Set<string>();
    const a = infer(grid(4), shared).inf; // first page
    const b = infer(grid(4), shared).inf; // second page, SAME titles → same base ids
    const aIds = a.entries.map((e) => e.id);
    const bIds = b.entries.map((e) => e.id);
    expect(aIds).toEqual(['name_0', 'name_1', 'name_2', 'name_3']);
    expect(bIds).toEqual(aIds.map((id) => `${id}_2`)); // suffixed, not colliding
    const allIds = [...aIds, ...bIds];
    expect(new Set(allIds).size).toBe(allIds.length); // globally unique
  });
});

describe('uniquifyEntryIds', () => {
  it('re-keys entry ids that collide across datasets (bundle-wide uniqueness)', () => {
    // Two datasets (e.g. a nav folded on multiple pages) whose rows produce the same title-derived ids.
    const entries = [
      { id: 'consultancy', dataset: 'nav' },
      { id: 'investments', dataset: 'nav' },
      { id: 'row_1', dataset: 'nav' },
      { id: 'consultancy', dataset: 'nav_2' }, // collides with nav's
      { id: 'row_1', dataset: 'other' }, // collides with nav's row_1
      { id: 'gallery', dataset: 'nav_2' },
    ];
    uniquifyEntryIds(entries);
    expect(entries.map((e) => e.id)).toEqual(['consultancy', 'investments', 'row_1', 'consultancy_2', 'row_1_2', 'gallery']);
    // every id is now unique
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it('is a no-op when ids are already unique', () => {
    const entries = [{ id: 'a', dataset: 'd' }, { id: 'b', dataset: 'd' }];
    uniquifyEntryIds(entries);
    expect(entries.map((e) => e.id)).toEqual(['a', 'b']);
  });
});
