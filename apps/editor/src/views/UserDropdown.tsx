import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { gradientHover } from '../theme';

/** Person glyph for the header account menu. */
function UserIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7v1" />
    </svg>
  );
}

interface UserDropdownProps {
  /** Open the account settings modal (email / password / access keys / security). */
  onAccountSettings: () => void;
  /** Sign the current user out. */
  onSignOut: () => void;
}

/**
 * The header's far-right ACCOUNT menu (person icon → dropdown). Holds "Account Settings" (opens the
 * tabbed account modal) and the "Logout" action — the latter relocated here from the settings gear
 * menu so account actions live under the user icon. Mirrors {@link HeaderSettingsMenu}'s APG
 * menu-button pattern (click-outside + Escape to close, roving focus across items).
 */
export function UserDropdown({ onAccountSettings, onSignOut }: UserDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Move focus into the menu when it opens (APG menu-button pattern).
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  const items: { label: string; onClick: () => void; dividerBefore?: boolean }[] = [
    { label: 'Account Settings', onClick: onAccountSettings },
    { label: 'Logout', onClick: onSignOut, dividerBefore: true },
  ];

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  // Roving focus across the menu items (the trigger stays a single tab stop).
  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const n = items.length;
    const at = itemRefs.current.findIndex((el) => el === document.activeElement);
    const focus = (i: number) => itemRefs.current[((i % n) + n) % n]?.focus();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focus(at + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focus(at - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focus(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focus(n - 1);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Account"
        title="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="waves-effect rounded-md p-1.5 text-slate-500 transition hover:bg-white/70 hover:text-slate-900"
      >
        <UserIcon />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKey}
          className="absolute right-0 z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
        >
          {items.map((it, i) => (
            <Fragment key={it.label}>
              {it.dividerBefore && <div role="separator" className="my-1 border-t border-slate-100" />}
              <button
                role="menuitem"
                tabIndex={-1}
                ref={(el) => {
                  // eslint-disable-next-line security/detect-object-injection -- i is the map index
                  itemRefs.current[i] = el;
                }}
                onClick={pick(it.onClick)}
                className={`waves-effect block w-full cursor-pointer px-3.5 py-2 text-left text-sm text-slate-700 transition ${gradientHover} focus-visible:bg-slate-100 focus-visible:text-slate-900 focus-visible:outline-none sw-brand-focus-visible-inset`}
              >
                {it.label}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
