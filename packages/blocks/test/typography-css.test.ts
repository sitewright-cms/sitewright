import { describe, expect, it } from 'vitest';
import { typographyCss } from '../src/typography-css.js';

type Face = { weight: number; style?: 'normal' | 'italic'; format: 'woff2' | 'woff' | 'ttf' | 'otf'; file: string };
/** Build a self-hosted font record (the post-#124 `files` shape) for fixtures. */
function font(id: string, family: string, fallback: string, source: 'google' | 'local', faces: Face[]) {
  return { id, family, fallback, source, files: faces.map((f) => ({ style: 'normal' as const, ...f })) } as never;
}
/** Google woff2 faces, one per weight. */
function woff2(weights: number[]): Face[] {
  return weights.map((w) => ({ weight: w, format: 'woff2' as const, file: `${w}.woff2` }));
}

describe('typographyCss', () => {
  it('applies the platform defaults (serif/700 headings, sans-serif/400 body) when unset', () => {
    const css = typographyCss(undefined);
    expect(css).toContain('--sw-font-heading-weight:700');
    expect(css).toContain('--sw-font-body-weight:400');
    // serif heading stack, sans-serif body stack
    expect(css).toMatch(/--sw-font-heading:[^;]*Georgia[^;]*serif/);
    expect(css).toMatch(/--sw-font-body:[^;]*system-ui[^;]*sans-serif/);
    // applied to real elements (works for code-first pages, not just block-tree)
    expect(css).toContain('body{font-family:var(--sw-font-body);font-weight:var(--sw-font-body-weight)}');
    expect(css).toContain('h1,h2,h3,h4,h5,h6{font-family:var(--sw-font-heading);font-weight:var(--sw-font-heading-weight)}');
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

  it('quotes a google family name (PR2 shape) and keeps a fallback', () => {
    const css = typographyCss({
      fontFamilies: {},
      heading: { source: 'google', family: 'Playfair Display', weight: 700, fontId: 'f1' },
      body: { source: 'system', family: 'sans-serif', weight: 400 },
    });
    expect(css).toContain('--sw-font-heading:"Playfair Display", ');
    expect(css).toContain('sans-serif'); // fallback retained
  });

  it('never emits CSS-breaking output (unknown system family falls back)', () => {
    const css = typographyCss({ fontFamilies: {}, body: { source: 'system', family: 'bogus', weight: 400 } });
    expect(css).not.toContain('bogus');
    expect(css).toMatch(/--sw-font-body:[^;]*sans-serif/);
  });

  it('emits @font-face (LOCAL urls) per weight for a self-hosted google slot', () => {
    const css = typographyCss(
      {
        fontFamilies: {},
        heading: { source: 'google', family: 'Playfair Display', weight: 700, fontId: 'playfair-display' },
        body: { source: 'system', family: 'sans-serif', weight: 400 },
        fonts: [font('playfair-display', 'Playfair Display', 'serif', 'google', woff2([400, 700]))],
      },
      { fontUrl: (id, file) => `/fonts/${id}/${file}` },
    );
    // one @font-face per bundled weight, pointing at the LOCAL url (never Google)
    expect(css).toContain('@font-face{font-family:"Playfair Display";font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/playfair-display/400.woff2) format("woff2")}');
    expect(css).toContain('font-weight:700;font-display:swap;src:url(/fonts/playfair-display/700.woff2)');
    expect(css).not.toContain('fonts.googleapis.com');
    expect(css).not.toContain('fonts.gstatic.com');
    // the stack uses the bundled font's family + its category fallback
    expect(css).toContain('--sw-font-heading:"Playfair Display", serif');
  });

  it('emits NO @font-face when no fontUrl resolver is given (google family degrades to a generic)', () => {
    const css = typographyCss({
      fontFamilies: {},
      heading: { source: 'google', family: 'Playfair Display', weight: 700, fontId: 'playfair-display' },
      fonts: [font('playfair-display', 'Playfair Display', 'serif', 'google', woff2([700]))],
    });
    expect(css).not.toContain('@font-face');
    expect(css).toContain('--sw-font-heading:"Playfair Display", serif');
  });

  it('emits a single @font-face block when heading + body reference the SAME self-hosted font', () => {
    const css = typographyCss(
      {
        fontFamilies: {},
        heading: { source: 'google', family: 'Inter', weight: 700, fontId: 'inter' },
        body: { source: 'google', family: 'Inter', weight: 400, fontId: 'inter' },
        fonts: [font('inter', 'Inter', 'sans-serif', 'google', woff2([400, 700]))],
      },
      { fontUrl: (id, file) => `/fonts/${id}/${file}` },
    );
    // de-duplicated: the font's two weights appear once each, not twice.
    expect(css.match(/@font-face/g)).toHaveLength(2);
  });

  it('emits @font-face with the right format() for a LOCAL (uploaded) multi-format font', () => {
    const css = typographyCss(
      {
        fontFamilies: {},
        body: { source: 'local', family: 'Boombox', weight: 400, fontId: 'up-ab12cd34' },
        fonts: [
          font('up-ab12cd34', 'Boombox', 'sans-serif', 'local', [
            { weight: 400, format: 'ttf', file: '400.ttf' },
            { weight: 700, style: 'italic', format: 'woff', file: '700-italic.woff' },
          ]),
        ],
      },
      { fontUrl: (id, file) => `/projects/p1/fonts/${id}/${file}` },
    );
    expect(css).toContain('@font-face{font-family:"Boombox";font-style:normal;font-weight:400;font-display:swap;src:url(/projects/p1/fonts/up-ab12cd34/400.ttf) format("truetype")}');
    expect(css).toContain('font-style:italic;font-weight:700;font-display:swap;src:url(/projects/p1/fonts/up-ab12cd34/700-italic.woff) format("woff")}');
    expect(css).toContain('--sw-font-body:"Boombox", sans-serif');
    expect(css).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it('emits --sw-font-<name> (+weight) for custom named slots and their @font-face', () => {
    const css = typographyCss(
      {
        fontFamilies: {},
        named: {
          boombox: { source: 'local', family: 'Boombox', weight: 800, fontId: 'up-x' },
          accent: { source: 'system', family: 'monospace', weight: 500 },
        },
        fonts: [font('up-x', 'Boombox', 'sans-serif', 'local', [{ weight: 800, format: 'otf', file: '800.otf' }])],
      },
      { fontUrl: (id, file) => `/projects/p1/fonts/${id}/${file}` },
    );
    expect(css).toContain('--sw-font-boombox:"Boombox", sans-serif;--sw-font-boombox-weight:800;');
    expect(css).toMatch(/--sw-font-accent:[^;]*monospace;--sw-font-accent-weight:500;/);
    expect(css).toContain('format("opentype")');
    // named slots are NOT auto-applied to elements (only heading/body are)
    expect(css).not.toContain('.font-boombox');
  });
});
