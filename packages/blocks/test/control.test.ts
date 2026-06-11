import { describe, it, expect } from 'vitest';
import { classifyControlTarget, controlCurrentValue, controlOptions, normalizeControlAs } from '../src/control.js';
import { renderTemplate } from '../src/template.js';

describe('classifyControlTarget', () => {
  it('accepts the 3 whitelisted page targets', () => {
    expect(classifyControlTarget('page.title')).toEqual({ kind: 'page', field: 'title' });
    expect(classifyControlTarget('page.image')).toEqual({ kind: 'page', field: 'image' });
    expect(classifyControlTarget('page.description')).toEqual({ kind: 'page', field: 'description' });
  });
  it('accepts page.data keys (bare + data.<path>)', () => {
    expect(classifyControlTarget('gallery_folder')).toEqual({ kind: 'data', key: 'gallery_folder' });
    expect(classifyControlTarget('data.article.title')).toEqual({ kind: 'data', key: 'data.article.title' });
  });
  it('rejects proto / empty / non-string', () => {
    expect(classifyControlTarget('__proto__')).toBeNull();
    expect(classifyControlTarget('data.__proto__.x')).toBeNull();
    expect(classifyControlTarget('data.')).toBeNull();
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
});

describe('normalizeControlAs', () => {
  it('keeps known values, defaults the rest to text', () => {
    expect(normalizeControlAs('folder')).toBe('folder');
    expect(normalizeControlAs('image')).toBe('image');
    expect(normalizeControlAs('file')).toBe('file');
    expect(normalizeControlAs('bogus')).toBe('text');
    expect(normalizeControlAs(undefined)).toBe('text');
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
    expect(controlCurrentValue({ kind: 'data', key: 'data.article.title' }, root)).toBe('A');
    expect(controlCurrentValue({ kind: 'data', key: 'missing' }, root)).toBe('');
  });
});

describe('controlOptions', () => {
  const root = {
    media: [
      { folder: 'photos', kind: 'image' as const, filename: 'a', url: '/x' },
      { folder: 'docs', kind: 'file' as const, filename: 'b', url: '/y' },
      { folder: '', kind: 'image' as const, filename: 'c', url: '/z' },
    ],
    data: { posts: [], team: [] },
  };
  it('folder options from media (root skipped, sorted); dataset options from data keys', () => {
    expect(controlOptions('folder', root)).toEqual(['docs', 'photos']);
    expect(controlOptions('dataset', root)).toEqual(['posts', 'team']);
    expect(controlOptions('text', root)).toEqual([]);
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
});
