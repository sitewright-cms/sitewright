/**
 * UN-FIX THE FIXED CHROME before a full-page capture.
 *
 * A full-page capture stitches one tall image, so a `position:fixed` header paints ONCE, wherever the
 * compositor left it: an opaque band slicing through the MIDDLE of the page, hiding whatever section it
 * lands on. Four agents hit that — two chased it as a layout bug in their own clone, and on the ORIGINAL
 * side of a comparison the nav vanished from its own capture. So each fixed element is pinned
 * `absolute` at the page position a visitor sees it at the top of the page (it scrolls there first).
 *
 * STICKY IS DIFFERENT, and treating it the same was a bug. Sticky used to be made `absolute` too, which
 * takes it OUT OF FLOW: a sticky grid column was captured at shrink-to-fit width (a third of the page
 * became the width of its text), its `top` resolved against a POSITIONED parent so it dropped by that
 * parent's offset, and a sticky header left a 64px hole that everything below it rode up into. None of
 * that was on the real page. At scroll 0 a sticky box already sits at its in-flow position, so it only
 * has to STOP sticking: `relative` keeps it in its grid cell, keeps its z-index stacking and stays the
 * containing block for its absolutely positioned children; the insets are cleared because on a
 * relative box `top: 6rem` would no longer mean "stick 6rem down" but "move 6rem down".
 *
 * A computed-style pass, because a selector cannot express "whatever the stylesheet made fixed" and an
 * imported site's header is fixed from its own CSS, not inline.
 *
 * Runs IN THE PAGE (handed to `page.evaluate`), so it is self-contained: no imports, no closure over
 * module state — only the globals a browser provides. Typed against the few members it touches because
 * this tsconfig has no DOM lib. Returns how many of each it changed (for tests and logs).
 */
export function unfixChromeForCapture(): { fixed: number; sticky: number } {
  interface Box {
    style: { setProperty(p: string, v: string, prio?: string): void };
    getBoundingClientRect(): { top: number };
  }
  interface Scroller {
    scrollTop: number;
  }
  const g = globalThis as unknown as {
    document: {
      querySelectorAll(s: string): ArrayLike<Box>;
      scrollingElement?: Scroller | null;
      documentElement?: Scroller;
      body?: Scroller | null;
    };
    getComputedStyle(el: Box): { position: string };
    scrollTo?: (x: number, y: number) => void;
    scrollY?: number;
  };
  // FROM THE TOP, whatever scrolls. Every position below is "where a visitor sees it at the top of the
  // page", and the drift correction compares two readings that must share one scroll offset. A preview
  // scrolls its BODY, and the capture's own style flips that overflow off mid-settle — measured once
  // leaving the document 4,228px down while window.scrollY read 0. Reset every candidate, not one.
  for (const s of [g.document.scrollingElement, g.document.documentElement, g.document.body]) {
    try {
      if (s) s.scrollTop = 0;
    } catch {
      /* detached */
    }
  }
  try {
    g.scrollTo?.(0, 0);
  } catch {
    /* not a window */
  }
  const all = g.document.querySelectorAll('*');
  const offset = g.scrollY ?? 0;
  // Capped: a pathological DOM must not turn the freeze into the slow step of the capture.
  const limit = Math.min(all.length, 4000);
  // READ everything, THEN write. A style write between two reads forces a layout per element, and a
  // box changed earlier in the walk would shift what a later one measures.
  const fixed: Array<{ el: Box; top: number }> = [];
  const sticky: Box[] = [];
  for (let i = 0; i < limit; i++) {
    const el = all[i];
    if (!el) continue;
    let pos: string;
    try {
      pos = g.getComputedStyle(el).position;
    } catch {
      continue;
    }
    if (pos === 'fixed') fixed.push({ el, top: Math.round(el.getBoundingClientRect().top + offset) });
    else if (pos === 'sticky') sticky.push(el);
  }
  for (const el of sticky) {
    el.style.setProperty('position', 'relative', 'important');
    for (const side of ['top', 'right', 'bottom', 'left']) el.style.setProperty(side, 'auto', 'important');
  }
  for (const { el, top } of fixed) {
    el.style.setProperty('position', 'absolute', 'important');
    el.style.setProperty('top', `${top}px`, 'important');
    el.style.setProperty('bottom', 'auto', 'important');
  }
  // As `absolute`, `top` resolves against the nearest POSITIONED ancestor, not the page — so a fixed bar
  // inside a `relative` wrapper 300px down would land 300px low. Measure once, after all the writes, and
  // move each one back by however far it drifted.
  const drift = fixed.map(({ el, top }) => Math.round(el.getBoundingClientRect().top + offset) - top);
  fixed.forEach(({ el, top }, i) => {
    const d = drift[i] ?? 0;
    if (d !== 0) el.style.setProperty('top', `${top - d}px`, 'important');
  });
  return { fixed: fixed.length, sticky: sticky.length };
}
