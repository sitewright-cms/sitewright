import { describe, it, expect } from 'vitest';
import { renderIconSvg } from '../src/icon-render.js';
import { PHOSPHOR_WEIGHTS } from '../src/phosphor-icons.js';

/**
 * Upstream icon sets retire marks — simple-icons dropped LinkedIn and Slack at the brands' request, and
 * Lucide 1.x dropped its whole brand set. Both times the name kept being written into published pages
 * while the artwork behind it vanished, so these pin the names rather than the artwork.
 */
describe('vendored LinkedIn', () => {
  it('draws the bare name at every weight, with no enclosing tile', () => {
    for (const w of PHOSPHOR_WEIGHTS) {
      const svg = renderIconSvg(`linkedin:${w}`);
      expect(svg, w).toContain(`sw-icon-${w}`);
      expect(svg, w).toContain('viewBox="0 0 256 256"');
      // Phosphor's own `linkedin-logo` is the TILED cut; the bare name must not pick it up.
      expect(svg, w).not.toContain('sw-icon-linkedin-logo');
    }
  });

  it('draws the tiled cut under brand:', () => {
    const svg = renderIconSvg('brand:linkedin');
    expect(svg).toContain('sw-icon-brand-linkedin');
    expect(svg).toContain('viewBox="0 0 24 24"');
  });

  it('gives the bare and tiled cuts genuinely different artwork', () => {
    expect(renderIconSvg('linkedin:fill')).not.toBe(renderIconSvg('brand:linkedin'));
  });
});

describe('retired slugs keep rendering', () => {
  it.each([
    ['twitter', 'sw-icon-brand-x'],
    ['chrome', 'sw-icon-brand-googlechrome'],
    ['chromium', 'sw-icon-brand-googlechrome'],
  ])('brand:%s resolves to its successor', (slug, hook) => {
    expect(renderIconSvg(`brand:${slug}`)).toContain(hook);
  });

  it.each(['pocket', 'rail-symbol'])('%s falls back to an equivalent glyph', (name) => {
    expect(renderIconSvg(name)).not.toBe('');
  });
});

describe('bare brand names survived the Lucide brand-set removal', () => {
  // These are the footer staples. Before the fallback they rendered a Lucide outline; Lucide 1.x has
  // none, so without `<name>-logo` they would silently render nothing on live pages.
  it.each(['facebook', 'instagram', 'youtube', 'github', 'gitlab', 'slack', 'twitch', 'figma'])(
    '%s still draws',
    (name) => {
      expect(renderIconSvg(name)).not.toBe('');
    },
  );

  it('carries the requested weight through the logo fallback', () => {
    expect(renderIconSvg('slack:bold')).toContain('sw-icon-bold');
  });
});
