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

  // REGRESSION: a VARIABLE face declares an AXIS (`font-weight:300 700`) and this used to keep only the
  // first number. The stored file then claimed to be a static 300, so the renderer synthesised faux-bold
  // headings and skipped the face's preload entirely.
  it('captures a variable face weight RANGE, defaulting the file weight to 400 inside it', () => {
    const refs = collectFontFaces('@font-face{font-family:"DM Sans";font-weight:300 700;src:url(https://ex.com/dm.woff2)}');
    expect([...refs.values()][0]!.font).toEqual({ family: 'DM Sans', weight: 400, weightRange: [300, 700], style: 'normal' });
  });

  it('snaps a range to real CSS weights and keeps a single weight when it cannot', () => {
    // the common "full axis" spelling clamps into the 100–900 grid
    const full = collectFontFaces('@font-face{font-family:X;font-weight:1 1000;src:url(https://ex.com/a.woff2)}');
    expect([...full.values()][0]!.font).toMatchObject({ weight: 400, weightRange: [100, 900] });
    // off-grid ends round to the nearest real weight
    const odd = collectFontFaces('@font-face{font-family:X;font-weight:350 620;src:url(https://ex.com/b.woff2)}');
    expect([...odd.values()][0]!.font).toMatchObject({ weightRange: [400, 600] });
    // a degenerate "range" that collapses to one weight stays a plain static face
    const flat = collectFontFaces('@font-face{font-family:X;font-weight:390 420;src:url(https://ex.com/c.woff2)}');
    expect([...flat.values()][0]!.font).toEqual({ family: 'X', weight: 400, style: 'normal' });
  });

  it('ignores a @font-face with no absolute font-file url, and dedupes by url', () => {
    expect(collectFontFaces('@font-face{font-family:X;src:local("X")}').size).toBe(0);
    expect(collectFontFaces('@font-face{font-family:X;src:url(/rel.woff2)}').size).toBe(0); // not absolute
    const dup = '@font-face{font-family:A;src:url(https://ex.com/f.woff2)}@font-face{font-family:B;src:url(https://ex.com/f.woff2)}';
    expect(collectFontFaces(dup).size).toBe(1);
  });
});
