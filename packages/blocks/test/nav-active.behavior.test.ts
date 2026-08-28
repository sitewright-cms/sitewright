// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NAV_ACTIVE_JS } from '../src/nav-active.js';

// Behavioral coverage for the click predicate + the highlight swap. String assertions can prove the
// runtime CONTAINS the same-origin/anchor guards; only running it can prove a `#section` click, an
// external link and a middle-click all leave the server-rendered highlight alone.

// The page we are "on" is /services — its link carries the server-rendered highlight.
const HERE = '/services';

function build(): void {
  window.history.replaceState({}, '', HERE);
  document.body.innerHTML =
    '<nav id="main-nav">' +
    // the brand mark sits in the landmark but OUTSIDE any .menu — never a nav item
    '<a id="brand" href="/">Acme</a>' +
    '<ul class="menu menu-horizontal">' +
    '<li><a id="home" href="/">Home</a></li>' +
    '<li><a id="services" href="/services" class="active" aria-current="page">Services</a></li>' +
    '<li><a id="about" href="/about">About</a></li>' +
    '<li><a id="team" href="#team">Our team</a></li>' +
    '<li><a id="docs" href="/docs" target="_blank">Docs</a></li>' +
    '<li><a id="ext" href="https://example.com/pricing">Partner</a></li>' +
    '<li><a id="mail" href="mailto:hi@example.com">Mail</a></li>' +
    '<li><a id="pdf" href="/brochure.pdf" download>Brochure</a></li>' +
    '</ul>' +
    // the header CTA — a .btn in the landmark, again outside the menu
    '<a id="cta" class="btn btn-primary" href="/contact">Get in touch</a>' +
    '</nav>' +
    // the same routes again in the footer menu: a click in the header must clear this one too
    '<footer id="footer"><ul class="menu"><li><a id="f-services" href="/services" class="active">Services</a></li>' +
    '<li><a id="f-about" href="/about">About</a></li></ul></footer>' +
    '<main id="page-content"><section id="team"></section>' +
    '<a id="body-about" href="/about">About us</a></main>';
}

// The runtime registers on `document` / `window`, which OUTLIVE a `document.body.innerHTML` reset — so
// a plain per-test eval would stack a new instance on every test and let a stale one handle the click
// first. Record what each install adds and unbind it afterwards, so every test runs exactly one copy.
type Bound = [EventTarget, string, EventListener, boolean];
let bound: Bound[] = [];
const run = (): void => {
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
    (0, eval)(NAV_ACTIVE_JS);
  } finally {
    document.addEventListener = doc;
    window.addEventListener = win;
  }
};

/** Every link the runtime governs that currently carries the highlight. */
const activeIds = (): string[] =>
  Array.from(document.querySelectorAll('a.active')).map((a) => (a as HTMLElement).id);

/** A plain left-button click, the way a visitor makes one. */
function click(id: string, init: MouseEventInit = {}): MouseEvent {
  const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  document.getElementById(id)!.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  build();
  run();
});

afterEach(() => {
  for (const [target, type, l, capture] of bound) target.removeEventListener(type, l, capture);
  bound = [];
});

describe('nav active-on-click — the swap', () => {
  it('moves .active to the clicked link, in every menu on the page', () => {
    expect(activeIds()).toEqual(['services', 'f-services']);
    click('about');
    expect(activeIds()).toEqual(['about']);
    // ...in the header AND the footer, so no menu is left pointing at the old route
    expect(document.getElementById('f-services')!.classList.contains('active')).toBe(false);
  });

  it('leaves aria-current where it is — the visitor has not arrived yet', () => {
    click('about');
    // Still /services until the navigation completes; announcing /about here would tell a screen
    // reader the visitor is somewhere they are not.
    expect(document.getElementById('services')!.getAttribute('aria-current')).toBe('page');
    expect(document.getElementById('about')!.getAttribute('aria-current')).toBeNull();
  });

  it('works from the footer menu too, clearing the header', () => {
    click('f-about');
    expect(activeIds()).toEqual(['f-about']);
  });

  it('never calls preventDefault — the browser still follows the link', () => {
    const e = click('about');
    expect(e.defaultPrevented).toBe(false);
  });

  it('is inert until a qualifying click — the initial highlight is untouched by loading', () => {
    expect(activeIds()).toEqual(['services', 'f-services']);
  });

  it('still highlights when a bubble-phase runtime takes over the navigation (the preloader bridge)', () => {
    // The preloader fades its overlay in and navigates itself, cancelling the click on the way up.
    // The highlight must not depend on which <script> tag happened to run first — hence the capture
    // listener, which sees the click on the way DOWN, before any of that.
    const swallow = (e: Event): void => e.preventDefault();
    document.addEventListener('click', swallow);
    try {
      click('about');
      expect(activeIds()).toEqual(['about']);
    } finally {
      document.removeEventListener('click', swallow);
    }
  });
});

describe('nav active-on-click — what it declines to touch', () => {
  const unchanged = (): void => expect(activeIds()).toEqual(['services', 'f-services']);

  it('leaves an in-page #anchor alone (scrollspy owns that highlight)', () => {
    click('team');
    unchanged();
  });

  it('leaves a link to the CURRENT page alone', () => {
    // /services is where we are — nothing navigates, so nothing should move.
    const same = document.createElement('a');
    same.id = 'same';
    same.href = HERE;
    document.querySelector('.menu')!.appendChild(same);
    click('same');
    unchanged();
  });

  it('leaves external links, mailto:, target=_blank and downloads alone', () => {
    click('ext');
    unchanged();
    click('mail');
    unchanged();
    click('docs');
    unchanged();
    click('pdf');
    unchanged();
  });

  it('leaves modified clicks alone (open-in-new-tab keeps this page)', () => {
    for (const mod of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
      click('about', mod);
      unchanged();
    }
    click('about', { button: 1 }); // middle-click
    unchanged();
  });

  it('leaves a click another runtime already handled alone', () => {
    // Pre-cancelled before dispatch — the state the runtime reads as `e.defaultPrevented`.
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    e.preventDefault();
    document.getElementById('about')!.dispatchEvent(e);
    unchanged();
  });

  it('ignores links outside a .menu — the brand mark, the header CTA, body content', () => {
    click('brand');
    unchanged();
    click('cta');
    unchanged();
    click('body-about');
    unchanged();
  });
});

describe('nav active-on-click — bfcache', () => {
  it('puts the server-rendered highlight back when the visitor comes Back to this page', () => {
    click('about');
    expect(activeIds()).toEqual(['about']);
    // Back to this page: the browser replays the DOM as we left it — highlight on the link that took
    // the visitor away. Without the restore the nav would claim they are on /about.
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(activeIds()).toEqual(['services', 'f-services']);
    // a NON-persisted pageshow (an ordinary load) must not rewind anything
    click('about');
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    expect(activeIds()).toEqual(['about']);
  });
});
