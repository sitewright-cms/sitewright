import { describe, expect, it } from 'vitest';
import { typographyCss, fontPreloads, type FontAsset } from '../src/typography-css.js';

type Face = { weight: number; style?: 'normal' | 'italic'; format: 'woff2' | 'woff' | 'ttf' | 'otf'; file: string };
/** Build a `kind:'font'` library asset for fixtures. */
function font(id: string, family: string, fallback: string, source: 'google' | 'local', faces: Face[]): FontAsset {
  return {
    kind: 'font',
    id,
    filename: family,
    folder: '',
    bytes: 1000,
    family,
    fallback: fallback as FontAsset['fallback'],
    source,
    files: faces.map((f) => ({ style: 'normal' as const, ...f })),
    url: `/media/p1/${id}/${faces[0]!.file}`,
  } as FontAsset;
}
/** Google woff2 faces, one per weight. */
function woff2(weights: number[]): Face[] {
  return weights.map((w) => ({ weight: w, format: 'woff2' as const, file: `${w}.woff2` }));
}
/** The publish/preview font URL resolver (a media URL per asset+file). */
const url = (id: string, file: string) => `/media/p1/${id}/${file}`;

describe('typographyCss', () => {
  it('applies the platform defaults (serif/700 headings, sans-serif/400 body) when unset', () => {
    const css = typographyCss(undefined);
    expect(css).toContain('--sw-font-heading-weight:700');
    expect(css).toContain('--sw-font-body-weight:400');
    expect(css).toMatch(/--sw-font-heading:[^;]*Georgia[^;]*serif/);
    expect(css).toMatch(/--sw-font-body:[^;]*system-ui[^;]*sans-serif/);
    expect(css).toContain('body{font-family:var(--sw-font-body);font-weight:var(--sw-font-body-weight)}');
    expect(css).toContain('h1,h2,h3,h4,h5,h6,.sw-h1,.sw-h2,.sw-h3,.sw-h4,.sw-h5,.sw-h6{font-family:var(--sw-font-heading);font-weight:var(--sw-font-heading-weight)}');
  });

  it('honours configured system slots + weights', () => {
    const css = typographyCss({
      fontFamilies: {},
      heading: { source: 'system', family: 'sans-serif', weight: 800 },
      body: { source: 'system', family: 'serif', weight: 300 },
    });
    expect(css).toContain('--sw-font-heading-weight:800');
    expect(css).toContain('--sw-font-body-weight:300');
    expect(css).toMatch(/--sw-font-heading:[^;]*sans-serif/);
    expect(css).toMatch(/--sw-font-body:[^;]*serif/);
  });

  it('never emits CSS-breaking output (an unsafe family falls back to the generic stack)', () => {
    // Only a family that can't pass SAFE_FAMILY is dropped — it could otherwise break out of the
    // declaration. A merely UNRECOGNISED-but-safe name is a legitimate named face (see below).
    for (const family of ['a;}body{display:none', 'x"/**/;color:red', 'ünïcode']) {
      const css = typographyCss({ fontFamilies: {}, body: { source: 'system', family, weight: 400 } });
      expect(css).not.toContain(family);
      expect(css).toMatch(/--sw-font-body:[^;]*sans-serif/);
    }
  });

  // REGRESSION: a `system` slot used to accept ONLY serif/sans-serif/monospace — any named face fell
  // through to the default sans stack and was silently dropped. The site importer emits exactly such
  // slots (`src:local("Verdana")` → {source:'system', family:'Verdana'}), so an imported site rendered
  // its entire body copy in the wrong font with nothing reporting it.
  it('honours a NAMED system family and trails the matching generic stack', () => {
    const verdana = typographyCss({ fontFamilies: {}, body: { source: 'system', family: 'Verdana', weight: 400 } });
    expect(verdana).toMatch(/--sw-font-body:"Verdana", ui-sans-serif[^;]*sans-serif;/);

    // a known serif face trails the SERIF stack, not the default sans one
    const georgia = typographyCss({ fontFamilies: {}, heading: { source: 'system', family: 'Georgia', weight: 700 } });
    expect(georgia).toMatch(/--sw-font-heading:"Georgia", ui-serif[^;]*serif;/);

    // case-insensitive category lookup
    const times = typographyCss({ fontFamilies: {}, body: { source: 'system', family: 'times new roman', weight: 400 } });
    expect(times).toMatch(/--sw-font-body:"times new roman", ui-serif/);

    // a multi-word face with a space is quoted intact
    const trebuchet = typographyCss({ fontFamilies: {}, body: { source: 'system', family: 'Trebuchet MS', weight: 400 } });
    expect(trebuchet).toContain('--sw-font-body:"Trebuchet MS", ui-sans-serif');

    // the three GENERIC keywords still resolve to their bare curated stacks (never quoted)
    expect(typographyCss({ fontFamilies: {}, body: { source: 'system', family: 'serif', weight: 400 } })).toMatch(/--sw-font-body:ui-serif/);
    expect(typographyCss({ fontFamilies: {}, body: { source: 'system', family: 'monospace', weight: 400 } })).toMatch(/--sw-font-body:ui-monospace/);
  });

  it('emits @font-face (LOCAL media urls) per weight for an asset slot', () => {
    const css = typographyCss(
      {
        fontFamilies: {},
        heading: { source: 'asset', family: 'Playfair Display', weight: 700, assetId: 'pf' },
        body: { source: 'system', family: 'sans-serif', weight: 400 },
      },
      [font('pf', 'Playfair Display', 'serif', 'google', woff2([400, 700]))],
      { fontUrl: url },
    );
    expect(css).toContain('@font-face{font-family:"Playfair Display";font-style:normal;font-weight:400;font-display:swap;src:url(/media/p1/pf/400.woff2) format("woff2")}');
    expect(css).toContain('font-weight:700;font-display:swap;src:url(/media/p1/pf/700.woff2)');
    expect(css).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(css).toContain('--sw-font-heading:"Playfair Display", serif');
  });

  it('emits NO @font-face when no fontUrl resolver is given (family degrades to a generic)', () => {
    const css = typographyCss(
      { fontFamilies: {}, heading: { source: 'asset', family: 'Playfair Display', weight: 700, assetId: 'pf' } },
      [font('pf', 'Playfair Display', 'serif', 'google', woff2([700]))],
    );
    expect(css).not.toContain('@font-face');
    expect(css).toContain('--sw-font-heading:"Playfair Display", serif');
  });

  it('degrades an asset slot whose font is missing from the library to the family name', () => {
    const css = typographyCss(
      { fontFamilies: {}, heading: { source: 'asset', family: 'Gone Sans', weight: 700, assetId: 'missing' } },
      [],
      { fontUrl: url },
    );
    expect(css).not.toContain('@font-face');
    expect(css).toContain('--sw-font-heading:"Gone Sans", ');
  });

  it('emits a single @font-face block when heading + body reference the SAME font asset', () => {
    const css = typographyCss(
      {
        fontFamilies: {},
        heading: { source: 'asset', family: 'Inter', weight: 700, assetId: 'inter' },
        body: { source: 'asset', family: 'Inter', weight: 400, assetId: 'inter' },
      },
      [font('inter', 'Inter', 'sans-serif', 'google', woff2([400, 700]))],
      { fontUrl: url },
    );
    expect(css.match(/@font-face/g)).toHaveLength(2);
  });

  it('emits @font-face with the right format() for a LOCAL (uploaded) multi-format font', () => {
    const css = typographyCss(
      { fontFamilies: {}, body: { source: 'asset', family: 'Boombox', weight: 400, assetId: 'up' } },
      [
        font('up', 'Boombox', 'sans-serif', 'local', [
          { weight: 400, format: 'ttf', file: '400.ttf' },
          { weight: 700, style: 'italic', format: 'woff', file: '700-italic.woff' },
        ]),
      ],
      { fontUrl: url },
    );
    expect(css).toContain('@font-face{font-family:"Boombox";font-style:normal;font-weight:400;font-display:swap;src:url(/media/p1/up/400.ttf) format("truetype")}');
    expect(css).toContain('font-style:italic;font-weight:700;font-display:swap;src:url(/media/p1/up/700-italic.woff) format("woff")}');
    expect(css).toContain('--sw-font-body:"Boombox", sans-serif');
  });

  it('emits --sw-font-<name> (+weight) for custom named slots and their @font-face', () => {
    const css = typographyCss(
      {
        fontFamilies: {},
        named: {
          boombox: { source: 'asset', family: 'Boombox', weight: 800, assetId: 'up' },
          accent: { source: 'system', family: 'monospace', weight: 500 },
        },
      },
      [font('up', 'Boombox', 'sans-serif', 'local', [{ weight: 800, format: 'otf', file: '800.otf' }])],
      { fontUrl: url },
    );
    expect(css).toContain('--sw-font-boombox:"Boombox", sans-serif;--sw-font-boombox-weight:800;');
    expect(css).toMatch(/--sw-font-accent:[^;]*monospace;--sw-font-accent-weight:500;/);
    expect(css).toContain('format("opentype")');
    expect(css).not.toContain('.font-boombox');
  });
});

