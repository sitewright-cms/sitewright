import { describe, it, expect } from 'vitest';
import { buildSwImage, resolveRenderImage } from '../src/image-helper.js';
import { renderTemplate } from '../src/template.js';
import type { RenderMedia } from '../src/folder.js';

const img: RenderMedia = {
  id: 'a1',
  folder: '',
  kind: 'image',
  filename: 'photo.jpg',
  url: '/media/acme/a1/photo.jpg',
  alt: 'A photo',
  width: 2000,
  height: 1000,
  placeholder: 'data:image/webp;base64,AAAA',
};

describe('resolveRenderImage', () => {
  it('resolves by exact url and by the id segment', () => {
    expect(resolveRenderImage('/media/acme/a1/photo.jpg', [img])?.id).toBe('a1');
    // a delivery url with a size query still resolves via the id segment
    expect(resolveRenderImage('/media/acme/a1/photo.jpg?size=lg', [img])?.id).toBe('a1');
    expect(resolveRenderImage('/media/acme/unknown/x.jpg', [img])).toBeUndefined();
  });
});

describe('buildSwImage', () => {
  it('emits a responsive <img> with a WebP srcset, dims, LQIP, and lazy loading', () => {
    const html = buildSwImage('/media/acme/a1/photo.jpg', [img]);
    expect(html.startsWith('<img')).toBe(true);
    expect(html).not.toContain('<picture');
    // src is the top rung (xl, server-clamped to the 2000px source).
    expect(html).toContain('src="/media/acme/a1/photo.jpg?size=xl"');
    // rungs sm/md/lg (< source) plus xl (reaches source) with the CLAMPED descriptor (2000, not 2400).
    expect(html).toContain('/media/acme/a1/photo.jpg?size=sm 500w');
    expect(html).toContain('/media/acme/a1/photo.jpg?size=md 1000w');
    expect(html).toContain('/media/acme/a1/photo.jpg?size=lg 1600w');
    expect(html).toContain('/media/acme/a1/photo.jpg?size=xl 2000w');
    // dims (no CLS), alt, lazy, LQIP.
    expect(html).toContain('width="2000" height="1000"');
    expect(html).toContain('alt="A photo"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("background-image:url('data:image/webp;base64,AAAA')");
    // WebP srcset carries no query entity (no &format=) since WebP is the server default.
    expect(html).not.toContain('&format');
  });

  it('never upscales: a tiny source emits only the smallest reachable rung, clamped', () => {
    const small: RenderMedia = { ...img, width: 400, height: 300, placeholder: undefined };
    const html = buildSwImage(small.url, [small]);
    expect(html).toContain('src="/media/acme/a1/photo.jpg?size=sm"');
    expect(html).toContain('?size=sm 400w'); // descriptor clamped to the 400px source, not 500
    expect(html).not.toContain('?size=md');
  });

  it('emits a <picture> with an AVIF tier above WebP when format=avif', () => {
    const html = buildSwImage(img.url, [img], { format: 'avif' });
    expect(html.startsWith('<picture>')).toBe(true);
    expect(html).toContain('<source type="image/avif" srcset="/media/acme/a1/photo.jpg?size=sm&format=avif 500w');
    expect(html).toContain('<source type="image/webp" srcset="/media/acme/a1/photo.jpg?size=sm 500w');
    expect(html).toContain('</picture>');
  });

  it('honours alt/class/sizes/loading overrides', () => {
    const html = buildSwImage(img.url, [img], { alt: 'Hero', className: 'w-full rounded', sizes: '(min-width:768px) 50vw, 100vw', loading: 'eager' });
    expect(html).toContain('alt="Hero"');
    expect(html).toContain('class="w-full rounded"');
    expect(html).toContain('sizes="(min-width:768px) 50vw, 100vw"');
    expect(html).toContain('loading="eager"');
  });

  it('degrades an external/unresolved url to a plain lazy <img> (no srcset/dims)', () => {
    const html = buildSwImage('https://cdn.example.com/x.jpg', [img], { alt: 'ext' });
    expect(html).toBe('<img src="https://cdn.example.com/x.jpg" alt="ext" loading="lazy" decoding="async">');
  });

  it('neutralizes an unsafe url (safeUrl collapses javascript: to "#")', () => {
    expect(buildSwImage('javascript:alert(1)', [img])).toBe('<img src="#" alt="" loading="lazy" decoding="async">');
  });

  it('emits a PLAIN <img> for an SVG (vector) — no srcset/?size, keeps intrinsic dims', () => {
    const svg: RenderMedia = { id: 's1', folder: '', kind: 'image', filename: 'logo.svg', url: '/media/acme/s1/logo.svg', alt: 'Logo', width: 300, height: 120 };
    const html = buildSwImage(svg.url, [svg]);
    expect(html).toBe('<img src="/media/acme/s1/logo.svg" alt="Logo" width="300" height="120" loading="lazy" decoding="async">');
    expect(html).not.toContain('srcset');
    expect(html).not.toContain('?size=');
    expect(html).not.toContain('<picture');
  });
});

describe('{{sw-image}} via renderTemplate', () => {
  it('resolves the asset from context media (srcset) and honours the site-wide imageAvif flag', () => {
    const src = '{{sw-image "/media/acme/a1/photo.jpg" alt="t"}}';
    // WebP (default): a single <img> with a resolved srcset (proves root.media reaches the helper).
    const webp = renderTemplate(src, { media: [img] });
    expect(webp.startsWith('<img')).toBe(true);
    expect(webp).toContain('srcset=');
    // Site-wide AVIF: imageAvif in the render context must reach the helper as root.imageAvif → <picture>.
    const avif = renderTemplate(src, { media: [img], imageAvif: true });
    expect(avif.startsWith('<picture>')).toBe(true);
    expect(avif).toContain('type="image/avif"');
  });
});
