import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { gradientHover } from '../theme';

/** Gear glyph for the header settings menu. */
function GearIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

interface HeaderSettingsMenuProps {
  /** A project is open (gates the project-scoped items). */
  inProject: boolean;
  /** The current project's role is a restricted client/member (hides owner items). */
  isClient: boolean;
  /** A platform/system admin (gates System Settings). */
  isInstanceAdmin: boolean;
  onPublishDeploy: () => void;
  onSystemSettings: () => void;
  onClients: () => void;
  onTeam: () => void;
  onSignOut: () => void;
}

/**
 * The header's far-right SETTINGS menu (gear icon → dropdown). Unifies what used to be the ⋮
 * "Publish & deploy options", the Admin tab (Clients/Team/Access), the admin "System Settings",
 * and Sign out. Each item is shown only in its valid context; every target opens as a modal.
 * Always present when signed in, so Sign out + System Settings never disappear with no project open.
 */
export function HeaderSettingsMenu({
  inProject,
  isClient,
  isInstanceAdmin,
  onPublishDeploy,
  onSystemSettings,
  onClients,
  onTeam,
  onSignOut,
}: HeaderSettingsMenuProps) {
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

  const owner = inProject && !isClient;
  // In project order: Publish & Deploy, System Settings, Clients, Team — each gated — then a divider
  // and the always-present Sign out (one flat list so arrow-key focus crosses the rule). Access keys
  // moved to the user/account menu (the person icon next to this gear).
  const items: { label: string; onClick: () => void; dividerBefore?: boolean }[] = [
    ...(
      [
        { label: 'Publish & Deploy Options', onClick: onPublishDeploy, show: owner },
        { label: 'System Settings', onClick: onSystemSettings, show: isInstanceAdmin },
        { label: 'Clients', onClick: onClients, show: owner },
        // Team manages the instance-wide platform team via admin-only APIs (/admin/users) — admins only.
        { label: 'Team', onClick: onTeam, show: isInstanceAdmin },
      ] as { label: string; onClick: () => void; show: boolean }[]
    )
      .filter((i) => i.show)
      .map(({ label, onClick }) => ({ label, onClick })),
  ];
  const all = [...items, { label: 'Sign out', onClick: onSignOut, dividerBefore: items.length > 0 }];

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  // Roving focus across the menu items (the gear button stays a single tab stop).
  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const n = all.length;
    if (n === 0) return;
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
        aria-label="Settings"
        title="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="waves-effect rounded-md p-1.5 text-slate-500 transition hover:bg-white/70 hover:text-slate-900"
      >
        <GearIcon />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Settings"
          onKeyDown={onMenuKey}
          className="absolute right-0 z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
        >
          {all.map((it, i) => (
            // Fragment (no DOM node) keeps each menuitem a DIRECT child of role="menu".
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
                // Usual hover (gradient) + ripple on click. focus-VISIBLE (keyboard only) so the
                // first item isn't highlighted when the menu is opened by mouse (programmatic focus).
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
