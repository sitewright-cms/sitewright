import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { OVERLAY_STACK } from './overlay';

/**
 * A menu anchored to a POINT — opened by right-click, long-press, or the keyboard's context-menu key.
 *
 * The header's settings dropdown is anchored to its own button and can position itself with CSS. A
 * context menu appears wherever the pointer was, so it positions absolutely and has to clamp itself
 * back inside the viewport near an edge.
 *
 * ★ It closes on SCROLL. That is not politeness: the pages list is virtualised, so the row this menu
 * describes unmounts as soon as it leaves the rendered window. A menu still floating over the list
 * would be acting on a page the author can no longer see.
 */

export interface ContextMenuItem {
  kind: 'item';
  label: string;
  onSelect: () => void;
  /** Destructive (delete) — styled apart from the neutral items. */
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuSubmenu {
  kind: 'submenu';
  label: string;
  items: ContextMenuItem[];
}

export type ContextMenuRow = ContextMenuItem | ContextMenuSubmenu | { kind: 'divider' };

interface Props {
  /** Viewport coordinates to open at (the pointer, or the row for a keyboard open). */
  at: { x: number; y: number };
  /** Accessible name for the menu — what it acts on, e.g. the page title. */
  label: string;
  rows: ContextMenuRow[];
  onClose: () => void;
}

/** Keep the menu on screen when it is opened near the right or bottom edge. */
const MENU_W = 232;
const EDGE_PAD = 8;
/** Assumed height until the real one is measured, so the very first paint is already clamped. */
const MENU_MIN_H = 160;
/** Page movement tolerated before the anchor is considered stale — below this it is drift, not a scroll. */
const SCROLL_CLOSE_PX = 4;
/** Submenu width — must match the `w-56` on the panel (14rem). */
const SUB_W = 224;
/** Gap between the parent menu's edge and the submenu. */
const SUB_GAP = 4;
/** Assumed submenu height until measured, so its first paint is already clamped. */
const SUB_MIN_H = 120;
/**
 * Grace period before a submenu closes because the pointer left its row. The submenu is a SIBLING
 * overlay, not a child of the row, so travelling to it crosses the rows in between — without this
 * the menu would shut in the gap and the submenu could never be reached with the mouse.
 */
const SUB_CLOSE_MS = 220;

/** True on a device with a real hovering pointer. Hover-to-open is a desktop affordance: on touch
 *  the same gesture is a tap, and a submenu that sprang open under a finger would be a misfire. */
function hasHover(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
    : false;
}

/**
 * The flyout for a {@link ContextMenuSubmenu}.
 *
 * ★ It is `fixed` and positioned against the VIEWPORT, not `absolute left-full` against its row.
 * Absolute placement always opened it to the right of the parent, so a menu raised near the right
 * edge — or a long list opened low on the screen — ran straight off the viewport with no way to
 * reach the items. Here it flips to the parent's left when the right side won't hold it, and its top
 * is clamped so the last item stays on screen.
 */
function SubmenuPanel({
  label,
  items,
  anchor,
  menuRect,
  itemClass,
  onRun,
  onKeyDown,
  onPointerEnter,
  onPointerLeave,
}: {
  label: string;
  items: ContextMenuItem[];
  /** The submenu row's own rect — supplies the vertical anchor. */
  anchor: DOMRect;
  /** The parent menu's rect — supplies the horizontal side to open from. */
  menuRect: DOMRect;
  itemClass: (danger?: boolean, disabled?: boolean) => string;
  onRun: (fn: () => void) => () => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    setHeight(ref.current?.offsetHeight ?? 0);
  }, [items.length]);

