// Shared morph-glass theme tokens for the whole editor backend: frosted cards over a vivid gradient
// shell, soft depth, an indigo focus accent. Promoted from the Settings surface so every view shares
// one vocabulary. Import as `import { glassCard, glassInput, … } from '../theme'`.

/** A frosted card: translucent white over the gradient shell, blurred, with soft depth. */
export const glassCard =
  'rounded-2xl border border-white/50 bg-white/60 shadow-xl shadow-slate-900/5 backdrop-blur-xl';

/** A lighter frosted panel for nested/secondary surfaces. */
export const glassPanel =
  'rounded-xl border border-white/50 bg-white/50 shadow-sm backdrop-blur-xl';

/** A frosted text input/select with an indigo focus ring. */
export const glassInput =
  'w-full rounded-lg border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-300/40';

export const fieldLabel = 'mb-1 block text-xs font-medium text-slate-600';

/** The primary action: indigo→sky gradient, soft glow. Pairs with `cursor-pointer` (global).
 *  `waves-effect waves-light` adds the (white) ripple — see lib/ripple.ts. */
export const primaryButton =
  'waves-effect waves-light inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-indigo-600 to-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition hover:shadow-indigo-600/40 disabled:opacity-60';

/** A quiet secondary action: frosted, lifts to solid white on hover. */
export const ghostButton =
  'waves-effect inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/60 bg-white/50 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-white';

/** A subtle destructive action. */
export const dangerButton =
  'waves-effect inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50';

/** Gradient pill used for section icons / accents. */
export const accentChip =
  'inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-sky-400 text-white shadow-md shadow-indigo-500/30';
