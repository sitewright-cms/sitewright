import { describe, expect, it } from 'vitest';
import {
  themeCss,
  themeHtmlAttr,
  usesThemeToggle,
  THEME_TOGGLE_CSS,
  THEME_TOGGLE_JS,
} from '../src/theme-mode.js';

describe('themeCss — opt-in dark token block', () => {
  const css = themeCss();

  it('overrides the neutral tokens in BOTH namespaces (DaisyUI --color-* AND platform --sw-color-*)', () => {
    for (const token of ['--color-base-100', '--color-base-200', '--color-base-300', '--color-base-content']) {
      expect(css, token).toContain(token);
      expect(css, `sw ${token}`).toContain(token.replace('--color-', '--sw-color-'));
    }
  });

  it('uses dark neutral values + sets color-scheme:dark for native controls', () => {
    expect(css).toContain('oklch(25.33% 0.016 252.42)'); // dark base-100
    expect(css).toContain('oklch(97.807% 0.029 256.847)'); // light base-content
    expect(css).toContain('color-scheme:dark');
  });

  it('has BOTH paths: forced [data-sw-theme="dark"] and prefers-color-scheme that yields to it', () => {
    expect(css).toContain(':root[data-sw-theme="dark"]{');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    // the auto path must NOT apply when an explicit data-sw-theme is set (pinned default / toggle wins)
    expect(css).toContain(':root:not([data-sw-theme]){');
  });

  it('uses its OWN data-sw-theme attribute, not DaisyUI\'s data-theme', () => {
    expect(css).not.toContain('[data-theme');
  });

  it('the no-arg form is neutral-only — no brand tokens (backwards compatible)', () => {
    expect(css).not.toContain('--sw-color-primary');
    expect(css).not.toContain('--sw-color-accent');
    expect(css).not.toContain('-primary-content');
  });
});

describe('themeCss(brandColors) — dark-tuned brand shades + content tokens', () => {
  // primary indigo L≈0.51 (below the 0.6 floor → lifted), accent amber L≈0.77 (already above).
  const colors = { primary: '#4f46e5', secondary: '#0ea5e9', accent: '#f59e0b' } as const;
  const css = themeCss(colors);

  it('lifts a dark brand fill to the lightness floor in the dark block, preserving hue', () => {
    expect(css).toMatch(/--sw-color-primary:oklch\(0\.62 [\d.]+ 276/);
  });

  it('leaves an already-light brand fill above the floor (not pulled down)', () => {
    const m = /--sw-color-accent:oklch\(([\d.]+) /.exec(css);
    expect(m, 'accent fill emitted').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0.6);
  });

  it('derives text-on-brand --sw-color-*-content for BOTH light (:root) and dark', () => {
    // a leading light :root{} block carries the light content tokens
    expect(css).toMatch(/^:root\{[^}]*--sw-color-primary-content:/);
    // the dark block also carries a (possibly different) content token
    expect(css).toMatch(/data-sw-theme="dark"\]\{[^}]*--sw-color-primary-content:/);
  });

  it('does NOT touch the DaisyUI --color-* brand namespace (it is a static default palette)', () => {
    expect(css).not.toContain('--color-primary');
    expect(css).not.toContain('--color-secondary');
    expect(css).not.toContain('--color-accent');
  });

  it('skips non-hex / absent roles gracefully but still emits the neutral block', () => {
    const partial = themeCss({ primary: 'rebeccapurple' });
    expect(partial).not.toContain('--sw-color-primary:oklch');
    expect(partial).toContain('--sw-color-base-100'); // neutral block intact
  });
});

describe('themeHtmlAttr — server-pinned default scheme', () => {
  it('pins a forced light/dark default onto <html data-sw-theme>', () => {
    expect(themeHtmlAttr('light')).toBe(' data-sw-theme="light"');
    expect(themeHtmlAttr('dark')).toBe(' data-sw-theme="dark"');
  });
  it('emits nothing for auto/undefined (prefers-color-scheme governs)', () => {
    expect(themeHtmlAttr('auto')).toBe('');
    expect(themeHtmlAttr(undefined)).toBe('');
  });
});

describe('usesThemeToggle — only-used-ships marker', () => {
  it('detects the rendered toggle marker', () => {
    expect(usesThemeToggle('<button data-sw-theme-toggle aria-label="x"></button>')).toBe(true);
  });
  it('is false for unrelated / empty html', () => {
    expect(usesThemeToggle('<button class="btn">Go</button>')).toBe(false);
    expect(usesThemeToggle('')).toBe(false);
    expect(usesThemeToggle(null)).toBe(false);
    expect(usesThemeToggle(undefined)).toBe(false);
  });
});

describe('THEME_TOGGLE_CSS — CSS-driven sun/moon icon picker', () => {
  it('styles the button + both icon hooks', () => {
    expect(THEME_TOGGLE_CSS).toContain('.sw-theme-toggle{');
    expect(THEME_TOGGLE_CSS).toContain('.sw-tt-sun');
    expect(THEME_TOGGLE_CSS).toContain('.sw-tt-moon');
  });
  it('picks the icon by scheme — forced [data-sw-theme] AND an auto prefers-color-scheme path', () => {
    expect(THEME_TOGGLE_CSS).toContain(':root[data-sw-theme="dark"] .sw-theme-toggle .sw-tt-sun{display:block}');
    expect(THEME_TOGGLE_CSS).toContain('@media (prefers-color-scheme: dark)');
    expect(THEME_TOGGLE_CSS).toContain(':root:not([data-sw-theme]) .sw-theme-toggle .sw-tt-sun{display:block}');
  });
});

describe('THEME_TOGGLE_JS — no-flash + click runtime', () => {
  it('persists + re-applies the visitor choice under the sw-theme key', () => {
    expect(THEME_TOGGLE_JS).toContain("localStorage.getItem(KEY)");
    expect(THEME_TOGGLE_JS).toContain("localStorage.setItem(KEY,next)");
    expect(THEME_TOGGLE_JS).toContain("var KEY='sw-theme'");
  });
  it('drives the platform data-sw-theme attribute (not DaisyUI data-theme) + reads the OS preference', () => {
    expect(THEME_TOGGLE_JS).toContain("setAttribute('data-sw-theme'");
    expect(THEME_TOGGLE_JS).not.toContain('data-theme');
    expect(THEME_TOGGLE_JS).toContain('prefers-color-scheme: dark');
  });
  it('wires the toggle buttons + honours reduced motion for the View-Transition cross-fade', () => {
    expect(THEME_TOGGLE_JS).toContain('[data-sw-theme-toggle]');
    expect(THEME_TOGGLE_JS).toContain('startViewTransition');
    expect(THEME_TOGGLE_JS).toContain('prefers-reduced-motion: reduce');
  });
});
