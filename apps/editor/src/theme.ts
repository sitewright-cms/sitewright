// Shared morph-glass theme tokens for the whole editor backend: frosted cards over a vivid gradient
// shell, soft depth, an indigo focus accent. Promoted from the Settings surface so every view shares
// one vocabulary. Import as `import { glassCard, glassInput, … } from '../theme'`.

/** A frosted card: translucent white over the gradient shell, blurred, with soft depth. */
export const glassCard =
  'rounded-2xl border border-white/50 bg-white/60 shadow-xl shadow-slate-900/5 backdrop-blur-xl';

/** A lighter frosted panel for nested/secondary surfaces. */
export const glassPanel =
  'rounded-xl border border-white/50 bg-white/50 shadow-sm backdrop-blur-xl';

/** A frosted text input/select with a BRAND focus ring (`sw-brand-focus` → border + ring follow --sw-brand-1). */
export const glassInput =
  'sw-brand-focus w-full rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:bg-white';

export const fieldLabel = 'mb-1 block text-xs font-medium text-slate-600';

/** A DaisyUI switch for boolean on/off settings, brand-tinted when on (`sw-toggle` → --sw-brand-1).
 *  The standard control for booleans across the editor — pair with a `<span>` label in a flex row. */
export const toggleInput = 'toggle toggle-sm sw-toggle';

/** The primary action: the brand gradient (configurable via `--sw-brand-1/2`), soft glow. Pairs with
 *  `cursor-pointer` (global). `waves-effect waves-light` adds the (white) ripple — see lib/ripple.ts. */
export const primaryButton =
  'sw-brand-gradient sw-brand-shadow-lg sw-brand-shadow-lg-hover waves-effect waves-light inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white transition disabled:opacity-60';

/** A quiet secondary action: frosted, lifts to solid white on hover. */
export const ghostButton =
  'waves-effect inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/60 bg-white/50 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-white';

/** A subtle destructive action. */
export const dangerButton =
  'waves-effect inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50';

/** Gradient pill used for section icons / accents (the configurable brand gradient). */
export const accentChip =
  'sw-brand-gradient sw-brand-shadow-md inline-flex h-8 w-8 items-center justify-center rounded-xl text-white';

/** The ACTIVE/selected surface: the brand gradient with white text. Replaces an outline ring as the
 *  "this one is current" marker (e.g. the project selector's open project). */
export const gradientSurface =
  'sw-brand-gradient sw-brand-shadow-md text-white';

/** Hover form of {@link gradientSurface}: a row/item that lifts to the brand gradient (white text) on
 *  hover. Put `group` on the element so child text can adopt `group-hover:text-white`. */
export const gradientHover =
  'sw-brand-gradient-hover sw-brand-shadow-md-hover hover:text-white';
