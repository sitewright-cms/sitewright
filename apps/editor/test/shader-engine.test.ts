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

describe('★ the fallback is the OPEN PROJECT’s brand, not the platform’s', () => {
  // The studio previews colours the site will actually use. Resolving every project's tokens to the
  // platform's own indigo/sky made the preview a picture of the wrong site — right only for the one
  // case where there is no project to read.
  const project = { primary: '#ff0000', secondary: '#00ff00', neutral: '#0000ff' };

  it('uses the project’s colour for a CI token when a project is open', () => {
    expect(slotCssExpr('primary', false, project)).toBe('var(--sw-color-primary, #ff0000)');
    expect(slotCssExpr('secondary', false, project)).toBe('var(--sw-color-secondary, #00ff00)');
  });

  it('falls back to the PLATFORM palette when no project is open', () => {
    // `undefined` is the no-project signal; the platform defaults are then the only honest answer.
    expect(slotCssExpr('primary', false)).toBe('var(--sw-color-primary, #4f46e5)');
    expect(slotCssExpr('primary', false, undefined)).toBe('var(--sw-color-primary, #4f46e5)');
  });

  it('falls back per TOKEN, so a project missing one still resolves the rest', () => {
    // A partial map must not blank the tokens it lacks — each slot is answered independently.
    expect(slotCssExpr('accent', false, project)).toBe('var(--sw-color-accent, #f59e0b)'); // platform
    expect(slotCssExpr('primary', false, project)).toBe('var(--sw-color-primary, #ff0000)'); // project
  });

  it('does not let a project override `auto` or a literal colour', () => {
    // `auto` tracks the theme surface and a literal is the author's own choice — neither is a CI token.
    expect(slotCssExpr('auto', true, project)).toBe('var(--sw-color-base-100, #0b0b14)');
    expect(slotCssExpr('#abcdef', false, project)).toBe('#abcdef');
  });

  it('the real `--sw-color-*` still wins wherever they exist', () => {
    // The var() wrapper is unchanged: on a published site the site's own token beats any fallback.
    expect(slotCssExpr('primary', false, project).startsWith('var(--sw-color-primary,')).toBe(true);
  });
});
