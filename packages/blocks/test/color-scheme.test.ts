import { describe, expect, it } from 'vitest';
import { colorSchemeCss, colorSchemeHtmlAttr } from '../src/color-scheme.js';

describe('colorSchemeCss — opt-in dark token block', () => {
  const css = colorSchemeCss();

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

  it('has BOTH paths: forced [data-sw-scheme="dark"] and prefers-color-scheme that yields to it', () => {
    expect(css).toContain(':root[data-sw-scheme="dark"]{');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    // the auto path must NOT apply when an explicit data-sw-scheme is set (pinned default / toggle wins)
    expect(css).toContain(':root:not([data-sw-scheme]){');
  });

  it('uses its OWN data-sw-scheme attribute, not DaisyUI\'s data-theme', () => {
    expect(css).not.toContain('[data-theme');
  });

  it('does not touch the brand roles (primary/secondary/accent kept; brand-shade tuning is a follow-up)', () => {
    expect(css).not.toContain('--color-primary');
    expect(css).not.toContain('--sw-color-primary');
  });
});

describe('colorSchemeHtmlAttr — server-pinned default scheme', () => {
  it('pins a forced light/dark default onto <html data-sw-scheme>', () => {
    expect(colorSchemeHtmlAttr('light')).toBe(' data-sw-scheme="light"');
    expect(colorSchemeHtmlAttr('dark')).toBe(' data-sw-scheme="dark"');
  });
  it('emits nothing for auto/undefined (prefers-color-scheme governs)', () => {
    expect(colorSchemeHtmlAttr('auto')).toBe('');
    expect(colorSchemeHtmlAttr(undefined)).toBe('');
  });
});
