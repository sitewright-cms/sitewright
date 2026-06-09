import { describe, it, expect } from 'vitest';
import { usesDaisyComponents, daisyThemeVars, DAISY_THEME_DEFAULTS } from '../src/daisy.js';

describe('usesDaisyComponents', () => {
  it('detects component stems, modifiers, and variant-prefixed classes', () => {
    expect(usesDaisyComponents(['btn'])).toBe(true);
    expect(usesDaisyComponents(['btn-primary'])).toBe(true);
    expect(usesDaisyComponents(['card-body'])).toBe(true);
    expect(usesDaisyComponents(['hover:btn', 'md:card'])).toBe(true); // variant prefixes stripped
  });

  it('detects DaisyUI surface colors used via any utility prefix', () => {
    expect(usesDaisyComponents(['bg-base-200'])).toBe(true);
    expect(usesDaisyComponents(['text-base-content'])).toBe(true);
    expect(usesDaisyComponents(['border-base-300'])).toBe(true);
  });

  it('does not fire on pure-Tailwind utilities', () => {
    expect(usesDaisyComponents(['flex', 'gap-4', 'px-6', 'bg-primary', 'text-slate-700'])).toBe(false);
    expect(usesDaisyComponents([])).toBe(false);
  });
});

describe('daisyThemeVars', () => {
  it('starts from the DaisyUI light defaults', () => {
    const vars = daisyThemeVars({});
    expect(vars['--color-base-100']).toBe(DAISY_THEME_DEFAULTS['--color-base-100']);
    expect(vars['--color-primary']).toBe(DAISY_THEME_DEFAULTS['--color-primary']);
  });

  it('matches the pinned DaisyUI light-theme shape (drift guard)', () => {
    expect(Object.keys(DAISY_THEME_DEFAULTS)).toHaveLength(28);
    expect(DAISY_THEME_DEFAULTS['--color-base-100']).toBe('oklch(100% 0 0)');
    expect(DAISY_THEME_DEFAULTS['--radius-field']).toBe('0.25rem');
  });

  it('overrides primary/secondary/accent/neutral from the brand + computes a readable -content (WCAG)', () => {
    const vars = daisyThemeVars({ colors: { primary: '#111827', secondary: '#fde047', accent: '#166534', neutral: '#f8fafc' } });
    expect(vars['--color-primary']).toBe('#111827');
    expect(vars['--color-primary-content']).toBe('#ffffff'); // dark bg → white text
    expect(vars['--color-secondary']).toBe('#fde047');
    expect(vars['--color-secondary-content']).toBe('#1f2937'); // light bg → dark text
    expect(vars['--color-accent-content']).toBe('#ffffff'); // dark green → white text
    expect(vars['--color-neutral']).toBe('#f8fafc');
    expect(vars['--color-neutral-content']).toBe('#1f2937'); // light neutral → dark text
  });

  it('expands 3-digit hex when computing contrast', () => {
    const vars = daisyThemeVars({ colors: { primary: '#fff' } });
    expect(vars['--color-primary-content']).toBe('#1f2937'); // #fff is light → dark text
  });

  it('keeps the default -content when the brand color is not a hex value', () => {
    const vars = daisyThemeVars({ colors: { primary: 'oklch(55% 0.2 250)' } });
    expect(vars['--color-primary']).toBe('oklch(55% 0.2 250)');
    expect(vars['--color-primary-content']).toBe(DAISY_THEME_DEFAULTS['--color-primary-content']);
  });

  it('maps custom brand color tokens and fonts, skipping unsafe token names', () => {
    const vars = daisyThemeVars({ colors: { brandblue: '#1d4ed8' }, fonts: { display: 'Inter' } });
    expect(vars['--color-brandblue']).toBe('#1d4ed8');
    expect(vars['--font-display']).toBe('Inter');
    expect(daisyThemeVars({ colors: { 'evil}html{x': '#fff' } })['--color-evil}html{x']).toBeUndefined();
  });
});
