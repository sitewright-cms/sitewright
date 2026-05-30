import { describe, it, expect } from 'vitest';
import { brandIcon, BRAND_ICON_NAMES } from '../src/brand-icons.js';

describe('brand-icons (simple-icons, CC0)', () => {
  it('exposes a curated set of brand slugs', () => {
    expect(BRAND_ICON_NAMES.length).toBeGreaterThanOrEqual(15);
    for (const slug of ['facebook', 'instagram', 'x', 'github', 'youtube', 'whatsapp']) {
      expect(BRAND_ICON_NAMES).toContain(slug);
    }
  });

  it('returns title, hex color, and a fill path for a known slug', () => {
    const icon = brandIcon('facebook');
    expect(icon?.title).toBe('Facebook');
    expect(icon?.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(icon?.path.length).toBeGreaterThan(50);
  });

  it('returns undefined for an unknown slug', () => {
    expect(brandIcon('not-a-real-brand')).toBeUndefined();
  });

  it('every curated icon has a non-empty path and valid hex', () => {
    for (const slug of BRAND_ICON_NAMES) {
      const icon = brandIcon(slug);
      expect(icon, slug).toBeDefined();
      expect(icon?.path.length, slug).toBeGreaterThan(20);
      expect(icon?.hex, slug).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
