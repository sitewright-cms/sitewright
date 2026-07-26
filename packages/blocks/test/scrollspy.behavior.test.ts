// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SCROLLSPY_JS } from '../src/scrollspy.js';

// Behavioral coverage for the runtime's section resolution + active selection (string assertions can't
// prove the dialog-target exclusion). jsdom has no layout, so each element's getBoundingClientRect is
// stubbed to the VIEWPORT top it would have at the current window.pageYOffset.

const NAV_H = 76;
// Absolute document tops of the sections (as if laid out on a real page).
const TOPS: Record<string, number> = { why: 800, how: 1460, faq: 2540 };

// jsdom does no layout: getBoundingClientRect + getClientRects both return zeros/empty for every
// element. A LAID-OUT element (real section) is given one non-empty client rect at build time (the
// runtime's getClientRects().length "is it rendered" guard reads this at INIT, before any scroll) —
// layout existence is scroll-independent; only the top moves. A `hidden` target (display:none dialog /
// tab panel) keeps jsdom's default empty rects, standing in for "not rendered".
function stubLaidOut(el: Element): void {
  el.getClientRects = () => [{ top: 0, left: 0, right: 0, bottom: 1, width: 1200, height: 1, x: 0, y: 0, toJSON: () => ({}) }] as unknown as DOMRectList;
}
// Set only the VIEWPORT top (what update()/paint() read each frame).
function stubTop(el: Element, top: number): void {
  el.getBoundingClientRect = () => ({ top, left: 0, right: 0, bottom: top + 1, width: 1200, height: 1, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

function build(): void {
  document.body.className = 'sw-scrollspy';
  document.body.innerHTML =
    '<nav id="main-nav"><ul class="menu">' +
    '<li><a id="l-why" href="#why">Why</a></li>' +
    '<li><a id="l-how" href="#how">How</a></li>' +
    '<li><a id="l-faq" href="#faq">FAQ</a></li>' +
    '<li><a id="l-app" href="#app-modal">Download App</a></li>' +
    '<li><a id="l-hid" href="#hidden-region">Hidden</a></li>' +
    '</ul></nav>' +
    '<section id="why"></section><section id="how"></section><section id="faq"></section>' +
    // a non-dialog display:none target (an inactive tab panel / off-canvas region) — same permanent
    // rect.top 0 hijack the generic getClientRects() guard must also drop. Left un-stubbed → jsdom's
    // default empty client rects stand in for display:none.
    '<div id="hidden-region"></div>' +
    '<footer></footer>' +
    // the app-download modal, appended at body end (last in DOM order) — closed → display:none
    '<dialog id="app-modal"><p>get the app</p></dialog>';
  // Real sections are laid out (client rects present at init); #hidden-region + #app-modal keep jsdom's
  // empty rects (display:none stand-in) so the runtime's render guard drops them.
  for (const id of Object.keys(TOPS)) stubLaidOut(document.getElementById(id)!);
  // #main-nav is fixed → its measured height is the offset
  const nav = document.getElementById('main-nav') as HTMLElement;
  Object.defineProperty(nav, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, height: NAV_H, left: 0, right: 0, bottom: NAV_H, width: 1200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect });
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element) => {
    if (el === nav) return { position: 'fixed', getPropertyValue: () => '' } as unknown as CSSStyleDeclaration;
    return { position: 'static', getPropertyValue: () => '', scrollPaddingTop: 'auto', fontSize: '16px' } as unknown as CSSStyleDeclaration;
  }) as typeof window.getComputedStyle);
}

// Position every section for a given scrollY, and the closed dialog at a constant viewport top 0
// (jsdom/real browsers both report all-zeros for a display:none element).
function scrollTo(y: number): void {
  Object.defineProperty(window, 'pageYOffset', { configurable: true, value: y });
  for (const [id, absTop] of Object.entries(TOPS)) stubTop(document.getElementById(id)!, absTop - y);
  // dialog + hidden target: constant viewport top 0 (a real display:none element reports all-zeros)
  stubTop(document.getElementById('app-modal')!, 0);
  stubTop(document.getElementById('hidden-region')!, 0);
}

const activeIds = (): string[] =>
  Array.from(document.querySelectorAll('#main-nav a.active')).map((a) => (a as HTMLElement).id);

describe('Scrollspy runtime behavior (jsdom) — dialog-target exclusion', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    // scrollMax uses documentElement/body.scrollHeight; keep the page taller than any scroll+vh so
    // the atBottom branch doesn't fire during these mid-page assertions.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });
    Object.defineProperty(document.body, 'scrollHeight', { configurable: true, value: 5000 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const run = (): void => { (0, eval)(SCROLLSPY_JS); };
  const fire = (): void => { window.dispatchEvent(new Event('scroll')); };

  it('activates #faq (the real last section) when it reaches the line — NOT the #app-modal dialog trigger', () => {
    build();
    run();
    // scroll so FAQ's top sits just under the header line (faq abs 2540 → viewport 76 == NAV_H)
    scrollTo(2540 - NAV_H);
    fire();
    expect(activeIds()).toEqual(['l-faq']);
  });

  it('activates #how while FAQ is still below the line (regression: dialog never wins early either)', () => {
    build();
    run();
    scrollTo(1460 - NAV_H); // how-to at the line, faq still far below
    fire();
    expect(activeIds()).toEqual(['l-how']);
  });

  it('also excludes a non-dialog display:none target (generic getClientRects guard) — #faq still wins', () => {
    build();
    run();
    scrollTo(2540 - NAV_H); // faq at the line; #hidden-region (no client rects) must not hijack
    fire();
    expect(activeIds()).toEqual(['l-faq']);
  });
});
