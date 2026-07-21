import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { gradientHover, gradientSurface } from '../theme';
import { useColorMode, type ColorMode } from '../lib/color-mode';

/** The Appearance segmented-control options (light / dark / follow-OS). */
const COLOR_MODES: { value: ColorMode; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'auto', label: 'Auto', Icon: Monitor },
];

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
  // All roving-focusable menu descendants in DOM order: the 3 appearance radios, then the account items.
  const focusRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { mode, setMode } = useColorMode();

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

  const items: { label: string; onClick: () => void; dividerBefore?: boolean }[] = [
    { label: 'Account Settings', onClick: onAccountSettings },
    { label: 'Logout', onClick: onSignOut, dividerBefore: true },
  ];
  // The appearance radios occupy focus slots [0..RADIO_COUNT), the account items the rest.
  const RADIO_COUNT = COLOR_MODES.length;
  const total = RADIO_COUNT + items.length;

  // On open, focus the first ACCOUNT action (APG menu-button pattern); the Appearance radios sit above
  // it and are reached with ArrowUp (the roving wraps across the whole menu).
  // Focus once per open; RADIO_COUNT is a render-stable constant, so `open` is the only dependency.
  useEffect(() => {
    if (open) focusRefs.current[RADIO_COUNT]?.focus();
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  // Roving focus across EVERY menu descendant — the appearance radios AND the account items — so a
  // keyboard user reaches the switcher with the arrow keys (Up/Down wrap; Home/End jump to the ends).
  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const at = focusRefs.current.findIndex((el) => el === document.activeElement);
    const focus = (i: number) => focusRefs.current[((i % total) + total) % total]?.focus();
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
      focus(total - 1);
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
        className="waves-effect rounded-md p-1.5 text-slate-500 transition hover:bg-white/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-100"
      >
        <UserIcon />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKey}
          className="absolute right-0 z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-slate-800"
        >
          {/* Appearance switcher — a 3-way radio group (light / dark / auto) at the TOP of the menu.
              The radios are `menuitemradio`s in the roving-focus set (see onMenuKey), so the arrow keys
              reach them; selecting one does NOT close the menu (so you can toggle to compare). */}
          <div className="px-3 pb-2 pt-1.5">
            <div className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">Appearance</div>
            <div
              role="group"
              aria-label="Appearance"
              className="flex items-center gap-0.5 rounded-xl border border-white/60 bg-white/50 p-0.5 text-xs font-medium shadow-sm dark:border-white/10 dark:bg-white/5"
            >
              {COLOR_MODES.map(({ value, label, Icon }, ri) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={mode === value}
                  tabIndex={-1}
                  ref={(el) => {
                    // eslint-disable-next-line security/detect-object-injection -- ri is the map index
                    focusRefs.current[ri] = el;
                  }}
                  title={`${label} appearance`}
                  onClick={() => setMode(value)}
                  className={`waves-effect flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1 outline-none transition sw-brand-focus-visible-inset ${
                    mode === value
                      ? `${gradientSurface} font-bold`
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  <Icon aria-hidden className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div role="separator" className="my-1 border-t border-slate-100 dark:border-white/10" />
          {items.map((it, i) => (
            <Fragment key={it.label}>
              {it.dividerBefore && <div role="separator" className="my-1 border-t border-slate-100 dark:border-white/10" />}
              <button
                role="menuitem"
                tabIndex={-1}
                ref={(el) => {
                  focusRefs.current[RADIO_COUNT + i] = el;
                }}
                onClick={pick(it.onClick)}
                className={`waves-effect block w-full cursor-pointer px-3.5 py-2 text-left text-sm text-slate-700 transition dark:text-slate-200 ${gradientHover} focus-visible:bg-slate-100 focus-visible:text-slate-900 dark:focus-visible:bg-white/10 dark:focus-visible:text-slate-100 focus-visible:outline-none sw-brand-focus-visible-inset`}
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
