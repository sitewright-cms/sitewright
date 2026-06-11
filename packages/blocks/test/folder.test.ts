import { describe, it, expect } from 'vitest';
import { selectFolderAssets, projectFolderItem, mediaForRender, type RenderMedia } from '../src/folder.js';
import { renderTemplate } from '../src/template.js';
import type { MediaAsset } from '@sitewright/schema';

const img = (folder: string, filename: string, extra: Partial<RenderMedia> = {}): RenderMedia => ({
  folder,
  filename,
  kind: 'image',
  url: `/media/p/${filename}/x.jpg`,
  alt: '',
  width: 100,
  height: 80,
  ...extra,
});
const file = (folder: string, filename: string): RenderMedia => ({
  folder,
  filename,
  kind: 'file',
  url: `/media/p/${filename}/file/x.pdf`,
});

const media: RenderMedia[] = [
  img('photos', 'b.jpg'),
  img('photos', 'a.jpg'),
  img('photos/2024', 'c.jpg'),
  file('photos', 'doc.pdf'),
  img('', 'root.jpg'),
];

describe('selectFolderAssets', () => {
  it('selects images in the EXACT folder, sorted by name (non-recursive, images by default)', () => {
    expect(selectFolderAssets(media, 'photos').map((a) => a.filename)).toEqual(['a.jpg', 'b.jpg']);
  });
  it('trims slashes and matches subfolder paths verbatim', () => {
    expect(selectFolderAssets(media, '/photos/2024/').map((a) => a.filename)).toEqual(['c.jpg']);
  });
  it('recursive includes descendants', () => {
    expect(selectFolderAssets(media, 'photos', { recursive: true }).map((a) => a.filename)).toEqual([
      'a.jpg',
      'b.jpg',
      'c.jpg',
    ]);
  });
  it('kind=file selects files; kind=all includes both (fonts excluded)', () => {
    expect(selectFolderAssets(media, 'photos', { kind: 'file' }).map((a) => a.filename)).toEqual(['doc.pdf']);
    expect(selectFolderAssets(media, 'photos', { kind: 'all' }).map((a) => a.filename)).toEqual([
      'a.jpg',
      'b.jpg',
      'doc.pdf',
    ]);
  });
  it('sort=name-desc reverses', () => {
    expect(selectFolderAssets(media, 'photos', { sort: 'name-desc' }).map((a) => a.filename)).toEqual([
      'b.jpg',
      'a.jpg',
    ]);
  });
  it('empty / non-string path → the media root', () => {
    expect(selectFolderAssets(media, '').map((a) => a.filename)).toEqual(['root.jpg']);
    expect(selectFolderAssets(media, undefined).map((a) => a.filename)).toEqual(['root.jpg']);
  });
});

describe('projectFolderItem', () => {
  it('exposes url/filename/kind/alt(+width/height for images); alt defaults to ""', () => {
    expect(projectFolderItem(img('photos', 'a.jpg', { alt: 'Hi' }))).toEqual({
      url: '/media/p/a.jpg/x.jpg',
      filename: 'a.jpg',
      kind: 'image',
      alt: 'Hi',
      width: 100,
      height: 80,
    });
    expect(projectFolderItem(file('docs', 'd.pdf'))).toEqual({
      url: '/media/p/d.pdf/file/x.pdf',
      filename: 'd.pdf',
      kind: 'file',
      alt: '',
    });
  });
});

describe('mediaForRender', () => {
  it('slims a MediaAsset → RenderMedia (drops placeholder/variants/bytes)', () => {
    const asset = {
      kind: 'image',
      id: 'i1',
      filename: 'a.jpg',
      folder: 'photos',
      bytes: 999,
      alt: 'A',
      format: 'jpeg',
      width: 10,
      height: 8,
      placeholder: 'data:image/x',
      variants: [],
      fallback: 'a-10.jpg',
      url: '/media/p/i1/a-10.jpg',
    } as unknown as MediaAsset;
    expect(mediaForRender([asset])).toEqual([
      { folder: 'photos', kind: 'image', filename: 'a.jpg', url: '/media/p/i1/a-10.jpg', alt: 'A', width: 10, height: 8 },
    ]);
  });
});

describe('{{#sw-folder}} render', () => {
  const gallery: RenderMedia[] = [img('photos', 'a.jpg', { alt: 'Alpha' }), img('photos', 'b.jpg', { alt: 'Beta' })];

  it('iterates images in a folder, exposing url/alt + @index/@first', () => {
    const out = renderTemplate(
      '<ul>{{#sw-folder "photos"}}<li class="{{#if @first}}first{{/if}}">{{@index}}:{{alt}}:{{url}}</li>{{/sw-folder}}</ul>',
      { media: gallery },
    );
    expect(out).toContain('<li class="first">0:Alpha:/media/p/a.jpg/x.jpg</li>');
    expect(out).toContain('<li class="">1:Beta:/media/p/b.jpg/x.jpg</li>');
  });
  it('sets @last on the final iteration only', () => {
    expect(renderTemplate('{{#sw-folder "photos"}}{{#if @last}}LAST:{{filename}}{{/if}}{{/sw-folder}}', { media: gallery })).toBe(
      'LAST:b.jpg',
    );
  });
  it('renders {{else}} for an empty folder', () => {
    expect(renderTemplate('{{#sw-folder "empty"}}<img>{{else}}<p>No files</p>{{/sw-folder}}', { media: gallery })).toContain(
      '<p>No files</p>',
    );
  });
  it('resolves a VARIABLE folder argument (page.data.*); src binds via {{sw-url}} (validator rule)', () => {
    const out = renderTemplate('{{#sw-folder page.data.gallery}}<img src="{{sw-url url}}">{{/sw-folder}}', {
      media: gallery,
      page: { data: { gallery: 'photos' } },
    });
    expect(out).toContain('<img src="/media/p/a.jpg/x.jpg">');
    expect(out).toContain('<img src="/media/p/b.jpg/x.jpg">');
  });
  it('no media on the context → {{else}}', () => {
    expect(renderTemplate('{{#sw-folder "photos"}}x{{else}}none{{/sw-folder}}', {})).toContain('none');
  });
});
