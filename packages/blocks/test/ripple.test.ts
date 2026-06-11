import { describe, it, expect } from 'vitest';
import { RIPPLE_CSS, RIPPLE_JS, usesRipple } from '../src/ripple.js';

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

  it('binds on pointerdown and cleans up the span', () => {
    expect(RIPPLE_JS).toContain("addEventListener('pointerdown',spawn)");
    expect(RIPPLE_JS).toContain('removeChild(span)');
    expect(RIPPLE_JS).toContain("addEventListener('animationend',remove,{once:true})");
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
