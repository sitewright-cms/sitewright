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

// ONE NAVIGATION, ONE ACTIVE ITEM. A header that splits its menu either side of a centred logo has TWO
// `.menu` lists. Spying each list on its own lit one item in EACH half: scrolled into #pricing (right
// half), the left half kept its own last-crossed section (#services) lit beside it. Every spied list in
// the same landmark now shares ONE selection — the desktop halves and the mobile drawer alike — while a
// separate spy in another landmark (a sidebar table of contents) keeps its own.
describe('Scrollspy runtime behavior (jsdom) — one active item per navigation', () => {
  const SPLIT_TOPS: Record<string, number> = { about: 800, services: 1600, pricing: 2400, contact: 3200 };

  // The nav-header recipe, split: left half · logo · right half, a dormant language menu (route links
  // only, carrying its own server-rendered highlight), and the mobile drawer listing every item.
  const HEADER =
    '<div class="navbar">' +
    '<ul class="menu menu-horizontal" HALF>' +
    '<li><a id="l-home" href="/">Home</a></li>' +
    '<li><a id="l-about" href="#about">About</a></li>' +
    '<li><a id="l-services" href="#services">Services</a></li>' +
    '</ul>' +
    '<a id="brand" href="/">Acme</a>' +
    '<ul class="menu menu-horizontal" HALF>' +
    '<li><a id="r-pricing" href="#pricing">Pricing</a></li>' +
    '<li><a id="r-contact" href="/#contact">Contact</a></li>' +
    '</ul>' +
    '<ul class="menu dropdown-content"><li><a id="lang-en" class="active" aria-current="true" href="/en/">EN</a></li>' +
    '<li><a id="lang-de" href="/de/">DE</a></li></ul>' +
    '</div>' +
    '<div class="navbar"><input type="checkbox" id="sw-nav-drawer" /><ul class="menu" HALF>' +
    '<li><a id="m-home" href="/">Home</a></li>' +
    '<li><a id="m-about" href="#about">About</a></li>' +
    '<li><a id="m-services" href="#services">Services</a></li>' +
    '<li><a id="m-pricing" href="#pricing">Pricing</a></li>' +
    '<li><a id="m-contact" href="#contact">Contact</a></li>' +
    '</ul></div>';

  function mount(opts: { siteWide: boolean; perHalf?: boolean; content?: string; sidebar?: string }): void {
    window.history.replaceState({}, '', '/');
    document.body.className = opts.siteWide ? 'sw-scrollspy' : '';
    document.body.innerHTML =
      `<nav id="main-nav">${HEADER.replace(/ HALF/g, opts.perHalf ? ' data-sw-scrollspy' : '')}</nav>` +
      (opts.sidebar ?? '') +
      '<main id="page-content">' +
      (opts.content ?? '') +
      Object.keys(SPLIT_TOPS)
        .map((id) => `<section id="${id}"></section>`)
        .join('') +
      '</main>';
    for (const id of Object.keys(SPLIT_TOPS)) stubLaidOut(document.getElementById(id)!);
    const nav = document.getElementById('main-nav') as HTMLElement;
    Object.defineProperty(nav, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0, height: NAV_H, left: 0, right: 0, bottom: NAV_H, width: 1200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect });
    vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element) => {
      if (el === nav) return { position: 'fixed', getPropertyValue: () => '' } as unknown as CSSStyleDeclaration;
      return { position: 'static', getPropertyValue: () => '', scrollPaddingTop: 'auto', fontSize: '16px' } as unknown as CSSStyleDeclaration;
    }) as typeof window.getComputedStyle);
  }

  function at(y: number): void {
    Object.defineProperty(window, 'pageYOffset', { configurable: true, value: y });
    for (const [id, absTop] of Object.entries(SPLIT_TOPS)) stubTop(document.getElementById(id)!, absTop - y);
    window.dispatchEvent(new Event('scroll'));
  }
  const inView = (id: string): number => SPLIT_TOPS[id]! - NAV_H;
  const lit = (): string[] => Array.from(document.querySelectorAll('a.active')).map((a) => a.id);

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 9000 });
    Object.defineProperty(document.body, 'scrollHeight', { configurable: true, value: 9000 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.className = '';
  });
  const run = (): void => { (0, eval)(SCROLLSPY_JS); };

  it('lights ONE item across both halves of a split header (site-wide toggle)', () => {
    mount({ siteWide: true });
    run();
    at(inView('pricing')); // right half — the left half must NOT keep #services lit
    expect(lit()).toEqual(['r-pricing', 'lang-en', 'm-pricing']);
    at(inView('services')); // back into the left half — the right half clears
    expect(lit()).toEqual(['l-services', 'lang-en', 'm-services']);
    at(inView('contact')); // a path-prefixed /#contact in the right half
    expect(lit()).toEqual(['r-contact', 'lang-en', 'm-contact']);
  });

  it('the Home sentinel lights above the first section, and at the page bottom only the LAST section does', () => {
    mount({ siteWide: true });
    run();
    at(0);
    expect(lit()).toEqual(['l-home', 'lang-en', 'm-home']);
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 1500 });
    Object.defineProperty(document.body, 'scrollHeight', { configurable: true, value: 1500 });
    at(700); // 900 + 700 >= 1500 - 2 → at the bottom, before #contact ever reaches the line
    expect(lit()).toEqual(['r-contact', 'lang-en', 'm-contact']);
  });

  it('leaves a list with NO in-page sections alone (the language menu keeps its own highlight)', () => {
    mount({ siteWide: true });
    run();
    at(inView('about'));
    expect(document.getElementById('lang-en')!.getAttribute('aria-current')).toBe('true');
    expect(lit()).toContain('lang-en');
  });

  it('groups per-element data-sw-scrollspy lists in the same landmark the same way', () => {
    mount({ siteWide: false, perHalf: true });
    run();
    at(inView('pricing'));
    expect(lit()).toEqual(['r-pricing', 'lang-en', 'm-pricing']);
  });

  it('a SEPARATE spy keeps its own active item — a sidebar table of contents in another landmark', () => {
    // The TOC lists only two of the sections; scrolled into #services it still shows its own nearest
    // (#about), independently of the header, which shows #services.
    mount({
      siteWide: true,
      sidebar:
        '<aside id="sidebar-left"><ul class="menu" data-sw-scrollspy>' +
        '<li><a id="t-about" href="#about">About</a></li><li><a id="t-pricing" href="#pricing">Pricing</a></li>' +
        '</ul></aside>',
    });
    run();
    at(inView('services'));
    expect(lit()).toEqual(['l-services', 'lang-en', 'm-services', 't-about']);
    at(inView('pricing'));
    expect(lit()).toEqual(['r-pricing', 'lang-en', 'm-pricing', 't-pricing']);
  });

  it('two spies in page content (no shared landmark) stay independent', () => {
    mount({
      siteWide: false,
      content:
        '<div><ul data-sw-scrollspy><li><a id="a-about" href="#about">About</a></li><li><a id="a-services" href="#services">Services</a></li></ul></div>' +
        '<div><ul data-sw-scrollspy><li><a id="b-pricing" href="#pricing">Pricing</a></li><li><a id="b-contact" href="#contact">Contact</a></li></ul></div>',
    });
    run();
    at(inView('pricing'));
    expect(lit()).toEqual(['lang-en', 'a-services', 'b-pricing']);
  });
});
