import { describe, expect, it } from 'vitest';
import { fontFaceCss } from '../src/views/settings/FontSlotEditor';
import type { MediaAsset } from '../src/api';

type FontAsset = Extract<MediaAsset, { kind: 'font' }>;

const font = (over: Partial<FontAsset> = {}): FontAsset =>
  ({
    kind: 'font',
    id: 'TYbf4C',
    filename: 'primary-font',
    folder: '',
    bytes: 34500,
    family: 'primary-font',
    fallback: 'sans-serif',
    source: 'local',
    files: [{ weight: 400, style: 'normal', format: 'woff', file: 'primary-font-400.woff' }],
    url: '/media/skeleta/TYbf4C-primary-font-400.woff',
    ...over,
  }) as FontAsset;

describe('fontFaceCss', () => {
  it('keeps the `<id>-` on a FLAT media url (cutting at the last slash 404s every face)', () => {
    expect(fontFaceCss(font())).toContain('src:url("/media/skeleta/TYbf4C-primary-font-400.woff")');
  });

  it('addresses every face off the primary face’s prefix, not just the first', () => {
    const css = fontFaceCss(
      font({
        files: [
          { weight: 400, style: 'normal', format: 'woff2', file: 'inter-400.woff2' },
          { weight: 700, style: 'normal', format: 'woff2', file: 'inter-700.woff2' },
          { weight: 400, style: 'italic', format: 'woff2', file: 'inter-400i.woff2' },
        ],
        url: '/media/skeleta/AbC123-inter-400.woff2',
      }),
    );
    expect(css).toContain('src:url("/media/skeleta/AbC123-inter-400.woff2")');
    expect(css).toContain('src:url("/media/skeleta/AbC123-inter-700.woff2")');
    expect(css).toContain('font-style:italic;font-weight:400');
    expect(css.match(/@font-face/g)).toHaveLength(3);
  });

  it('still resolves a LEGACY nested url', () => {
    const css = fontFaceCss(
      font({ id: 'a1b2c3d4e5f6g7h8', url: '/media/skeleta/a1b2c3d4e5f6g7h8/primary-font-400.woff' }),
    );
    expect(css).toContain('src:url("/media/skeleta/a1b2c3d4e5f6g7h8/primary-font-400.woff")');
  });

  it('names the face after the ASSET family and hints the stored format', () => {
    const css = fontFaceCss(font({ family: 'Montserrat', files: [{ weight: 200, style: 'normal', format: 'ttf', file: 'm-200.ttf' }], url: '/media/x/Qoof8Y-m-200.ttf' }));
    expect(css).toContain('font-family:"Montserrat"');
    expect(css).toContain('format("truetype")');
  });

  it('emits nothing rather than a guessed url when the url does not end in the primary face', () => {
    expect(fontFaceCss(font({ url: '/media/skeleta/TYbf4C-renamed.woff' }))).toBe('');
    expect(fontFaceCss(font({ files: [] }))).toBe('');
  });
});