describe('fontPreloads', () => {
  it('preloads the body + heading self-hosted faces (exact weight, woff2), body first', () => {
    const inter = font('inter', 'Inter', 'sans-serif', 'local', woff2([400, 700]));
    const out = fontPreloads(
      {
        fontFamilies: {},
        heading: { source: 'asset', family: 'Inter', weight: 700, assetId: 'inter' },
        body: { source: 'asset', family: 'Inter', weight: 400, assetId: 'inter' },
      },
      [inter],
      { fontUrl: url },
    );
    expect(out).toEqual([
      { href: '/media/p1/inter/400.woff2', type: 'font/woff2' },
      { href: '/media/p1/inter/700.woff2', type: 'font/woff2' },
    ]);
  });

  it('dedups when body + heading resolve to the same face', () => {
    const inter = font('inter', 'Inter', 'sans-serif', 'local', woff2([400]));
    const out = fontPreloads(
      {
        fontFamilies: {},
        heading: { source: 'asset', family: 'Inter', weight: 400, assetId: 'inter' },
        body: { source: 'asset', family: 'Inter', weight: 400, assetId: 'inter' },
      },
      [inter],
      { fontUrl: url },
    );
    expect(out).toEqual([{ href: '/media/p1/inter/400.woff2', type: 'font/woff2' }]);
  });

  it('returns [] for system-font slots', () => {
    expect(fontPreloads(undefined, [], { fontUrl: url })).toEqual([]);
  });

  it('returns [] without a fontUrl resolver', () => {
    const inter = font('inter', 'Inter', 'sans-serif', 'local', woff2([400]));
    expect(
      fontPreloads({ fontFamilies: {}, body: { source: 'asset', family: 'Inter', weight: 400, assetId: 'inter' } }, [inter]),
    ).toEqual([]);
  });

  it('skips a slot whose exact weight is not in the library (never a wasted preload)', () => {
    const inter = font('inter', 'Inter', 'sans-serif', 'local', woff2([400, 700]));
    const out = fontPreloads(
      { fontFamilies: {}, body: { source: 'asset', family: 'Inter', weight: 500, assetId: 'inter' } },
      [inter],
      { fontUrl: url },
    );
    expect(out).toEqual([]);
  });

  it('prefers woff2 when a weight is stored in several containers', () => {
    const mix = font('mix', 'Mix', 'serif', 'local', [
      { weight: 400, format: 'woff', file: '400.woff' },
      { weight: 400, format: 'woff2', file: '400.woff2' },
    ]);
    const out = fontPreloads(
      { fontFamilies: {}, body: { source: 'asset', family: 'Mix', weight: 400, assetId: 'mix' } },
      [mix],
      { fontUrl: url },
    );
    expect(out).toEqual([{ href: '/media/p1/mix/400.woff2', type: 'font/woff2' }]);
  });
});
