import { describe, it, expect } from 'vitest';
import {
  classifyControlTarget,
  controlCurrentValue,
  controlOptions,
  normalizeControlAs,
  isControlAs,
  parseSelectOptions,
  CONTROL_AS_VALUES,
} from '../src/control.js';
import { renderTemplate } from '../src/template.js';

describe('classifyControlTarget', () => {
  it('accepts the 3 whitelisted page targets', () => {
    expect(classifyControlTarget('page.title')).toEqual({ kind: 'page', field: 'title' });
    expect(classifyControlTarget('page.image')).toEqual({ kind: 'page', field: 'image' });
    expect(classifyControlTarget('page.description')).toEqual({ kind: 'page', field: 'description' });
  });
  it('accepts page.data keys (bare top-level + nested page.data.<path>)', () => {
    expect(classifyControlTarget('gallery_folder')).toEqual({ kind: 'data', key: 'gallery_folder' });
    expect(classifyControlTarget('page.data.article.title')).toEqual({ kind: 'data', key: 'page.data.article.title' });
  });
  it('rejects the RETIRED data.<path> shorthand — page.data.<path> is required now', () => {
    expect(classifyControlTarget('data.article.title')).toBeNull();
    expect(classifyControlTarget('data.gallery_folder')).toBeNull();
  });
  it('rejects proto / empty / non-string', () => {
    expect(classifyControlTarget('__proto__')).toBeNull();
    expect(classifyControlTarget('page.data.__proto__.x')).toBeNull();
    expect(classifyControlTarget('page.data.')).toBeNull();
    expect(classifyControlTarget('')).toBeNull();
    expect(classifyControlTarget(undefined)).toBeNull();
  });
  it('reserves the page. namespace — only the 3 whitelisted page fields are settable', () => {
    for (const t of ['page.path', 'page.status', 'page.template', 'page.parent', 'page.canonical', 'page.noindex']) {
      expect(classifyControlTarget(t)).toBeNull();
    }
  });
  it('rejects the RETIRED seo. namespace (flattened onto the page)', () => {
    for (const t of ['seo.ogImage', 'seo.description', 'seo.canonical', 'seo.noindex', 'seo.title']) {
      expect(classifyControlTarget(t)).toBeNull();
    }
  });
  it('classifies website.data.<path> as the GLOBAL website kind (key = path WITHIN website.data)', () => {
    expect(classifyControlTarget('website.data.footerImage')).toEqual({ kind: 'website', key: 'footerImage' });
    expect(classifyControlTarget('website.data.hero.bg')).toEqual({ kind: 'website', key: 'hero.bg' });
  });
  it('rejects a non-data website.* target and a proto-polluting website.data path', () => {
    expect(classifyControlTarget('website.siteUrl')).toBeNull(); // settings field, not free-form data
    expect(classifyControlTarget('website.data')).toBeNull(); // no leaf path
    expect(classifyControlTarget('website.data.')).toBeNull();
    expect(classifyControlTarget('website.data.__proto__.x')).toBeNull();
  });
});

describe('normalizeControlAs', () => {
  it('keeps known values, defaults the rest to text', () => {
    expect(normalizeControlAs('folder')).toBe('folder');
    expect(normalizeControlAs('image')).toBe('image');
    expect(normalizeControlAs('file')).toBe('file');
    expect(normalizeControlAs('bogus')).toBe('text');
    expect(normalizeControlAs(undefined)).toBe('text');
  });
  it('keeps the newly-added typed inputs', () => {
    for (const as of ['number', 'color', 'date', 'select'] as const) expect(normalizeControlAs(as)).toBe(as);
  });
});

describe('isControlAs', () => {
  it('accepts every CONTROL_AS_VALUES member and rejects everything else', () => {
    for (const as of CONTROL_AS_VALUES) expect(isControlAs(as)).toBe(true);
    for (const bad of ['bogus', 'checkbox', 'radio', 'datetime-local', '', undefined, null, 7, {}]) {
      expect(isControlAs(bad)).toBe(false);
    }
  });
});

describe('parseSelectOptions', () => {
  it('splits, trims, drops empties + dedupes', () => {
    expect(parseSelectOptions('Draft, Published ,Archived')).toEqual(['Draft', 'Published', 'Archived']);
    expect(parseSelectOptions('a,,b, ,a')).toEqual(['a', 'b']);
  });
  it('returns [] for non-strings / blank input', () => {
    expect(parseSelectOptions(undefined)).toEqual([]);
    expect(parseSelectOptions(123)).toEqual([]);
    expect(parseSelectOptions('  , , ')).toEqual([]);
  });
  it('caps the option count', () => {
    const many = Array.from({ length: 250 }, (_, i) => `o${i}`).join(',');
    expect(parseSelectOptions(many)).toHaveLength(100);
  });
});

describe('controlCurrentValue', () => {
  const root = {
    page: { title: 'Home', image: '/og.jpg', description: 'desc', data: { gallery_folder: 'photos', article: { title: 'A' } } },
  };
  it('reads page fields / data leaves', () => {
    expect(controlCurrentValue({ kind: 'page', field: 'title' }, root)).toBe('Home');
    expect(controlCurrentValue({ kind: 'page', field: 'image' }, root)).toBe('/og.jpg');
    expect(controlCurrentValue({ kind: 'page', field: 'description' }, root)).toBe('desc');
    expect(controlCurrentValue({ kind: 'data', key: 'gallery_folder' }, root)).toBe('photos');
    expect(controlCurrentValue({ kind: 'data', key: 'page.data.article.title' }, root)).toBe('A');
    expect(controlCurrentValue({ kind: 'data', key: 'missing' }, root)).toBe('');
  });
  it('reads a GLOBAL website.data leaf for the website kind (key = path WITHIN website.data)', () => {
    const r = { website: { data: { footerImage: '/footer.png', hero: { bg: '/bg.jpg' } } } };
    expect(controlCurrentValue({ kind: 'website', key: 'footerImage' }, r)).toBe('/footer.png');
    expect(controlCurrentValue({ kind: 'website', key: 'hero.bg' }, r)).toBe('/bg.jpg');
    expect(controlCurrentValue({ kind: 'website', key: 'missing' }, r)).toBe('');
  });
});

