import { describe, it, expect } from 'vitest';
import { buildSwImage, resolveRenderImage, mediaAssetId, filenameAlt } from '../src/image-helper.js';
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

describe('mediaAssetId', () => {
  it('extracts the id from the legacy 3-segment shape (full segment, hyphenated uuids included)', () => {
    expect(mediaAssetId('/media/acme/a1/photo.jpg')).toBe('a1');
    expect(mediaAssetId('/media/acme/a1/photo.jpg?size=lg')).toBe('a1');
    expect(mediaAssetId('/media/acme/3f8a1c2e-9b4d-4e6a/photo.jpg')).toBe('3f8a1c2e-9b4d-4e6a'); // legacy uuid
    expect(mediaAssetId('/media/acme/uuid/file/report.pdf')).toBe('uuid'); // legacy /file/ variant
  });
  it('extracts the id from the flat shape (run before the first hyphen), even with a hyphenated name', () => {
    expect(mediaAssetId('/media/acme/aB3xY9-photo.jpg')).toBe('aB3xY9');
    expect(mediaAssetId('/media/acme/aB3xY9-my-report.jpg')).toBe('aB3xY9'); // hyphen in the logical name
    expect(mediaAssetId('/media/acme/aB3xY9-Inter-400.woff2?size=lg')).toBe('aB3xY9'); // query ignored
  });
  it('returns undefined for a non-media / malformed url', () => {
    expect(mediaAssetId('https://cdn.example/x.jpg')).toBeUndefined();
    expect(mediaAssetId('/media/acme')).toBeUndefined(); // no file segment
    expect(mediaAssetId('/media/acme/nodash.jpg')).toBeUndefined(); // flat needs a hyphen
  });
});

describe('filenameAlt', () => {
  it('strips a single trailing extension, keeping dots inside the name', () => {
    expect(filenameAlt('photo.jpg')).toBe('photo');
    expect(filenameAlt('my.cool.photo.png')).toBe('my.cool.photo');
    expect(filenameAlt('Team photo 2024')).toBe('Team photo 2024'); // no extension → unchanged
    expect(filenameAlt('.htaccess')).toBe('.htaccess'); // leading dot is not an extension
  });
});

