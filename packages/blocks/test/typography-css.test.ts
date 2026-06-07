import { describe, expect, it } from 'vitest';
import { typographyCss } from '../src/typography-css.js';

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
        fonts: [{ id: 'playfair-display', family: 'Playfair Display', fallback: 'serif', weights: [400, 700] }],
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
      fonts: [{ id: 'playfair-display', family: 'Playfair Display', fallback: 'serif', weights: [700] }],
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
        fonts: [{ id: 'inter', family: 'Inter', fallback: 'sans-serif', weights: [400, 700] }],
      },
      { fontUrl: (id, file) => `/fonts/${id}/${file}` },
    );
    // de-duplicated: the font's two weights appear once each, not twice.
    expect(css.match(/@font-face/g)).toHaveLength(2);
  });
});
