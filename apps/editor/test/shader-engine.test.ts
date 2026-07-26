import { describe, it, expect } from 'vitest';
import { slotCssExpr } from '../src/lib/shader-engine';
import { DEFAULT_BRAND_COLORS } from '@sitewright/schema';

// slotCssExpr is the pure (DOM-free) core of resolveSlot — it's what makes the picker preview
// distinguishable in the editor, where --sw-color-* are NOT defined (they exist only on rendered site
// documents). jsdom can't evaluate var() (getComputedStyle returns the literal string), so the RGB
// resolution itself isn't unit-testable here; the CSS EXPRESSION is, and that's where the regression
// (all CI slots collapsing to the inherited color) lived.
describe('slotCssExpr — CI-token fallbacks keep the preview distinguishable', () => {
  it('CI tokens carry the shared DEFAULT_BRAND_COLORS fallback, and the three brand defaults DIFFER', () => {
    expect(slotCssExpr('primary', false)).toBe(`var(--sw-color-primary, ${DEFAULT_BRAND_COLORS.primary})`);
    expect(slotCssExpr('secondary', false)).toBe(`var(--sw-color-secondary, ${DEFAULT_BRAND_COLORS.secondary})`);
    expect(slotCssExpr('neutral', false)).toBe(`var(--sw-color-neutral, ${DEFAULT_BRAND_COLORS.neutral})`);
    // the actual regression guard: the default slots must not all resolve to the same fallback
    const defaults = [DEFAULT_BRAND_COLORS.primary, DEFAULT_BRAND_COLORS.secondary, DEFAULT_BRAND_COLORS.neutral];
    expect(new Set(defaults).size).toBe(3);
  });

  it('auto → the base-surface token with a theme-appropriate fallback', () => {
    expect(slotCssExpr('auto', false)).toBe('var(--sw-color-base-100, #ffffff)');
    expect(slotCssExpr('auto', true)).toBe('var(--sw-color-base-100, #0b0b14)');
    expect(slotCssExpr('AUTO', false)).toBe('var(--sw-color-base-100, #ffffff)'); // case-insensitive
  });

  it('a literal hex / rgb() color passes through untouched (no var wrapping)', () => {
    expect(slotCssExpr('#123456', false)).toBe('#123456');
    expect(slotCssExpr('rgb(1,2,3)', false)).toBe('rgb(1,2,3)');
  });

  it('an unknown token still gets a neutral fallback (never a bare, inheritable var)', () => {
    expect(slotCssExpr('made-up', false)).toBe('var(--sw-color-made-up, #888888)');
  });
});
