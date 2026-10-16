import { describe, it, expect } from 'vitest';
import type { FontAsset } from '@sitewright/schema';
import { typographyCss } from '@sitewright/blocks';
import { correctFontMetadata } from '../src/fonts/asset.js';

/**
 * Correcting what an upload GUESSED about a font. A dropped `Inter-Bold.woff2` is recorded as family
 * "Inter-Bold", weight 400 — the filename stem and a default — and until this nothing could fix it:
 * the font could not be replaced (a family is many files) and the PATCH took only folder/filename.
 * The renderer reads family, fallback and every face's weight/style straight off the asset, so a
 * corrected record is all typography needs.
 */

const single = (over: Partial<FontAsset> = {}): FontAsset => ({
  kind: 'font',
  id: 'f1',
  filename: 'Inter-Bold',
  folder: '',
  bytes: 10,
  family: 'Inter-Bold',
  fallback: 'sans-serif',
  source: 'local',
  files: [{ weight: 400, style: 'normal', format: 'woff2', file: 'inter-bold-400.woff2' }],
  url: '/media/site/f1-inter-bold-400.woff2',
  ...over,
});

const family = (): FontAsset =>
  single({
    filename: 'Inter',
    family: 'Inter',
    files: [
      { weight: 400, style: 'normal', format: 'woff2', file: 'inter-400.woff2' },
      { weight: 700, style: 'normal', format: 'woff2', file: 'inter-700.woff2' },
    ],
  });

describe('correctFontMetadata', () => {
  it('fixes a single-face upload: family, fallback, weight and style — files and URL untouched', () => {
    const res = correctFontMetadata(single(), { family: 'Inter', fallback: 'serif', weight: 700, style: 'italic' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.asset).toMatchObject({ family: 'Inter', fallback: 'serif' });
    // The stored FILE NAME keeps its old weight on purpose: it is part of the served URL, and a
    // criticalCss `url()` pointing at it must not break because the metadata was corrected.
    expect(res.asset.files).toEqual([{ weight: 700, style: 'italic', format: 'woff2', file: 'inter-bold-400.woff2' }]);
    expect(res.asset.url).toBe('/media/site/f1-inter-bold-400.woff2');
  });

  it('keeps the display name in step with the family when it was named after it', () => {
    const res = correctFontMetadata(single(), { family: 'Inter' });
    expect(res.ok && res.asset.filename).toBe('Inter');
  });

  it('leaves a display name someone chose alone', () => {
    const res = correctFontMetadata(single({ filename: 'Brand body face' }), { family: 'Inter' });
    expect(res.ok && res.asset.filename).toBe('Brand body face');
  });

  it('a multi-face family needs `face` to say WHICH file a weight describes', () => {
    const res = correctFontMetadata(family(), { weight: 600 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/2 faces/);
    expect(res.error).toContain('inter-700.woff2');
  });

  it('with `face`, corrects exactly that file', () => {
    const res = correctFontMetadata(family(), { face: 'inter-700.woff2', weight: 800 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.asset.files.map((f) => f.weight)).toEqual([400, 800]);
  });

  it('names the faces when `face` matches none of them', () => {
    const res = correctFontMetadata(family(), { face: 'inter-900.woff2', weight: 900 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/no face "inter-900.woff2"/);
    expect(res.error).toContain('inter-400.woff2');
  });

  it('refuses to give two faces the same weight and style', () => {
    const res = correctFontMetadata(family(), { face: 'inter-700.woff2', weight: 400 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/already/);
  });

  it('keeps a VARIABLE face\'s default weight on its own axis', () => {
    const variable = single({ files: [{ weight: 400, weightRange: [300, 700], style: 'normal', format: 'woff2', file: 'dm-400.woff2' }] });
    expect(correctFontMetadata(variable, { weight: 600 }).ok).toBe(true);
    const off = correctFontMetadata(variable, { weight: 900 });
    expect(off.ok).toBe(false);
    if (off.ok) return;
    expect(off.error).toMatch(/300.700/);
  });

  it('family/fallback alone never needs a face — they describe the whole family', () => {
    const res = correctFontMetadata(family(), { fallback: 'serif' });
    expect(res.ok && res.asset.fallback).toBe('serif');
  });

  it('★ the typography the site renders picks the correction up — nothing else to re-point', () => {
    // A slot references the asset by id; family, fallback and each face's weight come off the asset at
    // render time. So the corrected record is the whole fix: no slot or stylesheet has to change.
    const res = correctFontMetadata(single(), { family: 'Inter', weight: 700 });
    if (!res.ok) throw new Error(res.error);
    const css = typographyCss(
      { fontFamilies: {}, body: { source: 'asset', family: 'Inter-Bold', weight: 700, assetId: 'f1' } },
      [res.asset],
      { fontUrl: (id, file) => `/media/site/${id}-${file}` },
    );
    expect(css).toContain('@font-face{font-family:"Inter";font-style:normal;font-weight:700;');
    expect(css).toContain('src:url(/media/site/f1-inter-bold-400.woff2)');
    expect(css).toContain('--sw-font-body:"Inter", sans-serif');
  });
});
