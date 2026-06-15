import { describe, it, expect } from 'vitest';
import { preloaderHtml, usesPreloader, PRELOADER_CSS, PRELOADER_JS } from '../src/preloader.js';

describe('preloaderHtml', () => {
  it('returns empty for none / undefined (disabled)', () => {
    expect(preloaderHtml('none')).toBe('');
    expect(preloaderHtml(undefined)).toBe('');
  });

  it('emits the overlay marker + loading class + effect class', () => {
    const html = preloaderHtml('spinner');
    expect(html).toContain('data-sw-preloader');
    expect(html).toContain('class="loading sw-preloader-spinner"');
    expect(html).toContain('class="pl-spinner"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
  });

  it('preview mode omits the loading class (stays hidden in the editor)', () => {
    const html = preloaderHtml('spinner', { preview: true });
    expect(html).toContain('class="sw-preloader-spinner"');
    expect(html).not.toContain('loading');
  });

  it('every effect produces detectable, distinct markup', () => {
    for (const fx of ['spinner', 'dual', 'dots', 'bars', 'pulse', 'progress', 'logo-pulse', 'logo-draw', 'logo-sheen'] as const) {
      const html = preloaderHtml(fx);
      expect(usesPreloader(html), fx).toBe(true);
      expect(html, fx).toContain(`sw-preloader-${fx}`);
    }
  });

  it('logo effects use company.logo as an <img> when provided', () => {
    const html = preloaderHtml('logo-pulse', { logo: '/_assets/x/logo.svg' });
    expect(html).toContain('<img class="pl-logo-img" src="/_assets/x/logo.svg"');
    expect(html).not.toContain('<svg'); // the built-in mark is not used when a logo is supplied
  });

  it('logo effects fall back to the built-in mark when no logo is set', () => {
    const html = preloaderHtml('logo-pulse');
    expect(html).toContain('<svg class="pl-mark"');
    expect(html).not.toContain('<img');
  });

  it('logo-draw always uses the inline mark (a raster/img logo cannot be stroke-drawn)', () => {
    const html = preloaderHtml('logo-draw', { logo: '/_assets/x/logo.png' });
    expect(html).toContain('<svg class="pl-mark"');
    expect(html).not.toContain('<img');
  });

  it('escapes a logo url to keep the attribute safe', () => {
    const html = preloaderHtml('logo-sheen', { logo: '/a"><b>x' });
    expect(html).not.toContain('"><b>');
    expect(html).toContain('&quot;');
  });
});

describe('usesPreloader', () => {
  it('detects the marker, ignores everything else', () => {
    expect(usesPreloader('<div data-sw-preloader></div>')).toBe(true);
    expect(usesPreloader('<div class="loading"></div>')).toBe(false);
    expect(usesPreloader(null)).toBe(false);
    expect(usesPreloader(undefined)).toBe(false);
  });
});

describe('PRELOADER_CSS', () => {
  it('is a frosted, half-transparent brand overlay that fades out when not loading', () => {
    expect(PRELOADER_CSS).toContain('[data-sw-preloader]{position:fixed');
    expect(PRELOADER_CSS).toContain('backdrop-filter:blur');
    expect(PRELOADER_CSS).toContain('color-mix(in srgb,var(--sw-color-base-100');
    expect(PRELOADER_CSS).toContain('[data-sw-preloader].loading{opacity:1');
    // themed only by brand tokens
    expect(PRELOADER_CSS).toContain('var(--sw-color-primary');
    // respects reduced motion
    expect(PRELOADER_CSS).toContain('prefers-reduced-motion:reduce');
  });

  it('ships a rule for every effect', () => {
    for (const fx of ['spinner', 'dual', 'dots', 'bars', 'pulse', 'progress'] as const) {
      expect(PRELOADER_CSS, fx).toContain(`.pl-${fx}`);
    }
    expect(PRELOADER_CSS).toContain('.pl-logo-pulse');
    expect(PRELOADER_CSS).toContain('.pl-logo-draw');
    expect(PRELOADER_CSS).toContain('.pl-logo-sheen');
  });
});

describe('PRELOADER_JS', () => {
  it('shows on load, clears on window load, and locks page scroll', () => {
    expect(PRELOADER_JS).toContain("docEl.style.overflow='hidden'");
    expect(PRELOADER_JS).toContain("classList.remove('loading')");
    expect(PRELOADER_JS).toContain("addEventListener('load',done)");
  });

  it('re-shows on ANY internal-link click (same-origin resolve) and restores on bfcache, with a failsafe', () => {
    // Resolves the href against the current URL so bare-relative links (what {{sw-url}} emits) count,
    // and excludes external origins + same-page #hash links.
    expect(PRELOADER_JS).toContain('new URL(href,location.href)');
    expect(PRELOADER_JS).toContain('url.origin!==location.origin');
    expect(PRELOADER_JS).toContain('url.pathname===location.pathname');
    expect(PRELOADER_JS).toContain("addEventListener('pageshow'");
    expect(PRELOADER_JS).toContain('MAX'); // failsafe constant
    // guards: no preloader on modified clicks / new-tab / download / external rel
    expect(PRELOADER_JS).toContain('metaKey');
    expect(PRELOADER_JS).toContain('download');
    expect(PRELOADER_JS).toContain('external');
  });
});
