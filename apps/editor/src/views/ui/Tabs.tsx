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
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onSelect,
  ariaLabel,
  className = '',
}: {
  tabs: ReadonlyArray<TabDef<T>>;
  active: T;
  onSelect: (id: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex flex-wrap items-center gap-1 rounded-xl border border-white/60 bg-white/50 p-1 text-sm font-medium shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/5 ${className}`}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onSelect(t.id)}
          className={`waves-effect inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
            active === t.id
              ? `${gradientSurface} font-bold`
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
