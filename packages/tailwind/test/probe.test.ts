import { describe, it, expect, beforeAll } from 'vitest';
import { compileUtilityCss, createUtilityProbe, knownUtilityVerdict, type UtilityProbe } from '../src/index.js';

// The probe decides which RENDERED classes are worth a slot in the bounded candidate set. It must agree with
// the compiler: everything it accepts compiles to a rule, and nothing the compiler would emit is called junk.

describe('knownUtilityVerdict', () => {
  it('knows an effect scheme compiles (with or without variants) and other platform classes never do', () => {
    expect(knownUtilityVerdict('sw-btn-fx-lift')).toBe(true);
    expect(knownUtilityVerdict('md:sw-nav-line-bottom')).toBe(true);
    expect(knownUtilityVerdict('sw-icon')).toBe(false);
    expect(knownUtilityVerdict('sw-icon-caret-down')).toBe(false);
  });

  it('leaves everything else to the compiler', () => {
    for (const c of ['bg-orange-500', 'wp-image-1234', 'btn', 'md:hover:p-6']) expect(knownUtilityVerdict(c)).toBeUndefined();
  });
});

describe('createUtilityProbe', () => {
  let probe: UtilityProbe;
  beforeAll(async () => {
    probe = await createUtilityProbe({ colors: { brand: '#0a7' } });
  });

  const UTILITIES = ['bg-orange-500', 'md:hover:bg-rose-600/50', 'w-[60%]', '!p-2', '-mt-4', 'dark:bg-black', 'grid', 'card', 'toggle', 'bg-brand', 'sw-btn-fx-lift'];
  const JUNK = ['wp-image-1234', 'aligncenter', 'col-md-6', 'size-large', 'elementor-widget', 'sw-icon', 'modal', 'tab'];

  it('accepts real utilities, DaisyUI components, brand-token utilities and effect schemes', () => {
    expect(probe.produces(UTILITIES)).toEqual(UTILITIES.map(() => true));
  });

  it('rejects junk — including the DaisyUI components the sheet deliberately excludes (modal, tab)', () => {
    expect(probe.produces(JUNK)).toEqual(JUNK.map(() => false));
  });

  it('agrees with the compiler: every accepted class is in the compiled sheet, no junk adds a rule', async () => {
    const accepted = await compileUtilityCss(['card ' + UTILITIES.join(' ')], { colors: { brand: '#0a7' } });
    for (const c of ['.bg-orange-500', '.grid', '.card', '.toggle', '.bg-brand', '.sw-btn-fx-lift']) expect(accepted).toContain(c);
    const withJunk = await compileUtilityCss(['card ' + [...UTILITIES, ...JUNK].join(' ')], { colors: { brand: '#0a7' } });
    expect(withJunk).toBe(accepted);
  });
});