  // Right of the parent by preference; flip left when that would overflow. If NEITHER side fits
  // (a very narrow window), the clamp below still keeps it fully on screen.
  const rightLeft = menuRect.right + SUB_GAP;
  const flip = rightLeft + SUB_W > window.innerWidth - EDGE_PAD;
  const left = Math.max(EDGE_PAD, Math.min(flip ? menuRect.left - SUB_W - SUB_GAP : rightLeft, window.innerWidth - SUB_W - EDGE_PAD));
  const top = Math.max(EDGE_PAD, Math.min(anchor.top, window.innerHeight - (height || SUB_MIN_H) - EDGE_PAD));

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{ left, top, width: SUB_W }}
      className="fixed z-[62] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-2xl dark:border-white/10 dark:bg-slate-800"
    >
      {items.map((sub) => (
        <button
          key={sub.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          disabled={sub.disabled}
          onClick={onRun(sub.onSelect)}
          className={itemClass(sub.danger, sub.disabled)}
        >
          {sub.label}
        </button>
      ))}
    </div>
  );
}

export function ContextMenu({ at, label, rows, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [height, setHeight] = useState(0);

  const interactive = rows.filter((r): r is ContextMenuItem | ContextMenuSubmenu => r.kind !== 'divider');

  // Join the overlay stack so the global Escape shortcut unwinds this before any drawer behind it.
  useEffect(() => {
    const token = {};
    OVERLAY_STACK.push(token);
    return () => {
      const i = OVERLAY_STACK.indexOf(token);
      if (i >= 0) OVERLAY_STACK.splice(i, 1);
    };
  }, []);

  // Opens FOCUSED: a menu summoned by the keyboard that does not take focus is unusable.
  useLayoutEffect(() => {
    itemRefs.current[0]?.focus();
    setHeight(menuRef.current?.offsetHeight ?? 0);
  }, []);

  // Anything that invalidates the anchor closes it: the page scrolling out from under the row, a
  // resize, or a pointer elsewhere.
  //
  // ★ Only a REAL page scroll counts. Closing on every scroll event made the menu dismiss itself when
  // anything merely scrolled something into view — including the browser's own scroll-into-view while
  // moving to an item near the viewport edge, which made the item unclickable. A trackpad's one-pixel
  // drift would have done the same to a real author. So: ignore scrolls inside the menu, and require
  // the page to have actually moved.
  useEffect(() => {
    const origin = { x: window.scrollX, y: window.scrollY };
    const onScroll = (e: Event): void => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return; // scrolled INSIDE the menu
      if (Math.abs(window.scrollX - origin.x) <= SCROLL_CLOSE_PX && Math.abs(window.scrollY - origin.y) <= SCROLL_CLOSE_PX) return;
      onClose();
    };
    const onResize = (): void => onClose();
    const onPointerDown = (e: Event): void => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onClose]);

  const focusAt = useCallback(
    (i: number) => {
      const n = interactive.length;
      if (n === 0) return;
      itemRefs.current[((i % n) + n) % n]?.focus();
    },
    [interactive.length],
  );

  function onKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const at_ = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusAt(at_ + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusAt(at_ - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAt(interactive.length - 1);
    } else if (e.key === 'ArrowRight') {
      const row = interactive[at_];
      if (row?.kind === 'submenu') {
        e.preventDefault();
        setOpenSub(row.label);
      }
    }
  }

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  // HOVER-TO-OPEN (desktop only). `closeTimer` is the grace period that makes the flyout reachable:
  // leaving the row starts it, entering the row again — or the flyout itself — cancels it.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const scheduleSubClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenSub(null), SUB_CLOSE_MS);
  }, [cancelClose]);
  useEffect(() => cancelClose, [cancelClose]);

  /** Hovering a submenu row opens it; hovering any OTHER row dismisses the open one. */
  const onRowHover = (rowLabel: string | null) => () => {
    if (!hasHover()) return;
    cancelClose();
    if (rowLabel === null) {
      if (openSub !== null) scheduleSubClose();
      return;
    }
    setOpenSub(rowLabel);
  };

  // Clamp into the viewport rather than letting the menu render off the edge.
  const left = Math.max(EDGE_PAD, Math.min(at.x, window.innerWidth - MENU_W - EDGE_PAD));
  // Clamp on the FIRST paint too: falling back to the raw `at.y` until the height is measured puts a
  // menu opened near the bottom edge off-screen for a frame, or forever if the measurement never lands.
  const top = Math.max(EDGE_PAD, Math.min(at.y, window.innerHeight - (height || MENU_MIN_H) - EDGE_PAD));

  const itemClass = (danger?: boolean, disabled?: boolean) =>
    `flex w-full items-center justify-between gap-3 px-3.5 py-1.5 text-left text-sm transition ${
      disabled
        ? 'cursor-not-allowed text-slate-400 dark:text-slate-600'
        : danger
          ? 'text-rose-600 hover:bg-rose-50 focus-visible:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10 dark:focus-visible:bg-rose-500/10'
          : 'text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10 dark:focus-visible:bg-white/10'
    }`;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      onKeyDown={onKey}
      style={{ left, top, width: MENU_W }}
      // ★ z-[62], not z-50. The side panels' collapsed edge rails are z-55 and their open panel is
      // z-61, so at z-50 a menu raised near an edge was painted OVER by a rail — reported as the
      // "Move to" flyout being half-covered by the sidebar buttons. The flyout matches this.
      className="fixed z-[62] overflow-visible rounded-xl border border-slate-200 bg-white py-1 shadow-2xl dark:border-white/10 dark:bg-slate-800"
    >
      {rows.map((row, ri) => {
        if (row.kind === 'divider') {
          return <div key={`div-${ri}`} role="separator" className="my-1 border-t border-slate-100 dark:border-white/10" />;
        }
        const i = interactive.indexOf(row);
        if (row.kind === 'submenu') {
          const open = openSub === row.label;
          // eslint-disable-next-line security/detect-object-injection -- i is the interactive index
          const anchor = open ? itemRefs.current[i]?.getBoundingClientRect() : undefined;
          const menuRect = open ? menuRef.current?.getBoundingClientRect() : undefined;
          return (
            <Fragment key={`sub-${row.label}`}>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-haspopup="menu"
                aria-expanded={open}
                ref={(el) => {
                  // eslint-disable-next-line security/detect-object-injection -- i is the interactive index
                  itemRefs.current[i] = el;
                }}
                onPointerEnter={onRowHover(row.label)}
                onPointerLeave={scheduleSubClose}
                onClick={() => setOpenSub((s) => (s === row.label ? null : row.label))}
                className={itemClass()}
              >
                <span>{row.label}</span>
                <span aria-hidden className="text-slate-400">
                  ▸
                </span>
              </button>
              {open && anchor && menuRect && (
                <SubmenuPanel
                  label={row.label}
                  items={row.items}
                  anchor={anchor}
                  menuRect={menuRect}
                  itemClass={itemClass}
                  onRun={run}
                  onPointerEnter={cancelClose}
                  onPointerLeave={scheduleSubClose}
                  onKeyDown={(e) => {
                    // ArrowLeft closes the SUBMENU only — the parent menu stays open, which is the
                    // convention everywhere else and the only way back without losing your place.
                    if (e.key === 'ArrowLeft') {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpenSub(null);
                      // eslint-disable-next-line security/detect-object-injection -- i is the interactive index
                      itemRefs.current[i]?.focus();
                    }
                  }}
                />
              )}
            </Fragment>
          );
        }
        return (
          <button
            key={`item-${row.label}`}
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={row.disabled}
            ref={(el) => {
              // eslint-disable-next-line security/detect-object-injection -- i is the interactive index
              itemRefs.current[i] = el;
            }}
            onPointerEnter={onRowHover(null)}
            onClick={run(row.onSelect)}
            className={itemClass(row.danger, row.disabled)}
          >
            {row.label}
          </button>
        );
      })}
    </div>
  );
}
