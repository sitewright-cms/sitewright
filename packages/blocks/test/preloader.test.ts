import { describe, it, expect } from 'vitest';
import { customPreloaderHtml, preloaderHtml, usesPreloader, PRELOADER_CSS, PRELOADER_JS } from '../src/preloader.js';

describe('preloaderHtml', () => {
  it('returns empty for none / undefined (disabled)', () => {
    expect(preloaderHtml('none')).toBe('');
    expect(preloaderHtml(undefined)).toBe('');
  });

  it('emits the overlay marker + loading class + effect class', () => {
    const html = preloaderHtml('spinner');
    expect(html).toContain('data-sw-preloader');
    expect(html).toContain('class="sw-loading sw-preloader-spinner"');
    expect(html).toContain('class="pl-spinner"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
  });

  it('preview mode omits the loading class (stays hidden in the editor)', () => {
    const html = preloaderHtml('spinner', { preview: true });
    expect(html).toContain('class="sw-preloader-spinner"');
    expect(html).not.toContain('sw-loading');
  });

  it('non-preview uses the PREFIXED sw-loading state class (not the bare .loading — DaisyUI collision-proof)', () => {
    const html = preloaderHtml('dual');
    expect(html).toContain('class="sw-loading sw-preloader-dual"');
    // must never emit the bare `loading` class TOKEN that DaisyUI's spinner component squats on
    // (token-boundary match: class-start/space before, space/quote after — so `sw-loading` does NOT count)
    expect(html).not.toMatch(/class="(?:[^"]* )?loading(?: |")/);
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
  it('wraps CUSTOM code in the platform overlay, so the runtime can clear it', () => {
    // ★ THE BUG: custom code was emitted RAW and nothing ever cleared it — the runtime that removes
    // `sw-loading` shipped only for a BUILT-IN effect, and custom code only applies when the effect is
    // 'none'. The two conditions are exactly opposite, so the one configuration that emitted an
    // overlay was the one with nothing to remove it, and every page sat behind it forever.
    const html = customPreloaderHtml('<div class="my-spinner"></div>');
    expect(html).toContain('data-sw-preloader');
    expect(html).toContain('sw-loading');
    expect(html).toContain('sw-preloader-custom');
    expect(html).toContain('<div class="my-spinner"></div>');
    // Detected by the same marker gate, so the runtime + CSS ship for it.
    expect(usesPreloader(html)).toBe(true);
    // A custom overlay brings its own look — the platform's frosted background steps aside.
    expect(PRELOADER_CSS).toContain('.sw-preloader-custom{background:none');
    // Nothing to wrap → nothing emitted.
    expect(customPreloaderHtml('   ')).toBe('');
  });

  it('detects the marker, ignores everything else', () => {
    expect(usesPreloader('<div data-sw-preloader></div>')).toBe(true);
    expect(usesPreloader('<div class="loading"></div>')).toBe(false);
    expect(usesPreloader(null)).toBe(false);
    expect(usesPreloader(undefined)).toBe(false);
  });
});

describe('PRELOADER_CSS', () => {
  it('is an OPAQUE brand overlay whose fade is a pure TRANSITION', () => {
    expect(PRELOADER_CSS).toContain('[data-sw-preloader]{position:fixed');
    // ★ OPAQUE, not the old 62% frosted pane. The overlay itself never flickered — what showed
    // THROUGH it cut hard from the old page to the new one, on every navigation. The swap has two
    // sides (the leaving page's overlay, then the arriving document's own overlay from first paint),
    // so a translucent pane reveals the incoming page the instant it renders. Solid on both sides
    // means there is nothing to cut. The blur went with it: a backdrop-filter behind an opaque fill
    // paints nothing and costs a compositing layer.
    expect(PRELOADER_CSS).toContain('background:var(--sw-color-base-100,#fff)');
    expect(PRELOADER_CSS).not.toContain('backdrop-filter:blur');
    expect(PRELOADER_CSS).not.toContain('color-mix(in srgb,var(--sw-color-base-100,#fff) 62%');
    expect(PRELOADER_CSS).toContain('[data-sw-preloader].sw-loading{opacity:1');
    // The fade is a TRANSITION only — so a fresh load (ships already-loading) shows INSTANTLY (no
    // first-paint animation), and the fade only plays when `loading` is toggled afterwards
    // (fade-out on ready; fade-in on the leaving page during an internal-link click).
    expect(PRELOADER_CSS).toContain('transition:opacity .45s ease');
    expect(PRELOADER_CSS).not.toContain('sw-pl-fade'); // no keyframe fade-in (the #370 wrong approach)
    // themed only by brand tokens
    expect(PRELOADER_CSS).toContain('var(--sw-color-primary');
    // respects reduced motion (fade transition dropped + inner animations frozen)
    expect(PRELOADER_CSS).toContain('prefers-reduced-motion:reduce');
  });

  it('uses large (~2x) effect sizes for visibility', () => {
    expect(PRELOADER_CSS).toContain('.pl-spinner{width:116px;height:116px');
    expect(PRELOADER_CSS).toContain('.pl-mark{width:148px;height:148px');
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
    expect(PRELOADER_JS).toContain("classList.remove('sw-loading')");
    expect(PRELOADER_JS).toContain("addEventListener('load',done)");
  });

  it('announces "sw:ready" when it clears so entrance/SVG animations start on preloader-clear', () => {
    expect(PRELOADER_JS).toContain("dispatchEvent(new CustomEvent('sw:ready'))");
    // dispatched from clear() — the same function that removes the loading class.
    expect(PRELOADER_JS).toMatch(/classList\.remove\('sw-loading'\)[^}]*dispatchEvent\(new CustomEvent\('sw:ready'\)\)/);
  });

  it('on an internal-link click: fades the overlay in THEN navigates (no pop); fresh load is instant', () => {
    // Internal-link detection: resolve against the current URL so bare-relative links count; exclude
    // external origins + same-page #hash links.
    expect(PRELOADER_JS).toContain('new URL(href,location.href)');
    expect(PRELOADER_JS).toContain('url.origin!==location.origin');
    expect(PRELOADER_JS).toContain('url.pathname===location.pathname');
    // Take over the navigation, fade in (transition), then navigate on transitionend (with a fallback).
    expect(PRELOADER_JS).toContain('e.preventDefault()');
    expect(PRELOADER_JS).toContain("addEventListener('transitionend'");
    expect(PRELOADER_JS).toContain('window.location.assign(url.href)');
    // reduced motion (or already-covering) → navigate immediately, no fade.
    expect(PRELOADER_JS).toContain('prefers-reduced-motion:reduce');
    expect(PRELOADER_JS).toContain("addEventListener('pageshow'");
    expect(PRELOADER_JS).toContain('MAX'); // failsafe constant
    // guards: no preloader on modified clicks / new-tab / download / external rel
    expect(PRELOADER_JS).toContain('metaKey');
    expect(PRELOADER_JS).toContain('download');
    expect(PRELOADER_JS).toContain('external');
  });
});

describe('custom preloader backdrop (opt-in)', () => {
  it('is OFF by default — custom markup owns its own look', () => {
    const html = customPreloaderHtml('<div class="my-spinner"></div>');
    expect(html).toContain('sw-preloader-custom');
    expect(html).not.toContain('sw-preloader-backdrop');
    // …and the default rule strips the platform surface entirely.
    expect(PRELOADER_CSS).toContain('[data-sw-preloader].sw-preloader-custom{background:none');
  });

  it('paints the platform backdrop when the author opts in', () => {
    const html = customPreloaderHtml('<div class="my-spinner"></div>', { backdrop: true });
    expect(html).toContain('sw-preloader-custom sw-preloader-backdrop');
    // The opt-in rule must be MORE specific than the background:none default above, or it loses.
    expect(PRELOADER_CSS).toContain(
      '[data-sw-preloader].sw-preloader-custom.sw-preloader-backdrop{background:var(--sw-color-base-100,#fff)',
    );
    expect(PRELOADER_CSS.indexOf('.sw-preloader-custom.sw-preloader-backdrop')).toBeGreaterThan(
      PRELOADER_CSS.indexOf('.sw-preloader-custom{background:none'),
    );
  });

  it('keeps the lifecycle contract either way', () => {
    for (const opts of [{}, { backdrop: true }]) {
      const html = customPreloaderHtml('<div></div>', opts);
      expect(html).toContain('data-sw-preloader');
      expect(html).toContain('sw-loading'); // the runtime's show/hide hook
      expect(html).toContain('aria-label="Loading"');
    }
  });

  it('still emits nothing for empty code, opted in or not', () => {
    expect(customPreloaderHtml('   ', { backdrop: true })).toBe('');
    expect(customPreloaderHtml('')).toBe('');
  });
});
