// `richCiCss` is what makes the toolbar's BRAND colour + font choices render inside the editor's
// rich-text field. Before it existed, `font-heading`/`font-body` had no rule at all and `text-primary`
// resolved to the editor chrome's DaisyUI default — the same colour in every project.
import { describe, expect, it } from 'vitest';
import { richCiCss, RICH_CI_SCOPE } from '../src/lib/rich-ci-css';
import type { CorporateIdentity } from '@sitewright/schema';
import type { FontLibraryAsset } from '../src/lib/font-face-css';

const identity = (over: Partial<CorporateIdentity> = {}): CorporateIdentity =>
  ({
    colors: { primary: '#123456', accent: '#abcdef', 'base-100': '#ffffff', 'primary-content': '#000000' },
    typography: {
      fontFamilies: {},
      heading: { source: 'system', family: 'serif', weight: 700 },
      body: { source: 'system', family: 'sans-serif', weight: 400 },
    },
    ...over,
  }) as CorporateIdentity;

const fontAsset = (over: Partial<FontLibraryAsset> = {}): FontLibraryAsset =>
  ({
    id: 'Ab12Cd',
    kind: 'font',
    family: 'Cormorant',
    fallback: 'serif',
    url: '/media/demo/Ab12Cd-cormorant-700.woff2',
    files: [{ weight: 700, style: 'normal', format: 'woff2', file: 'cormorant-700.woff2' }],
    ...over,
  }) as FontLibraryAsset;

describe('richCiCss', () => {
  it('gives every offered brand colour a rule scoped to the editable', () => {
    const css = richCiCss(identity());
    expect(css).toContain(`${RICH_CI_SCOPE} .text-primary{color:#123456}`);
    expect(css).toContain(`${RICH_CI_SCOPE} .text-accent{color:#abcdef}`);
  });

  it('omits surface + content roles, which the toolbar never offers as text colours', () => {
    const css = richCiCss(identity());
    expect(css).not.toContain('text-base-100');
    expect(css).not.toContain('text-primary-content');
  });

  it('resolves the built-in font slots to the same stacks the rendered site uses', () => {
    const css = richCiCss(identity());
    expect(css).toContain(`${RICH_CI_SCOPE} .font-heading{font-family:ui-serif,`);
    expect(css).toContain(`${RICH_CI_SCOPE} .font-body{font-family:ui-sans-serif,`);
  });

  it('sets no font-weight — the site utility sets none either, so the field stays a true preview', () => {
    expect(richCiCss(identity())).not.toContain('font-weight');
  });

  it('emits @font-face for a self-hosted slot so it draws in its REAL face', () => {
    const css = richCiCss(
      identity({
        typography: {
          fontFamilies: {},
          heading: { source: 'asset', family: 'Cormorant', assetId: 'Ab12Cd', weight: 700 },
          body: { source: 'system', family: 'sans-serif', weight: 400 },
        },
      } as Partial<CorporateIdentity>),
      [fontAsset()],
    );
    expect(css).toContain('@font-face{font-family:"Cormorant"');
    expect(css).toContain('src:url("/media/demo/Ab12Cd-cormorant-700.woff2")');
    expect(css).toContain(`${RICH_CI_SCOPE} .font-heading{font-family:"Cormorant", serif}`);
  });

  it('covers a CUSTOM named slot (the case a static SPA sheet can never pre-compile)', () => {
    const css = richCiCss(
      identity({
        typography: {
          fontFamilies: {},
          heading: { source: 'system', family: 'serif', weight: 700 },
          body: { source: 'system', family: 'sans-serif', weight: 400 },
          named: { boombox: { source: 'system', family: 'monospace', weight: 400 } },
        },
      } as Partial<CorporateIdentity>),
    );
    expect(css).toContain(`${RICH_CI_SCOPE} .font-boombox{font-family:ui-monospace,`);
  });

  // This sheet is injected into a <style> on the ADMIN origin, and its values are project content —
  // writable by any `content:write` actor (invited client, API key, agent loop), not only by the admin
  // reading it. The guard is `isSafeCssTokenValue`, the schema package's shared predicate; these cases
  // pin the behaviours a local hand-rolled regex got wrong.
  describe('rejects values that could subvert the generated stylesheet', () => {
    it('drops a value that would break out of its rule', () => {
      const css = richCiCss(identity({ colors: { primary: 'red}body{display:none' } } as Partial<CorporateIdentity>));
      expect(css).not.toContain('display:none');
    });

    // An unterminated comment swallows the rest of the block — including its closing brace — so every
    // declaration after it silently disappears. Reachable through the LEGACY `fontFamilies` stack,
    // which is used raw (it bypasses familyStack's quoting) and is not restricted by CssColorSchema.
    it('drops a font stack that opens a CSS comment', () => {
      const css = richCiCss(
        identity({
          typography: { fontFamilies: { heading: 'Arial/*' }, heading: { source: 'system', family: 'serif', weight: 700 }, body: { source: 'system', family: 'sans-serif', weight: 400 } },
        } as Partial<CorporateIdentity>),
      );
      expect(css).not.toContain('/*');
      // The poisoned slot emits no rule at all (asserted on the RULE — "Arial" alone would false-match
      // the default sans-serif stack, which legitimately lists it).
      expect(css).not.toContain('.font-heading{');
      // …and the rules an open comment would have swallowed are still intact.
      expect(css).toContain(`${RICH_CI_SCOPE} .text-primary{color:#123456}`);
    });

    it('drops a font stack that closes a CSS comment', () => {
      const css = richCiCss(
        identity({
          typography: { fontFamilies: { heading: '*/ Arial' }, heading: { source: 'system', family: 'serif', weight: 700 }, body: { source: 'system', family: 'sans-serif', weight: 400 } },
        } as Partial<CorporateIdentity>),
      );
      expect(css).not.toContain('*/');
    });

    it('drops a value carrying a fetching function', () => {
      const css = richCiCss(
        identity({
          typography: { fontFamilies: { heading: 'Georgia, url(https://evil.example/x)' }, heading: { source: 'system', family: 'serif', weight: 700 }, body: { source: 'system', family: 'sans-serif', weight: 400 } },
        } as Partial<CorporateIdentity>),
      );
      expect(css).not.toContain('evil.example');
    });

    it('drops a value with unbalanced parens (it would consume the rest of the sheet)', () => {
      const css = richCiCss(
        identity({
          typography: { fontFamilies: { heading: 'var(--x' }, heading: { source: 'system', family: 'serif', weight: 700 }, body: { source: 'system', family: 'sans-serif', weight: 400 } },
        } as Partial<CorporateIdentity>),
      );
      expect(css).not.toContain('var(--x');
    });

    it('still emits an ordinary legacy stack', () => {
      const css = richCiCss(
        identity({
          typography: { fontFamilies: { heading: 'Georgia, serif' }, heading: { source: 'system', family: 'serif', weight: 700 }, body: { source: 'system', family: 'sans-serif', weight: 400 } },
        } as Partial<CorporateIdentity>),
      );
      expect(css).toContain(`${RICH_CI_SCOPE} .font-heading{font-family:Georgia, serif}`);
    });
  });

  it('is empty without an identity — the standard palettes still come from the compiled sheet', () => {
    expect(richCiCss(null)).toBe('');
    expect(richCiCss(undefined)).toBe('');
  });
});
