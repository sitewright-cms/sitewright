import { describe, it, expect } from 'vitest';
import { RIPPLE_CSS, RIPPLE_JS, usesRipple, RIPPLE_HOSTS } from '../src/ripple.js';

describe('ripple stylesheet', () => {
  it('gates all motion behind prefers-reduced-motion: no-preference', () => {
    expect(RIPPLE_CSS.startsWith('@media (prefers-reduced-motion: no-preference){')).toBe(true);
    expect(RIPPLE_CSS.trimEnd().endsWith('}')).toBe(true);
  });

  it('clips the effect and tints waves-light white', () => {
    expect(RIPPLE_CSS).toContain('.waves-effect{position:relative;overflow:hidden');
    expect(RIPPLE_CSS).toContain('.waves-effect.waves-light .waves-ripple{background:rgba(255,255,255');
  });

  it('defines the scale+fade keyframe', () => {
    expect(RIPPLE_CSS).toContain('@keyframes sw-waves');
    expect(RIPPLE_CSS).toContain('transform:scale(1);opacity:0');
  });

  it('cannot break out of a <style> block', () => {
    expect(RIPPLE_CSS.toLowerCase()).not.toContain('</style');
  });
});

describe('ripple runtime', () => {
  it('bails out under prefers-reduced-motion', () => {
    expect(RIPPLE_JS).toContain('(prefers-reduced-motion: reduce)');
  });

  it('builds the ripple span via createElement + numeric inline styles (no innerHTML)', () => {
    expect(RIPPLE_JS).toContain("document.createElement('span')");
    expect(RIPPLE_JS).toContain("span.className='waves-ripple waves-rippling'");
    expect(RIPPLE_JS).not.toContain('innerHTML');
  });

  it('listens DELEGATED on the document (late-injected elements — e.g. the modal auto close — ripple too)', () => {
    expect(RIPPLE_JS).toContain("document.addEventListener('pointerdown'");
    expect(RIPPLE_JS).toContain(`.closest?t.closest('${RIPPLE_HOSTS}')`);
    expect(RIPPLE_JS).toContain('removeChild(span)');
    expect(RIPPLE_JS).toContain("addEventListener('animationend',remove,{once:true})");
    // no per-element bind — a querySelectorAll init scan would miss runtime-injected elements
    expect(RIPPLE_JS).not.toContain('querySelectorAll');
  });

  it('cannot break out of a <script> block', () => {
    expect(RIPPLE_JS.toLowerCase()).not.toContain('</script');
  });
});

describe('ripple detection', () => {
  it('detects the waves-effect marker', () => {
    expect(usesRipple('<a class="btn waves-effect waves-light">Go</a>')).toBe(true);
    expect(usesRipple('<a class="btn">Go</a>')).toBe(false);
    expect(usesRipple(undefined)).toBe(false);
  });

});

describe('lightbox controls ripple without carrying the marker class', () => {
  it('matches the viewer arrows and the thumbnail strip implicitly', () => {
    // The viewer re-renders through morphdom, which strips any attribute absent from its template —
    // so a class stamped onto its arrows does not survive the next paint. Naming our own
    // `sw-lightbox-*` classes in the selector is immune to that.
    expect(RIPPLE_HOSTS).toContain('.waves-effect');
    expect(RIPPLE_HOSTS).toContain('.sw-lightbox-arrow-left');
    expect(RIPPLE_HOSTS).toContain('.sw-lightbox-arrow-right');
    expect(RIPPLE_HOSTS).toContain('.sw-lightbox-nav a');
    expect(RIPPLE_JS).toContain(RIPPLE_HOSTS); // the delegated listener uses the same list
  });

  it('gives those hosts the containing box a ripple needs', () => {
    // Without position+overflow the circle escapes its host and paints across the viewer.
    expect(RIPPLE_CSS).toMatch(/\.sw-lightbox-arrow-left,\.sw-lightbox-arrow-right,\.sw-lightbox-nav a\{position:relative;overflow:hidden/);
  });

  it('tints them light — the viewer is a near-black overlay in every palette', () => {
    expect(RIPPLE_CSS).toContain('.sw-lightbox-nav a .waves-ripple{background:rgba(255,255,255,.45)}');
  });
});