describe('resolveRenderImage', () => {
  it('resolves by exact url and by the id segment (legacy shape)', () => {
    expect(resolveRenderImage('/media/acme/a1/photo.jpg', [img])?.id).toBe('a1');
    // a delivery url with a size query still resolves via the id segment
    expect(resolveRenderImage('/media/acme/a1/photo.jpg?size=lg', [img])?.id).toBe('a1');
    expect(resolveRenderImage('/media/acme/unknown/x.jpg', [img])).toBeUndefined();
  });
  it('resolves a FLAT delivery url by exact match and by the id (with a size query)', () => {
    const flat: RenderMedia = { ...img, id: 'aB3xY9', url: '/media/acme/aB3xY9-photo.jpg' };
    expect(resolveRenderImage('/media/acme/aB3xY9-photo.jpg', [flat])?.id).toBe('aB3xY9');
    expect(resolveRenderImage('/media/acme/aB3xY9-photo.jpg?size=lg', [flat])?.id).toBe('aB3xY9');
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

  it('an image with ALPHA gets no blur-up placeholder', () => {
    // The LQIP is a background-image painted BEHIND the <img>, which only works because an opaque
    // photo covers it. On transparent art it shows THROUGH as a permanent coloured wash — a clone
    // hit this on every illustration on a page (a pink/grey box around a cut-out logo, a map, a
    // watch) and abandoned {{sw-image}} entirely to escape it.
    const cutout: RenderMedia = { ...img, hasAlpha: true };
    const html = buildSwImage(cutout.url, [cutout]);
    expect(html).not.toContain('background-image');
    // …everything else about the image is unchanged — this suppresses the wash, not the feature.
    expect(html).toContain('width="2000" height="1000"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('?size=xl 2000w');

    // and an OPAQUE image still gets it: the condition is the pipeline's recorded alpha flag, not
    // the file extension, so an opaque .png keeps its placeholder and a transparent .webp loses it.
    expect(buildSwImage(img.url, [img])).toContain('background-image');
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

  it('marks an eager image high priority by default (LCP hint)', () => {
    const html = buildSwImage(img.url, [img], { loading: 'eager' });
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchpriority="high"');
  });

  it('gives a lazy image no fetchpriority', () => {
    expect(buildSwImage(img.url, [img])).not.toContain('fetchpriority');
  });

  it('lets an explicit fetchpriority override the eager default', () => {
    expect(buildSwImage(img.url, [img], { loading: 'eager', fetchpriority: 'low' })).toContain('fetchpriority="low"');
  });

  it('emits nothing for fetchpriority="auto" (browser default)', () => {
    expect(buildSwImage(img.url, [img], { loading: 'eager', fetchpriority: 'auto' })).not.toContain('fetchpriority');
  });

  it('degrades an external/unresolved url to a plain lazy <img> (no srcset/dims)', () => {
    const html = buildSwImage('https://cdn.example.com/x.jpg', [img], { alt: 'ext' });
    expect(html).toBe('<img src="https://cdn.example.com/x.jpg" alt="ext" loading="lazy" decoding="async">');
  });

  it('neutralizes an unsafe url (safeUrl collapses javascript: to "#")', () => {
    expect(buildSwImage('javascript:alert(1)', [img])).toBe('<img src="#" alt="" loading="lazy" decoding="async">');
  });

  it('falls back to the display FILENAME (extension stripped) for alt when the asset has none', () => {
    const noAlt: RenderMedia = { ...img, alt: undefined, filename: 'Team photo 2024.jpg' };
    const html = buildSwImage(noAlt.url, [noAlt]);
    expect(html).toContain('alt="Team photo 2024"'); // extension dropped, name preserved
  });

  it('respects an explicit EMPTY alt (decorative) over the filename fallback', () => {
    const noAlt: RenderMedia = { ...img, alt: undefined, filename: 'hero.jpg' };
    // An intentional empty alt must survive — the nullish fallback only fires for undefined.
    expect(buildSwImage(noAlt.url, [noAlt], { alt: '' })).toContain('alt=""');
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

describe('{{sw-image lightbox=true}} — gallery item markup', () => {
  const media = [
    { id: 'aB3xY9', kind: 'image', url: '/media/acme/aB3xY9-lake.jpg', filename: 'lake.jpg', width: 3000, height: 2000 },
  ] as unknown as Parameters<typeof buildSwImage>[1];

  it('wraps the thumbnail in an anchor pointing at the LARGEST variant', () => {
    const html = buildSwImage('/media/acme/aB3xY9-lake.jpg', media, {
      lightbox: true,
      sizes: '(min-width:640px) 33vw, 100vw',
    });
    // The anchor opens full detail…
    expect(html).toMatch(/^<a href="\/media\/acme\/aB3xY9-lake\.jpg\?size=xl"/);
    expect(html).toContain('data-full="/media/acme/aB3xY9-lake.jpg?size=xl"');
    // …while the <img> keeps its own responsive rungs, so the GRID paints small files.
    expect(html).toContain('?size=sm 500w');
    expect(html).toContain('sizes="(min-width:640px) 33vw, 100vw"');
    expect(html).toContain('</a>');
  });

  it('records the xl reference at RENDER time, which is what makes the file exist', () => {
    // Publish materializes only the `?size=` variants something references. A runtime "swap the href
    // up to xl" would link a file the build never generated — a 404 on the deployed site. Emitting
    // the href here puts xl in the referenced set.
    const html = buildSwImage('/media/acme/aB3xY9-lake.jpg', media, { lightbox: true });
    expect(html).toContain('size=xl');
  });

  it('never upscales: the href tops out at the SOURCE width for a small image', () => {
    const small = [
      { id: 'sm1', kind: 'image', url: '/media/acme/sm1-icon.png', filename: 'icon.png', width: 420, height: 420 },
    ] as unknown as Parameters<typeof buildSwImage>[1];
    const html = buildSwImage('/media/acme/sm1-icon.png', small, { lightbox: true });
    expect(html).toContain('?size=sm"'); // sm (500) already covers a 420px source
    expect(html).not.toContain('size=xl');
  });

  it('carries a caption through to the viewer', () => {
    const html = buildSwImage('/media/acme/aB3xY9-lake.jpg', media, { lightbox: true, caption: 'Lake at dawn' });
    expect(html).toContain('data-caption="Lake at dawn"');
  });

  it('escapes a caption rather than trusting it', () => {
    const html = buildSwImage('/media/acme/aB3xY9-lake.jpg', media, { lightbox: true, caption: '"><img onerror=x>' });
    expect(html).not.toContain('"><img onerror');
    expect(html).toContain('&quot;');
  });

  it('emits no anchor at all without the flag (default stays a bare <img>)', () => {
    const html = buildSwImage('/media/acme/aB3xY9-lake.jpg', media, {});
    expect(html).not.toContain('<a href');
  });
});
