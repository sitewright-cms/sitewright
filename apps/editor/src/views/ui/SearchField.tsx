import { Search } from 'lucide-react';

/**
 * The shared search field — a prominent, unmistakable search box (solid white, defined border, a
 * magnifier glyph) so it doesn't get lost against the frosted panels. Use everywhere a list/grid is
 * filtered by text. `className` is for the OUTER wrapper (e.g. a width like `w-44`).
 */
export function SearchField({
  value,
  onChange,
  placeholder = 'Search…',
  ariaLabel,
  autoFocus,
  disabled,
  className,
  controls,
  activeDescendant,
  onEnter,
  noFocusRing,
  dense,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  /** Drop the brand focus ring. For a field that sits INLINE with toolbar buttons, where the ring
   *  reads as a second, competing control rather than as focus. Focus stays visible via the
   *  browser's own caret + the field's border. */
  noFocusRing?: boolean;
  /**
   * Tighter gutters, for a NARROW field whose placeholder carries real information.
   *
   * ★ Measured, not guessed: at the default `pl-9 pr-3` a 160px field clips "Search 32 pages" to
   * "Search 32 page". The box model says it fits (105px of text in 110px of space) — an `<input>`
   * reserves more than its content box admits, so the arithmetic said yes and the rendered pixels
   * said no. Trust the screenshot.
   */
  dense?: boolean;
  /** Enter pressed in the field — for lists where the top result is the obvious target. */
  onEnter?: () => void;
  /** Combobox use: the id of the listbox this field filters (`aria-controls`). */
  controls?: string;
  /** Combobox use: the id of the visually-active option (`aria-activedescendant`) — so a screen
   *  reader announces the keyboard-highlighted row while focus stays in this input. */
  activeDescendant?: string;
}) {
  return (
    <div className={className ? `relative ${className}` : 'relative'}>
      <Search aria-hidden className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400 ${dense ? 'left-2' : 'left-3'}`} />
      <input
        type="search"
        aria-label={ariaLabel ?? placeholder}
        aria-controls={controls}
        aria-activedescendant={activeDescendant}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={
          onEnter &&
          ((e) => {
            // `type="search"` also fires Enter to clear via the native ✕; only a real Enter counts.
            if (e.key !== 'Enter') return;
            e.preventDefault();
            onEnter();
          })
        }
        placeholder={placeholder}
        className={`${noFocusRing ? '' : 'sw-brand-focus '}${dense ? 'pl-7 pr-2 ' : 'pl-9 pr-3 '}w-full rounded-lg border border-slate-300 bg-white py-2.5 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-500 focus:bg-white disabled:opacity-60 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:bg-slate-900`}
      />
    </div>
  );
}
