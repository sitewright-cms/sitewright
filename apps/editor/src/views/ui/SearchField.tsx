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
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={className ? `relative ${className}` : 'relative'}>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        aria-label={ariaLabel ?? placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="sw-brand-focus w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-500 focus:bg-white disabled:opacity-60"
      />
    </div>
  );
}
