import type { ReactNode } from 'react';
import { gradientSurface } from '../../theme';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

/**
 * A frosted segmented tab control — the same look as the page editor's Code/Content toggle, promoted
 * into a shared primitive so tabbed modals (Project Settings, System Settings) read consistently.
 * The ACTIVE tab lifts to the brand gradient (white text); the rest are muted until hover. Wraps to
 * multiple rows when there are many tabs.
 *
 * `prominent` is the louder form for a view switcher that IS the page's first decision (Statistics: Visits /
 * Search rankings): a SOLID bar rather than a frosted one, bigger targets, and it sizes to its tabs so the
 * caller can centre it.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onSelect,
  ariaLabel,
  className = '',
  variant = 'frosted',
}: {
  tabs: ReadonlyArray<TabDef<T>>;
  active: T;
  onSelect: (id: T) => void;
  ariaLabel: string;
  className?: string;
  variant?: 'frosted' | 'prominent';
}) {
  const prominent = variant === 'prominent';
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`${
        prominent
          ? 'inline-flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 text-base font-semibold shadow-md dark:border-slate-700 dark:bg-slate-800'
          : 'flex flex-wrap items-center gap-1 rounded-xl border border-white/60 bg-white/50 p-1 text-sm font-medium shadow-sm backdrop-blur-3xl dark:border-white/10 dark:bg-white/5'
      } ${className}`}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onSelect(t.id)}
          className={`waves-effect inline-flex items-center transition ${prominent ? 'gap-2 rounded-xl px-5 py-2.5' : 'gap-1.5 rounded-lg px-3 py-1.5'} ${
            active === t.id
              ? `${gradientSurface} font-bold`
              : prominent
                ? 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white'
                : // An INACTIVE tab is still a control the user has to read to navigate, so it gets the
                  // secondary-text pair rather than the muted one — on this frosted, translucent panel
                  // the lighter slate sat close to the surface it floats over.
                  'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
          }`}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}
