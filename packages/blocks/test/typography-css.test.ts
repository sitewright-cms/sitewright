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
});
