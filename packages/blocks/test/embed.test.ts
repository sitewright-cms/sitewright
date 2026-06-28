import { describe, it, expect } from 'vitest';
import { EMBED_CSS, EMBED_JS, buildEmbed, embedProvidersInSource } from '../src/embed.js';
import { COMPONENT_TYPES, componentTypesInSource } from '../src/components.js';

describe('Embed component', () => {
  it('is registered and detected by the scanner (rendered marker + helper call)', () => {
    expect(COMPONENT_TYPES.has('Embed')).toBe(true);
    expect(componentTypesInSource('<div data-sw-component="embed"></div>')).toEqual(['Embed']);
    expect(componentTypesInSource('{{sw-embed "youtube" "ID"}}')).toEqual(['Embed']);
  });

  it('CSS holds the iframe full-bleed and reads a theme token (dark-ready surface)', () => {
    expect(EMBED_CSS).toContain('[data-sw-component="embed"]');
    expect(EMBED_CSS).toContain('var(--sw-color-base-200');
    expect(EMBED_CSS).toContain('iframe{position:absolute');
    expect(EMBED_CSS).not.toContain('data-sw-block');
  });

  it('runtime holds the iframe until consent/click and is CSP/XSS-safe', () => {
    expect(EMBED_JS).toContain('data-embed-src');
    expect(EMBED_JS).toContain('data-embed-category');
    expect(EMBED_JS).toContain('data-embed-provider');
    expect(EMBED_JS).toContain('data-embed-poster');
    expect(EMBED_JS).toContain('swConsent'); // category-gated
    expect(EMBED_JS).toContain("'sw:consentchange'"); // auto-loads when granted
    expect(EMBED_JS).toContain('createElement'); // iframe built, not innerHTML
    expect(EMBED_JS).not.toContain('innerHTML');
    expect(EMBED_JS).not.toMatch(/\beval\(/);
    expect(EMBED_JS).not.toMatch(/\bnew\s+Function\s*\(/);
  });
});

describe('buildEmbed', () => {
  it('youtube: bare id / watch url / youtu.be → nocookie embed + watch + thumbnail', () => {
    expect(buildEmbed('youtube', 'dQw4w9WgXcQ')).toEqual({
      src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      watch: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      poster: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    });
    expect(buildEmbed('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.src).toContain('/embed/dQw4w9WgXcQ');
    expect(buildEmbed('youtube', 'https://youtu.be/dQw4w9WgXcQ')?.src).toContain('/embed/dQw4w9WgXcQ');
    expect(buildEmbed('youtube', '')).toBeNull();
  });

  it('youtube: supports shorts/ and live/ URLs', () => {
    expect(buildEmbed('youtube', 'https://www.youtube.com/shorts/dQw4w9WgXcQ')?.src).toContain('/embed/dQw4w9WgXcQ');
    expect(buildEmbed('youtube', 'https://www.youtube.com/live/dQw4w9WgXcQ')?.src).toContain('/embed/dQw4w9WgXcQ');
  });

  it('google-maps: a query → maps embed url; a full maps url is reused (+ output=embed)', () => {
    expect(buildEmbed('google-maps', 'Eiffel Tower')?.src).toBe('https://www.google.com/maps?q=Eiffel%20Tower&output=embed');
    expect(buildEmbed('google-maps', 'https://www.google.com/maps/embed?pb=abc')?.src).toBe('https://www.google.com/maps/embed?pb=abc&output=embed');
  });

  it('google-maps: a non-google host is NEVER used as the iframe origin (falls to a safe google.com query)', () => {
    const r = buildEmbed('google-maps', 'https://www.google.evil.com/maps?q=x');
    expect(r?.src.startsWith('https://www.google.com/maps?q=')).toBe(true); // host pinned to google.com
    expect(r?.watch.startsWith('https://www.google.com/maps?q=')).toBe(true);
    // a ccTLD url isn't reused as-is either (frame-src only allows www.google.com)
    expect(buildEmbed('google-maps', 'https://www.google.co.uk/maps/embed?pb=z')?.src.startsWith('https://www.google.com/maps?q=')).toBe(true);
  });
});

describe('embedProvidersInSource', () => {
  it('detects providers from the helper call AND the rendered marker', () => {
    expect([...embedProvidersInSource('{{sw-embed "youtube" "x"}}')]).toEqual(['youtube']);
    expect([...embedProvidersInSource('<div data-embed-providerkey="google-maps"></div>')]).toEqual(['google-maps']);
    expect([...embedProvidersInSource('<p>no embeds here</p>')]).toEqual([]);
    expect([...embedProvidersInSource(undefined)]).toEqual([]);
  });
});
