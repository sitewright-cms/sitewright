import { describe, expect, it } from 'vitest';
import { collectFontFaces } from '../src/transform/fonts.js';

describe('collectFontFaces', () => {
  it('parses @font-face family/weight/style and picks the best-format url', () => {
    const css = `@font-face{font-family:"Heebo";font-weight:700;font-style:italic;src:url(https://ex.com/heebo.woff) format('woff'),url(https://ex.com/heebo.woff2) format('woff2')}`;
    const refs = collectFontFaces(css);
    expect(refs.size).toBe(1);
    const a = [...refs.values()][0]!;
    expect(a.kind).toBe('font');
    expect(a.remoteUrl).toBe('https://ex.com/heebo.woff2'); // woff2 preferred over woff
    expect(a.font).toEqual({ family: 'Heebo', weight: 700, style: 'italic' });
  });

  it('defaults weight 400 / style normal, maps bold/normal keywords', () => {
    const refs = collectFontFaces('@font-face{font-family:Open Sans;src:url(https://ex.com/o.ttf)}');
    expect([...refs.values()][0]!.font).toEqual({ family: 'Open Sans', weight: 400, style: 'normal' });
    const bold = collectFontFaces('@font-face{font-family:X;font-weight:bold;src:url(https://ex.com/x.otf)}');
    expect([...bold.values()][0]!.font!.weight).toBe(700);
  });

  it('ignores a @font-face with no absolute font-file url, and dedupes by url', () => {
    expect(collectFontFaces('@font-face{font-family:X;src:local("X")}').size).toBe(0);
    expect(collectFontFaces('@font-face{font-family:X;src:url(/rel.woff2)}').size).toBe(0); // not absolute
    const dup = '@font-face{font-family:A;src:url(https://ex.com/f.woff2)}@font-face{font-family:B;src:url(https://ex.com/f.woff2)}';
    expect(collectFontFaces(dup).size).toBe(1);
  });
});
