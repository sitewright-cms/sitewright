import { describe, it, expect } from 'vitest';
import { LAZYLOAD_CSS, LAZYLOAD_JS, usesLazyload } from '../src/lazyload.js';

describe('lazyload stylesheet', () => {
  it('gates the fade behind prefers-reduced-motion: no-preference', () => {
    expect(LAZYLOAD_CSS.startsWith('@media (prefers-reduced-motion: no-preference){')).toBe(true);
    expect(LAZYLOAD_CSS.trimEnd().endsWith('}')).toBe(true);
  });

  it('only hides via the runtime-added .lazyloading class (PE: no-JS shows content)', () => {
    for (const line of LAZYLOAD_CSS.split('\n')) {
      if (line.includes('opacity:0')) expect(line).toContain('.lazyloading');
    }
  });

  it('reveals to opacity:1 via .lazyloaded', () => {
    expect(LAZYLOAD_CSS).toContain('.lazyloaded');
    expect(LAZYLOAD_CSS).toMatch(/\.lazyloaded[^{]*\{opacity:1\}/);
  });

  it('cannot break out of a <style> block', () => {
    expect(LAZYLOAD_CSS.toLowerCase()).not.toContain('</style');
  });
});

describe('lazyload runtime', () => {
  it('uses IntersectionObserver and supports data-bg + data-src/-srcset', () => {
    expect(LAZYLOAD_JS).toContain('IntersectionObserver');
    expect(LAZYLOAD_JS).toContain('data-bg');
    expect(LAZYLOAD_JS).toContain('data-src');
    expect(LAZYLOAD_JS).toContain('data-srcset');
  });

  it('observes by data-ATTRIBUTE alone — no required lazyload class, not img-scoped', () => {
    // The selector is attribute-based, so a bare <img data-src> / <iframe data-src> qualifies.
    expect(LAZYLOAD_JS).toContain("querySelectorAll('[data-src],[data-srcset],[data-bg]')");
    expect(LAZYLOAD_JS).not.toContain('img.lazyload[data-src]');
  });

  it('swaps data-src → src untag-gated (iframes too) and awaits load on img/iframe', () => {
    // The src/srcset swap itself is not tag-gated → iframes lazy-load, not just <img>.
    expect(LAZYLOAD_JS).toContain("setAttribute('src',src)");
    expect(LAZYLOAD_JS).toContain("setAttribute('srcset',srcset)");
    // <img> and <iframe> fire 'load', so the fade settles on the element's own load event.
    expect(LAZYLOAD_JS).toContain("el.tagName==='IFRAME'");
    expect(LAZYLOAD_JS).toContain("addEventListener('load',done");
  });

  it('can never leave an element stuck invisible (opacity:0) — a deadline always settles it', () => {
    // A non-media element with data-src, or a srcset with no chosen candidate, would otherwise
    // never fire load; the safety-net timeout guarantees .lazyloaded is reached.
    expect(LAZYLOAD_JS).toContain('setTimeout(done');
  });

  it('sets the background via inline style with the url backslash/quote-escaped (no CSS breakout)', () => {
    expect(LAZYLOAD_JS).toContain("replace(/\\\\/g,'%5C')"); // backslash → %5C (defense-in-depth)
    expect(LAZYLOAD_JS).toContain("replace(/\"/g,'%22')"); // quote → %22
    expect(LAZYLOAD_JS).toContain('style.backgroundImage');
    expect(LAZYLOAD_JS).not.toContain('innerHTML');
  });

  it("guards against a double class-transition (the settled flag)", () => {
    expect(LAZYLOAD_JS).toContain('if(settled)return;settled=true');
  });

  it('unobserves after the first reveal (load once)', () => {
    expect(LAZYLOAD_JS).toContain('io.unobserve(entry.target)');
  });

  it('cannot break out of a <script> block', () => {
    expect(LAZYLOAD_JS.toLowerCase()).not.toContain('</script');
  });
});

describe('lazyload detection', () => {
  it('detects data-bg, bare data-src/-srcset (no class), and the legacy lazyload class', () => {
    expect(usesLazyload('<div data-bg="/x.jpg"></div>')).toBe(true);
    expect(usesLazyload('<img class="lazyload" data-src="/x.jpg">')).toBe(true); // legacy form
    expect(usesLazyload('<img data-src="/x.jpg" alt="x">')).toBe(true); // bare data-src, no class
    expect(usesLazyload('<iframe data-src="/embed.html" title="m"></iframe>')).toBe(true); // iframe
    expect(usesLazyload('<img data-srcset="/x-2x.jpg 2x" alt="x">')).toBe(true); // data-srcset alone
    expect(usesLazyload('<div class="card">plain</div>')).toBe(false);
    expect(usesLazyload('<img src="/x.jpg" alt="x" loading="lazy">')).toBe(false); // native, no marker
    expect(usesLazyload(undefined)).toBe(false);
    expect(usesLazyload(null)).toBe(false);
  });

});
