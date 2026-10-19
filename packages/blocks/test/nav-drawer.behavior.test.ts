// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { STICKY_HEADER_JS } from '../src/sticky-header.js';
import { NAV_LINK_JS } from '../src/nav-runtime.js';

// The stock pure-CSS mobile drawer (`#sw-nav-drawer` peer checkbox — agent guide `nav`, recipe snippet
// `nav-header`) must CLOSE when the visitor taps a link to a section of the SAME page. Before, the page
// scrolled (natively, or smooth via NAV_LINK_JS) but the box stayed checked, so the open drawer kept
// covering the content the visitor had just asked to see.
//
// The close lives in STICKY_HEADER_JS because that is the one chrome runtime that ships on EVERY page of
// EVERY site, publish and editor preview alike — NAV_LINK_JS only ships for `#` placeholders, dialogs and
// scrollspy, so most drawers run without it (the native-jump case).

function build(path = '/'): void {
  window.history.replaceState({}, '', path);
  document.body.innerHTML =
    '<nav id="main-nav"><div class="navbar">' +
    '<input type="checkbox" id="sw-nav-drawer" class="peer sr-only" />' +
    '<label for="sw-nav-drawer" id="burger">Menu</label>' +
    '<label for="sw-nav-drawer" id="backdrop"></label>' +
    '<div id="panel"><label for="sw-nav-drawer" id="close">Close</label><ul class="menu">' +
    '<li><a id="about" href="#about">About</a></li>' +
    '<li><a id="pricing" href="/#pricing">Pricing</a></li>' +
    '<li><a id="local-pricing" href="./#pricing">Pricing (relative)</a></li>' +
    '<li><a id="team" href="/about/#team">Team</a></li>' +
    '<li><a id="modal" href="#contact-modal">Contact us</a></li>' +
    '<li><a id="blog" href="/blog/">Blog</a></li>' +
    '<li><a id="blog-section" href="/blog/#latest">Latest posts</a></li>' +
    '<li><a id="bare" href="#">Nothing</a></li>' +
    '<li><a id="newtab" href="#about" target="_blank">About (new tab)</a></li>' +
    '<li><a id="dl" href="#about" download>About (download)</a></li>' +
    '<li><a id="rich" href="#about"><span id="rich-label">About</span></a></li>' +
    '</ul></div></div></nav>' +
    '<main id="page-content"><section id="about"></section><section id="pricing"></section>' +
    '<section id="team"></section></main>' +
    '<dialog id="contact-modal"><p>hi</p></dialog>';
}

// Both runtimes bind on `document`/`window`, which OUTLIVE a body reset — record what each install adds
// and unbind it afterwards so every test runs exactly the copies it asked for (same pattern as
// nav-active.behavior.test.ts).
type Bound = [EventTarget, string, EventListener, boolean];
let bound: Bound[] = [];
function install(js: string): void {
  const doc = document.addEventListener.bind(document);
  const win = window.addEventListener.bind(window);
  const spy =
    (target: EventTarget, real: typeof doc) =>
    (type: string, l: EventListener, opts?: boolean | AddEventListenerOptions): void => {
      bound.push([target, type, l, opts === true || (typeof opts === 'object' && opts?.capture === true)]);
      real(type, l, opts as boolean);
    };
  document.addEventListener = spy(document, doc) as typeof document.addEventListener;
  window.addEventListener = spy(window, win) as typeof window.addEventListener;
  try {
    (0, eval)(js);
  } finally {
    document.addEventListener = doc;
    window.addEventListener = win;
  }
}

const drawer = (): HTMLInputElement => document.getElementById('sw-nav-drawer') as HTMLInputElement;

/** Open the drawer the way the CSS recipe does: the box is checked. */
function open(): void {
  drawer().checked = true;
}

/** Count the `change` events the drawer fires (what an author's scroll-lock listener would see). */
function changes(): { count: () => number } {
  let n = 0;
  const l = (e: Event): void => {
    if (e.target === drawer()) n++;
  };
  document.addEventListener('change', l);
  bound.push([document, 'change', l, false]);
  return { count: () => n };
}

/** A plain left-button click, the way a visitor makes one. */
function click(id: string, init: MouseEventInit = {}): MouseEvent {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  document.getElementById(id)!.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  // jsdom implements neither scrolling nor the modal dialog; the runtimes only need them to exist.
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.setAttribute('open', '');
  };
});

afterEach(() => {
  for (const [target, type, l, capture] of bound) target.removeEventListener(type, l, capture);
  bound = [];
  document.body.innerHTML = '';
});

