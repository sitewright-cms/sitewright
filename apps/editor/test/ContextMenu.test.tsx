import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ContextMenu, type ContextMenuRow } from '../src/views/ui/ContextMenu';
import { OVERLAY_STACK } from '../src/views/ui/overlay';

// A point-anchored menu (right-click / long-press / keyboard), as opposed to the header's
// button-anchored dropdown. What it has to get right: keyboard parity, closing on everything that
// invalidates its anchor, and — because the pages list is virtualised — closing on SCROLL, since the
// row it is anchored to can unmount underneath it.

const picked: string[] = [];
const rows = (): ContextMenuRow[] => [
  { kind: 'item', label: 'Open page editor', onSelect: () => picked.push('open') },
  { kind: 'item', label: 'Edit page settings', onSelect: () => picked.push('settings') },
  { kind: 'divider' },
  {
    kind: 'submenu',
    label: 'Move to',
    items: [
      { kind: 'item', label: 'Top of group', onSelect: () => picked.push('top') },
      { kind: 'item', label: 'Select sibling…', onSelect: () => picked.push('sibling') },
      { kind: 'item', label: 'Bottom of group', onSelect: () => picked.push('bottom') },
    ],
  },
  { kind: 'item', label: 'Delete page', danger: true, onSelect: () => picked.push('delete') },
];

const onClose = vi.fn();
function open(at = { x: 120, y: 240 }) {
  return render(<ContextMenu at={at} label="Page actions" rows={rows()} onClose={onClose} />);
}

/**
 * Declare a DESKTOP pointer for hover-to-open. jsdom's `matchMedia` answers `false` to every query,
 * including `(hover: hover)`, so without this the component correctly reads the environment as
 * touch-like and hover does nothing — the test would fail for a reason that never reaches a user.
 */
function withHoveringPointer() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('hover: hover'),
    media: q,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeEach(() => {
  picked.length = 0;
  onClose.mockReset();
  OVERLAY_STACK.length = 0;
  vi.unstubAllGlobals();
});

