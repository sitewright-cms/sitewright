import { afterEach, describe, expect, it, vi } from 'vitest';
import { unfixChromeForCapture } from '../src/render/capture-chrome.js';

/**
 * The computed-style pass that runs IN THE PAGE before a full-page capture (see capture-chrome.ts).
 * Driven here against a fake DOM — just the surface the function touches — so the DECISIONS are pinned
 * without a browser. The layout consequences are pinned with a real browser in capture-layout.test.ts.
 */

interface FakeEl {
  name: string;
  position: string;
  /** Viewport-relative top as laid out right now. */
  top: number;
  /** Page offset of the containing block an ABSOLUTE element would resolve `top` against. */
  absoluteOrigin?: number;
  writes: Record<string, string>;
}

function fakeDom(els: FakeEl[], scrollY = 0): void {
  const nodes = els.map((el) => ({
    el,
    style: {
      setProperty(p: string, v: string, prio?: string) {
        el.writes[p] = prio ? `${v} !${prio}` : v;
      },
    },
    getBoundingClientRect() {
      // Once made absolute, the element sits at its `top` measured from its containing block.
      const top = el.writes.top;
      if (el.writes.position?.startsWith('absolute') && top) return { top: parseFloat(top) + (el.absoluteOrigin ?? 0) - scrollY };
      return { top: el.top };
    },
  }));
  vi.stubGlobal('document', { querySelectorAll: () => nodes });
  vi.stubGlobal('getComputedStyle', (n: { el: FakeEl }) => ({ position: n.el.position }));
  vi.stubGlobal('scrollY', scrollY);
}

const el = (name: string, position: string, top = 0, absoluteOrigin?: number): FakeEl => ({ name, position, top, absoluteOrigin, writes: {} });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('unfixChromeForCapture', () => {
  it('★ a STICKY element becomes relative with every inset cleared — never absolute', () => {
    // THE BUG. Sticky was converted to `absolute` at its page position: out of flow, so a grid column
    // captured at shrink-to-fit width, and `top` resolved against a POSITIONED parent pushed it down.
    // At scroll 0 a sticky box is exactly at its in-flow position, so staying in flow keeps it there.
    const col = el('col', 'sticky', 364);
    fakeDom([col]);
    expect(unfixChromeForCapture()).toEqual({ fixed: 0, sticky: 1 });
    expect(col.writes.position).toBe('relative !important');
    // `top: 6rem` meant "stick 6rem from the top"; on a relative box it would OFFSET it by 6rem.
    for (const side of ['top', 'right', 'bottom', 'left']) expect(col.writes[side], side).toBe('auto !important');
  });

  it('a FIXED element is pinned absolute at the page position a visitor sees it', () => {
    const header = el('header', 'fixed', 0);
    fakeDom([header], 0);
    expect(unfixChromeForCapture()).toEqual({ fixed: 1, sticky: 0 });
    expect(header.writes.position).toBe('absolute !important');
    expect(header.writes.top).toBe('0px !important');
    expect(header.writes.bottom).toBe('auto !important');
  });

  it('a fixed element inside a POSITIONED parent is corrected back to where it was on screen', () => {
    // As `absolute`, `top` resolves against the nearest positioned ancestor — here one 300px down the
    // page — so a header pinned at top:0 would land at y=300. Measured once and offset back.
    const bar = el('bar', 'fixed', 0, 300);
    fakeDom([bar]);
    unfixChromeForCapture();
    expect(bar.writes.top).toBe('-300px !important');
  });

  it('leaves static / relative / absolute elements untouched', () => {
    const plain = [el('a', 'static'), el('b', 'relative'), el('c', 'absolute')];
    fakeDom(plain);
    expect(unfixChromeForCapture()).toEqual({ fixed: 0, sticky: 0 });
    for (const p of plain) expect(p.writes, p.name).toEqual({});
  });

  it('measures every element BEFORE writing any (a write between reads would shift later readings)', () => {
    const header = el('header', 'fixed', 0);
    const col = el('col', 'sticky', 500);
    const reads: string[] = [];
    fakeDom([col, header]);
    const real = (globalThis as unknown as { getComputedStyle: (n: { el: FakeEl }) => { position: string } }).getComputedStyle;
    vi.stubGlobal('getComputedStyle', (n: { el: FakeEl }) => {
      reads.push(`${n.el.name}:${Object.keys(col.writes).length + Object.keys(header.writes).length}`);
      return real(n);
    });
    unfixChromeForCapture();
    expect(reads).toEqual(['col:0', 'header:0']);
  });

  it('measures from the TOP: every candidate scroller is reset before anything is read', () => {
    // A preview scrolls its BODY, and the capture's own style flips that overflow off mid-settle — once
    // leaving the document 4,228px down while window.scrollY read 0. A fixed element measured against
    // one of those and corrected against the other would land a whole scroll away.
    const header = el('header', 'fixed', 0);
    fakeDom([header]);
    const scrollers = { scrollingElement: { scrollTop: 4228 }, documentElement: { scrollTop: 4228 }, body: { scrollTop: 900 } };
    const doc = (globalThis as unknown as { document: object }).document;
    let scrolledTo: [number, number] | undefined;
    vi.stubGlobal('document', { ...doc, ...scrollers });
    vi.stubGlobal('scrollTo', (x: number, y: number) => (scrolledTo = [x, y]));
    unfixChromeForCapture();
    expect([scrollers.scrollingElement.scrollTop, scrollers.documentElement.scrollTop, scrollers.body.scrollTop]).toEqual([0, 0, 0]);
    expect(scrolledTo).toEqual([0, 0]);
    expect(header.writes.top).toBe('0px !important');
  });

  it('tolerates an element whose computed style cannot be read', () => {
    const ok = el('ok', 'sticky');
    fakeDom([el('gone', 'fixed'), ok]);
    vi.stubGlobal('getComputedStyle', (n: { el: FakeEl }) => {
      if (n.el.name === 'ok') return { position: 'sticky' };
      throw new Error('detached');
    });
    expect(unfixChromeForCapture()).toEqual({ fixed: 0, sticky: 1 });
  });
});
