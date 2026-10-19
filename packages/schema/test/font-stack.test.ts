import { describe, it, expect } from 'vitest';
import {
  declaredFontFamilies,
  fontStackFamilies,
  unservedFontWarnings,
  webSafeFontCategory,
  withGenericFallback,
} from '../src/font-stack.js';

describe('fontStackFamilies', () => {
  it('splits a stack into unquoted family names, in order', () => {
    expect(fontStackFamilies(`"JetBrains Mono", 'Fira Code' ,Menlo,  monospace`)).toEqual(['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace']);
    expect(fontStackFamilies(' , ')).toEqual([]);
  });
});

describe('webSafeFontCategory', () => {
  it('knows the kind of a well-known system face, case-insensitively', () => {
    expect(webSafeFontCategory('Georgia')).toBe('serif');
    expect(webSafeFontCategory(' COURIER NEW ')).toBe('monospace');
    expect(webSafeFontCategory('Verdana')).toBe('sans-serif');
    expect(webSafeFontCategory('JetBrains Mono')).toBeUndefined();
  });
  it('is not fooled by a family named like an object property', () => {
    // A family is free text and `constructor` passes the family-name schema; an object-literal table
    // answered it with Object's constructor function.
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(webSafeFontCategory(name)).toBeUndefined();
  });
});

describe('withGenericFallback', () => {
  it('appends the generic a bare stack lacks — by the face it names, then by the key', () => {
    expect(withGenericFallback('mono', 'JetBrains Mono')).toBe('JetBrains Mono, monospace');
    expect(withGenericFallback('caption', 'IBM Plex Mono')).toBe('IBM Plex Mono, monospace'); // the name says mono
    expect(withGenericFallback('code', "'Source Code Pro'")).toBe("'Source Code Pro', monospace");
    expect(withGenericFallback('display', 'Georgia')).toBe('Georgia, serif'); // a known face's own kind wins
    expect(withGenericFallback('serif', 'Lora')).toBe('Lora, serif');
    expect(withGenericFallback('display', 'Bebas Neue')).toBe('Bebas Neue, sans-serif');
  });
  it('leaves a stack alone that already lands somewhere, or that it cannot see into', () => {
    for (const stack of ['Inter, sans-serif', 'system-ui', "'Fira Code', ui-monospace", 'inherit', 'var(--brand-font)', '']) {
      expect(withGenericFallback('mono', stack)).toBe(stack);
    }
  });
});

describe('declaredFontFamilies', () => {
  it('reads every @font-face family, quoted or bare, in any case', () => {
    const css = `@font-face{font-family:"Brand Sans";src:url(a.woff2)} @FONT-FACE { src:url(b); font-family: Other }\n@font-face{font-family:'Single'}`;
    expect(declaredFontFamilies(css)).toEqual(['Brand Sans', 'Other', 'Single']);
  });
  it('reads the families a fonts.googleapis.com URL asks for (css2 and legacy, raw or HTML-escaped)', () => {
    const head =
      '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&amp;family=Inter&display=swap" rel="stylesheet">' +
      '<link href="https://fonts.googleapis.com/css?family=Roboto:400,700|Open+Sans">';
    expect(declaredFontFamilies(head)).toEqual(['Playfair Display', 'Inter', 'Roboto', 'Open Sans']);
  });
  it('ignores a block without a family, a malformed escape, and an UNCLOSED @font-face (linear, no hang)', () => {
    expect(declaredFontFamilies('@font-face{src:url(x)}')).toEqual([]);
    expect(declaredFontFamilies('https://fonts.googleapis.com/css2?family=%E0%A4%A&x=1')).toEqual([]);
    const hostile = '@font-face{font-family:'.repeat(50_000);
    const t0 = Date.now();
    expect(declaredFontFamilies(hostile)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('unservedFontWarnings', () => {
  const none = { declared: [], library: [] };

  it('names an unserved fontFamilies face and the SLOT route — with the asset id when the library has it', () => {
    const [w] = unservedFontWarnings({ fontFamilies: { mono: 'JetBrains Mono' } }, { declared: [], library: [{ id: 'jbm1', family: 'JetBrains Mono' }] });
    expect(w).toContain('identity.typography.fontFamilies.mono names "JetBrains Mono"');
    expect(w).toContain('sees monospace'); // the fallback it degrades to (withGenericFallback)
    expect(w).toContain('assetId "jbm1"');
    expect(w).toContain('identity.typography.named.code = { source:"asset", assetId, family:"JetBrains Mono", weight:400 } → class font-code');
    const [fresh] = unservedFontWarnings({ fontFamilies: { display: 'Fraunces' } }, none);
    expect(fresh).toContain('select_google_font({ family:"Fraunces", weights:[400] })');
    expect(fresh).toContain('identity.typography.named.display');
  });

  it('maps a key that cannot be a named slot onto one that can', () => {
    const at = (key: string) => unservedFontWarnings({ fontFamilies: { [key]: 'Fraunces' } }, none)[0];
    expect(at('heading')).toContain('identity.typography.heading = {');
    expect(at('body')).toContain('class font-body');
    expect(at('serif')).toContain('identity.typography.named.accent'); // reserved
    expect(at('brandFont')).toContain('identity.typography.named.accent'); // not a slot slug
  });

  it('is quiet for a face that IS available: generic, web-safe, CSS-declared, asset-served, or a var()', () => {
    const warnings = unservedFontWarnings(
      {
        fontFamilies: { a: 'sans-serif', b: 'Georgia', c: 'Brand Sans', d: 'Fraunces, serif', e: 'var(--x)', f: 'inherit' },
        heading: { source: 'asset', family: 'Fraunces', weight: 700, assetId: 'fr1' },
        body: { source: 'system', family: 'Verdana', weight: 400 },
      },
      { declared: ['brand sans'], library: [{ id: 'fr1', family: 'Fraunces' }] },
    );
    expect(warnings).toEqual([]);
    expect(unservedFontWarnings(undefined, none)).toEqual([]);
  });

  it('flags a system slot naming an unserved face (the legacy source:"google" degrades to exactly that)', () => {
    const warnings = unservedFontWarnings({ body: { source: 'system', family: 'Lato', weight: 300 } }, none);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('identity.typography.body is a system slot naming "Lato"');
    expect(warnings[0]).toContain('weight:300');
  });

  it('flags an asset slot whose asset is not in the library', () => {
    const [w] = unservedFontWarnings({ named: { accent: { source: 'asset', family: 'X', weight: 700, assetId: 'gone' } } }, none);
    expect(w).toContain('identity.typography.named.accent points at font asset "gone"');
  });
});