describe('ContextMenu', () => {
  it('renders every row as a menu item, with the menu labelled', () => {
    open();
    expect(screen.getByRole('menu', { name: 'Page actions' })).toBeInTheDocument();
    // Accessible NAMES, not raw text: the submenu's ▸ is aria-hidden and must not read out.
    expect(screen.getAllByRole('menuitem').map((b) => b.getAttribute('aria-label') ?? b.textContent?.replace('▸', '').trim())).toEqual([
      'Open page editor',
      'Edit page settings',
      'Move to',
      'Delete page',
    ]);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('runs the action and closes on select', () => {
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open page editor' }));
    expect(picked).toEqual(['open']);
    expect(onClose).toHaveBeenCalled();
  });

  it('★ closes when the PAGE scrolls — the row it is anchored to can unmount under it once virtualised', () => {
    open();
    act(() => {
      window.scrollY = 400;
      window.dispatchEvent(new Event('scroll'));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('★ does NOT close on a scroll that did not move the page', () => {
    // Closing on every scroll event dismissed the menu when the browser scrolled an item into view,
    // making items near the viewport edge unclickable — and a trackpad's drift would do the same.
    open();
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape, on an outside click, and on resize', () => {
    const { unmount } = open();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    unmount();

    onClose.mockReset();
    open();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('moves focus with the arrow keys, wrapping at both ends', () => {
    open();
    const items = () => screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items()[0]); // opens focused, so a keyboard user can act
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items()[1]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    expect(document.activeElement, 'wraps to the last item').toBe(items()[items().length - 1]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' });
    expect(document.activeElement).toBe(items()[0]);
  });

  it('opens a submenu on click and on ArrowRight, and runs its items', () => {
    open();
    const move = screen.getByRole('menuitem', { name: 'Move to' });
    expect(move).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(move);
    expect(screen.getByRole('menu', { name: 'Move to' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Top of group' }));
    expect(picked).toEqual(['top']);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes the SUBMENU on ArrowLeft without closing the whole menu', () => {
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to' }));
    expect(screen.queryByRole('menu', { name: 'Move to' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Move to' }), { key: 'ArrowLeft' });
    expect(screen.queryByRole('menu', { name: 'Move to' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Page actions' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('marks a destructive item so it does not read like the others', () => {
    open();
    expect(screen.getByRole('menuitem', { name: 'Delete page' }).className).toMatch(/rose|red/);
  });

  it('★ joins the overlay stack so Escape unwinds it before any drawer behind it', () => {
    const { unmount } = open();
    expect(OVERLAY_STACK).toHaveLength(1);
    unmount();
    expect(OVERLAY_STACK).toHaveLength(0);
  });

  it('flips away from the viewport edge instead of rendering off-screen', () => {
    // jsdom reports 0-size elements, so this asserts the CLAMP, which is what keeps a menu opened
    // near the right/bottom edge reachable.
    open({ x: 10_000, y: 10_000 });
    const menu = screen.getByRole('menu', { name: 'Page actions' });
    expect(Number.parseInt(menu.style.left, 10)).toBeLessThanOrEqual(window.innerWidth);
    expect(Number.parseInt(menu.style.top, 10)).toBeLessThanOrEqual(window.innerHeight);
  });

  it('★ opens the submenu on HOVER, and keeps it open while the pointer travels to it', () => {
    withHoveringPointer();
    vi.useFakeTimers();
    try {
      // The flyout is a sibling overlay, not a child of its row, so the pointer crosses the rows in
      // between on its way there. Closing the instant the row is left would make it unreachable.
      open();
      const move = screen.getByRole('menuitem', { name: 'Move to' });
      fireEvent.pointerEnter(move);
      expect(screen.getByRole('menu', { name: 'Move to' })).toBeInTheDocument();

      fireEvent.pointerLeave(move);
      fireEvent.pointerEnter(screen.getByRole('menu', { name: 'Move to' }));
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole('menu', { name: 'Move to' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hovering another row dismisses an open submenu', () => {
    withHoveringPointer();
    vi.useFakeTimers();
    try {
      open();
      fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Move to' }));
      expect(screen.getByRole('menu', { name: 'Move to' })).toBeInTheDocument();
      fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Delete page' }));
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole('menu', { name: 'Move to' })).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT hover-open without a fine pointer — on touch that gesture is a tap', () => {
    // jsdom's matchMedia answers false to everything, which is exactly the touch case.
    open();
    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Move to' }));
    expect(screen.queryByRole('menu', { name: 'Move to' })).toBeNull();
    // Click still opens it, so the submenu is reachable by tap.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to' }));
    expect(screen.getByRole('menu', { name: 'Move to' })).toBeInTheDocument();
  });

  it('★ the submenu is a viewport-positioned overlay, clamped on screen — not `absolute left-full`', () => {
    // It used to be absolutely positioned against its row, so it always opened to the RIGHT: on a
    // menu raised near the right edge it ran straight off the viewport. Now it is `fixed` with its
    // own clamp, like the parent menu.
    open({ x: 10_000, y: 10_000 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to' }));
    const sub = screen.getByRole('menu', { name: 'Move to' });
    expect(sub.className).toContain('fixed');
    expect(sub.className).not.toContain('left-full');
    expect(Number.parseInt(sub.style.left, 10)).toBeLessThanOrEqual(window.innerWidth);
    expect(Number.parseInt(sub.style.left, 10)).toBeGreaterThanOrEqual(0);
    expect(Number.parseInt(sub.style.top, 10)).toBeLessThanOrEqual(window.innerHeight);
  });

  it('★ menu and submenu sit ABOVE the side-panel rails (z-55) that used to cover them', () => {
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to' }));
    // z-50 put the menu UNDER the collapsed side-panel tabs — the reported "half-covered by the
    // sidebar buttons". Both layers must clear 55 and stay under the elevated modal layer (70).
    expect(screen.getByRole('menu', { name: 'Page actions' }).className).toContain('z-[62]');
    expect(screen.getByRole('menu', { name: 'Move to' }).className).toContain('z-[62]');
  });
});
