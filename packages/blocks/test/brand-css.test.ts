import { describe, expect, it } from 'vitest';
import type { BrandTokens } from '@sitewright/schema';
import { brandToCss } from '../src/brand-css.js';

function brand(overrides: Partial<BrandTokens> = {}): BrandTokens {
  return { colors: {}, ...overrides };
}

describe('brandToCss', () => {
  it('emits color custom properties under :root', () => {
    const css = brandToCss(brand({ colors: { primary: '#0a7', 'base-content': '#111' } }));
    expect(css).toContain(':root {');
    expect(css).toContain('--sw-color-primary: #0a7;');
    expect(css).toContain('--sw-color-base-content: #111;');
  });

  it('emits font, spacing and radius tokens', () => {
    const css = brandToCss(
      brand({
        typography: { fontFamilies: { heading: 'Inter' } },
        spacing: { lg: '2rem' },
        radii: { card: '0.5rem' },
      }),
    );
    expect(css).toContain('--sw-font-heading: Inter;');
    expect(css).toContain('--sw-space-lg: 2rem;');
    expect(css).toContain('--sw-radius-card: 0.5rem;');
  });

  it('drops values that could break out of the declaration', () => {
    const css = brandToCss(brand({ colors: { evil: 'red; } body { display:none' } }));
    expect(css).not.toContain('display:none');
    expect(css).not.toContain('--sw-color-evil');
  });

  // `cssTokens` is the free-form store: any CSS value under `--sw-<key>`, no category prefix. It exists
  // because `emit`'s SAFE guard rejects parentheses, so a gradient/shadow could never be a token before.
  describe('cssTokens (free-form --sw-<key>)', () => {
    const tokens = (cssTokens: Record<string, string>): string => brandToCss(brand({ cssTokens }));

    it('emits values the categorized guard would have dropped — gradients, shadows, var() chains', () => {
      const css = tokens({
        'grad-hero': 'linear-gradient(135deg,#06f 0%,#0cf 100%)',
        z1: '0 2px 5px rgba(0,0,0,.2), 0 1px 1px rgba(0,0,0,.1)',
        'ease-out': 'cubic-bezier(.16,1,.3,1)',
        tint: 'color-mix(in oklab, var(--sw-color-primary) 25%, transparent)',
      });
      expect(css).toContain('--sw-grad-hero: linear-gradient(135deg,#06f 0%,#0cf 100%);');
      expect(css).toContain('--sw-z1: 0 2px 5px rgba(0,0,0,.2), 0 1px 1px rgba(0,0,0,.1);');
      expect(css).toContain('--sw-ease-out: cubic-bezier(.16,1,.3,1);');
      expect(css).toContain('--sw-tint: color-mix(in oklab, var(--sw-color-primary) 25%, transparent);');
      // No category prefix — the key IS the token name.
      expect(css).not.toContain('--sw-color-grad-hero');
    });

    // Each of these is a distinct escape route; assert them one by one so a future widening of the
    // guard can't quietly re-open one of them.
    it.each([
      ['declaration break-out', 'red; } body { display:none'],
      ['brace escape', 'red} body{display:none'],
      ['angle brackets', '</style><script>alert(1)</script>'],
      ['backslash hex escape', 'red\\3b color:blue'],
      ['comment open (would swallow the rest of the block)', 'red /*'],
      ['comment close', '*/ body{display:none} /*'],
      ['url() fetch', 'url(https://evil.test/x.png)'],
      ['url() with leading space', ' url( https://evil.test/x.png )'],
      ['image-set() fetch', 'image-set("https://evil.test/x.png" 1x)'],
      ['-webkit-image-set() fetch', '-webkit-image-set(url(https://evil.test/x.png) 1x)'],
      ['src() fetch', 'src("https://evil.test/f.woff2")'],
      ['element() reference', 'element(#hidden)'],
      ['IE expression()', 'expression(alert(1))'],
      ['@import', '@import "https://evil.test/x.css"'],
      ['unbalanced open paren (swallows the stylesheet)', 'linear-gradient(#fff,#000'],
      ['unbalanced close paren', 'red)'],
      ['newline', 'red\n  color: blue'],
      ['NUL', 'red\u0000'],
      ['-moz-element() (a vendor alias of a blocked function)', '-moz-element(#a)'],
      ['a zero-width space hiding a url()', 'u\u200brl(https://evil.test/x.png)'],
    ])('drops a value using %s', (_label, value) => {
      const css = tokens({ bad: value });
      expect(css).not.toContain('--sw-bad');
    });

    it('drops a dangerous KEY but keeps its safe siblings', () => {
      const css = tokens({ 'ok-one': '4px', 'bad(key)': '4px' });
      expect(css).toContain('--sw-ok-one: 4px;');
      expect(css).not.toContain('bad(key)');
    });

    it('is emitted after the categorized tokens, so a deliberate restatement wins the tie', () => {
      const css = brandToCss(brand({ spacing: { lg: '2rem' }, cssTokens: { 'space-lg': '3rem' } }));
      expect(css.indexOf('--sw-space-lg: 3rem;')).toBeGreaterThan(css.indexOf('--sw-space-lg: 2rem;'));
    });
  });
});