describe('controlOptions', () => {
  const root = {
    media: [
      { folder: 'photos', kind: 'image' as const, filename: 'a', url: '/x' },
      { folder: 'docs', kind: 'file' as const, filename: 'b', url: '/y' },
      { folder: '', kind: 'image' as const, filename: 'c', url: '/z' },
    ],
    dataset: { posts: [], team: [] },
  };
  it('folder options from media (root skipped, sorted); dataset options from dataset keys', () => {
    expect(controlOptions('folder', root)).toEqual(['docs', 'photos']);
    expect(controlOptions('dataset', root)).toEqual(['posts', 'team']);
    expect(controlOptions('text', root)).toEqual([]);
  });
  it('dataset-item options are the entry IDS of the named dataset (order preserved)', () => {
    const r = { dataset: { hero: [{ id: 'config', values: {} }, { id: 'minimal', values: {} }] } };
    expect(controlOptions('dataset-item', r, 'hero')).toEqual(['config', 'minimal']);
    expect(controlOptions('dataset-item', r, 'missing')).toEqual([]); // unknown dataset → empty
    expect(controlOptions('dataset-item', r)).toEqual([]); // no dataset arg → empty
  });
});

describe('{{sw-control}} render', () => {
  it('renders a chip in PREVIEW with the target + current value', () => {
    const out = renderTemplate('{{sw-control target="page.title" label="Title"}}', { page: { title: 'Home' }, preview: true });
    expect(out).toContain('data-sw-control="page.title"');
    expect(out).toContain('data-sw-control-as="text"');
    expect(out).toContain('Title: Home');
  });
  it('is STRIPPED entirely on publish (no marker in the output)', () => {
    const out = renderTemplate('<div>{{sw-control target="page.title"}}</div>', { page: { title: 'Home' } });
    expect(out).toBe('<div></div>');
  });
  it('embeds folder options for as="folder"', () => {
    const out = renderTemplate('{{sw-control target="gallery_folder" as="folder"}}', {
      page: { data: { gallery_folder: 'photos' } },
      media: [
        { folder: 'photos', kind: 'image', filename: 'a', url: '/x' },
        { folder: 'team', kind: 'image', filename: 'b', url: '/y' },
      ],
      preview: true,
    });
    expect(out).toContain('data-sw-control-as="folder"');
    expect(out).toContain('data-sw-control-options=');
    expect(out).toContain('photos');
  });
  it('renders nothing for a non-whitelisted target', () => {
    expect(renderTemplate('{{sw-control target="page.path"}}', { preview: true })).toBe('');
  });

  it('embeds a dataset\'s entry ids as options for as="dataset-item"', () => {
    const out = renderTemplate('{{sw-control target="page.data.hero_config" as="dataset-item" dataset="hero" label="Hero config"}}', {
      page: { data: { hero_config: 'minimal' } },
      dataset: { hero: [{ id: 'config', values: {} }, { id: 'minimal', values: {} }] },
      preview: true,
    });
    expect(out).toContain('data-sw-control-as="dataset-item"');
    expect(out).toContain('config');
    expect(out).toContain('minimal');
    expect(out).toContain('Hero config: minimal'); // current value shown
  });

  it('emits the typed inputs (number/color/date) verbatim in data-sw-control-as', () => {
    for (const as of ['number', 'color', 'date'] as const) {
      const out = renderTemplate(`{{sw-control target="page.data.v" as="${as}"}}`, { page: { data: { v: '' } }, preview: true });
      expect(out).toContain(`data-sw-control-as="${as}"`);
    }
  });

  it('embeds the author options for as="select"', () => {
    const out = renderTemplate('{{sw-control target="page.data.status" as="select" options="Draft, Published, Archived" label="Status"}}', {
      page: { data: { status: 'Published' } },
      preview: true,
    });
    expect(out).toContain('data-sw-control-as="select"');
    expect(out).toContain('data-sw-control-options=');
    // The options survive HTML-attr escaping of the JSON array.
    expect(out).toContain('Draft');
    expect(out).toContain('Published');
    expect(out).toContain('Archived');
  });

  it('THROWS (fails loud) on an unknown `as` instead of degrading to text', () => {
    expect(() => renderTemplate('{{sw-control target="page.title" as="checkbox"}}', { page: { title: 'x' }, preview: true })).toThrow(
      /unknown as="checkbox"/,
    );
  });

  it('THROWS for as="select" with no options (a select with no choices is useless)', () => {
    expect(() => renderTemplate('{{sw-control target="page.data.status" as="select"}}', { page: { data: {} }, preview: true })).toThrow(
      /select.*requires.*options/i,
    );
  });

  it('still defaults to text when `as` is omitted (no throw)', () => {
    const out = renderTemplate('{{sw-control target="page.title"}}', { page: { title: 'Home' }, preview: true });
    expect(out).toContain('data-sw-control-as="text"');
  });
});
