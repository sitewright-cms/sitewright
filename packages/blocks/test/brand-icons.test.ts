import { describe, it, expect } from 'vitest';
import { brandIcon, BRAND_ICON_NAMES } from '../src/brand-icons.js';

describe('brand-icons (simple-icons, CC0)', () => {
  it('exposes the expanded curated set of brand slugs', () => {
    // ~270 popular brands (social, dev, design, payments, …); was 20.
    expect(BRAND_ICON_NAMES.length).toBeGreaterThanOrEqual(200);
    for (const slug of ['facebook', 'instagram', 'x', 'github', 'youtube', 'whatsapp', 'signal', 'figma', 'stripe', '500px']) {
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
      // Minimal geometric logos (e.g. Kotlin's "M24 24H0V0h24L12 12Z") are ~20 chars; the
      // bound just guards against an empty/garbage path, not a real short mark.
      expect(icon?.path.length, slug).toBeGreaterThan(10);
      expect(icon?.hex, slug).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