describe('mobile drawer — an in-page link closes it (sticky-header runtime alone: the native jump)', () => {
  beforeEach(() => {
    build('/');
    install(STICKY_HEADER_JS);
  });

  it('unchecks #sw-nav-drawer on a #section tap and fires ONE bubbling change event', () => {
    const seen = changes();
    let bubbled = false;
    const onBody = (): void => {
      bubbled = true;
    };
    document.body.addEventListener('change', onBody);
    bound.push([document.body, 'change', onBody, false]);
    open();
    click('about');
    expect(drawer().checked).toBe(false);
    expect(seen.count()).toBe(1);
    expect(bubbled).toBe(true);
  });

  it('never cancels the click, so the browser still performs the jump (and no-JS behaviour is unchanged)', () => {
    open();
    const e = click('about');
    expect(e.defaultPrevented).toBe(false);
  });

  it('closes on a PATH-PREFIXED anchor to this page (/#pricing, ./#pricing)', () => {
    open();
    click('pricing');
    expect(drawer().checked).toBe(false);
    open();
    click('local-pricing');
    expect(drawer().checked).toBe(false);
  });

  it('closes when the tap lands on a label INSIDE the link (a rich menu label)', () => {
    open();
    click('rich-label');
    expect(drawer().checked).toBe(false);
  });

  it('closes on a link that opens a <dialog> too — the modal is in-page content', () => {
    open();
    click('modal');
    expect(drawer().checked).toBe(false);
  });

  it('leaves the drawer alone for a link that LEAVES the page', () => {
    const seen = changes();
    open();
    click('blog');
    expect(drawer().checked).toBe(true);
    click('blog-section'); // a section on ANOTHER page
    expect(drawer().checked).toBe(true);
    expect(seen.count()).toBe(0);
  });

  it('leaves it alone for a bare "#" (a script hook, not a section) and for non-activations', () => {
    open();
    click('bare');
    expect(drawer().checked).toBe(true);
    click('about', { ctrlKey: true }); // open in a new tab: this page does not move
    click('about', { metaKey: true });
    click('about', { shiftKey: true });
    click('about', { altKey: true });
    click('about', { button: 1 });
    click('newtab');
    click('dl');
    expect(drawer().checked).toBe(true);
  });

  it('fires nothing when the drawer is already closed (the desktop bar shares the same links)', () => {
    const seen = changes();
    click('about');
    expect(drawer().checked).toBe(false);
    expect(seen.count()).toBe(0);
  });

  it('is inert on a page without the stock drawer', () => {
    document.getElementById('sw-nav-drawer')!.remove();
    expect(() => click('about')).not.toThrow();
  });

  it('ignores a same-id element that is not a checkbox', () => {
    const box = drawer();
    box.replaceWith(Object.assign(document.createElement('div'), { id: 'sw-nav-drawer' }));
    expect(() => click('about')).not.toThrow();
  });
});

describe('mobile drawer — under a path-served base (/sites/<slug>/…, the editor/local-hosting previews)', () => {
  it('treats a suffix-matching path as this page, exactly as the smooth-scroll runtime does', () => {
    build('/sites/acme/about/');
    install(STICKY_HEADER_JS);
    open();
    click('team'); // /about/#team, served at /sites/acme/about/
    expect(drawer().checked).toBe(false);
  });
});

describe('mobile drawer — with the smooth-scroll runtime (NAV_LINK_JS) also shipped', () => {
  beforeEach(() => {
    build('/');
    // Registry order: nav-link is concatenated BEFORE sticky-header in core.js, so its bubble listener
    // is bound first. The close must not depend on that order.
    install(NAV_LINK_JS);
    install(STICKY_HEADER_JS);
  });

  it('closes the drawer BEFORE the smooth scroll starts (a scroll-locked page would otherwise not move)', () => {
    let checkedAtScroll: boolean | undefined;
    Element.prototype.scrollIntoView = function scrollIntoView(): void {
      checkedAtScroll = drawer().checked;
    };
    open();
    const e = click('about');
    expect(e.defaultPrevented).toBe(true); // NAV_LINK_JS took over the jump…
    expect(checkedAtScroll).toBe(false); // …and the drawer was already shut when it scrolled
    expect(drawer().checked).toBe(false);
  });

  it('still opens a dialog from a drawer link — and the drawer is closed behind it', () => {
    open();
    click('modal');
    expect((document.getElementById('contact-modal') as HTMLDialogElement).hasAttribute('open')).toBe(true);
    expect(drawer().checked).toBe(false);
  });

  it('fires exactly one change event even with both runtimes listening', () => {
    const seen = changes();
    open();
    click('pricing');
    expect(seen.count()).toBe(1);
  });
});
