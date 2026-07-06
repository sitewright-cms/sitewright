import { describe, expect, it } from 'vitest';
// The gate's clone-URL join is a plain .mjs so the browser CLI and this test share ONE implementation.
import { cloneUrlFor } from '../tools/preview-url.mjs';

// A signed preview base ALWAYS ends in '/' (mirrors GET /projects/:id/preview-url).
const ORIGIN = 'http://dind.local:2003';
const BASE = '/preview-site/vvDWmu0CcBMA/EWzoeaCSmrBVUhlzgvqhxjKtxVP/';

describe('cloneUrlFor', () => {
  it('home route ("") → single trailing slash, no double slash', () => {
    expect(cloneUrlFor(ORIGIN, BASE, '')).toBe(`${ORIGIN}${BASE}`);
    // the whole point: a relative styles.css must resolve to …/<sig>/styles.css (200), not …/<sig>//styles.css (404)
    expect(cloneUrlFor(ORIGIN, BASE, '')).not.toContain('//styles');
    expect(cloneUrlFor(ORIGIN, BASE, '').endsWith('//')).toBe(false);
  });

  it('bare sub-route → exactly one leading and trailing slash', () => {
    expect(cloneUrlFor(ORIGIN, BASE, 'web-development')).toBe(`${ORIGIN}${BASE}web-development/`);
  });

  it('nested route joins cleanly', () => {
    expect(cloneUrlFor(ORIGIN, BASE, 'software/for-business')).toBe(`${ORIGIN}${BASE}software/for-business/`);
  });

  it('REGRESSION: a leading-slash route never doubles the join', () => {
    // The old join was `${base}${route}` with base ending in '/' — a "/about" route produced `…/<sig>//about`,
    // 404'ing the relative stylesheet and rendering the page UNSTYLED. Guard against every slashy shape.
    expect(cloneUrlFor(ORIGIN, BASE, '/about')).toBe(`${ORIGIN}${BASE}about/`);
    expect(cloneUrlFor(ORIGIN, BASE, '/about/')).toBe(`${ORIGIN}${BASE}about/`);
    expect(cloneUrlFor(ORIGIN, BASE, 'about/')).toBe(`${ORIGIN}${BASE}about/`);
    for (const route of ['', '/', '/about', 'about/', '//x//y//']) {
      const url = cloneUrlFor(ORIGIN, BASE, route);
      expect(url.slice(ORIGIN.length + BASE.length)).not.toContain('//'); // no double slash anywhere in the path tail
    }
  });

  it('preserves the scheme separator (never collapses ://)', () => {
    expect(cloneUrlFor('https://phoenix.example', '/p/sig/', 'x')).toBe('https://phoenix.example/p/sig/x/');
  });

  it('tolerates an origin supplied with a trailing slash (collapses the origin//base seam)', () => {
    expect(cloneUrlFor('http://dind.local:2003/', BASE, 'about')).toBe(`http://dind.local:2003${BASE}about/`);
  });

  it('tolerates a nullish route', () => {
    expect(cloneUrlFor(ORIGIN, BASE, undefined as unknown as string)).toBe(`${ORIGIN}${BASE}`);
  });
});
