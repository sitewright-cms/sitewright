// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { componentAssets } from '../src/components.js';
import { themeCss } from '../src/theme-mode.js';

// The REAL shipped DateTimePicker runtime, run in a DOM exactly as a published page's <script> runs it.
//
// Why this exists: vanilla-calendar-pro 3.4.0 (a minor bump) moved the multi-month view and the time
// editor into opt-in EXTENSIONS that must be registered at construction. Our entry registered none, so
// every mode that needs one threw on init — `data-mode="range"` and any `data-months` >= 2 with "The
// 'type' option requires months", `datetime` / `time` with "The 'selectionTimeMode' option requires time".
// Only plain `date` kept working, and nothing ever constructed the other modes, so the bump went green.
// Agents fell back to two separate date fields. These tests construct EVERY documented mode.
const PICKER_JS = componentAssets(['DateTimePicker']).js;

/** Mount markup, then run the runtime (its IIFE enhances synchronously: readyState is 'complete'). */
function mountAndRun(html: string): void {
  document.body.innerHTML = html;
  // Indirect eval of our own trusted build-output constant, in the global scope.
  (0, eval)(PICKER_JS);
}

/** How many month grids the open calendar shows side by side. */
const monthGrids = (root: ParentNode = document): number => root.querySelectorAll('[data-vc="dates"]').length;

/** The popup calendar of an <input> picker — Vanilla Calendar Pro builds it on first click. */
function openPopup(input: HTMLInputElement): HTMLElement {
  input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const popup = document.querySelector<HTMLElement>('[data-vc="calendar"]');
  if (!popup) throw new Error('the picker popup did not open');
  return popup;
}

/** Click the day button for an ISO date inside the open calendar. */
function clickDay(iso: string): void {
  const btn = document.querySelector<HTMLButtonElement>(`[data-vc-date="${iso}"] [data-vc-date-btn]`);
  if (!btn) throw new Error(`no day button for ${iso}`);
  btn.click();
}

describe('DateTimePicker runtime — every documented mode constructs (jsdom)', () => {
  beforeAll(() => {
    // jsdom has no matchMedia; the library queries it for its layout/theme. A never-matching query is
    // what a real browser reports for anything this test does not care about.
    window.matchMedia = (media: string): MediaQueryList =>
      ({
        matches: false,
        media,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList;
  });
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.setAttribute('lang', 'en');
  });

  it('plain date mode shows one month (the baseline that always worked)', () => {
    mountAndRun('<div data-sw-component="datetimepicker"></div>');
    expect(document.querySelector('[data-vc="calendar"]')).not.toBeNull();
    expect(monthGrids()).toBe(1);
  });

  it('range mode renders the documented DUAL-PANEL view instead of throwing', () => {
    expect(() => mountAndRun('<div data-sw-component="datetimepicker" data-mode="range"></div>')).not.toThrow();
    expect(monthGrids()).toBe(2);
  });

  it('range mode honours data-months (3 panels side by side)', () => {
    mountAndRun('<div data-sw-component="datetimepicker" data-mode="range" data-months="3"></div>');
    expect(monthGrids()).toBe(3);
  });

  it('data-months >= 2 widens a plain date picker too', () => {
    mountAndRun('<div data-sw-component="datetimepicker" data-months="2"></div>');
    expect(monthGrids()).toBe(2);
  });

  it('a range INPUT opens a two-month popup and writes the picked span back as "start – end"', () => {
    // No data-min/data-max: the popup opens on TODAY's month, so a fixed bound would eventually disable
    // every visible day and turn this into a test that fails on a calendar date.
    mountAndRun('<input type="text" name="stay" data-sw-component="datetimepicker" data-mode="range" />');
    const input = document.querySelector<HTMLInputElement>('input[name="stay"]')!;
    const popup = openPopup(input);
    expect(monthGrids(popup)).toBe(2);
    // Two days of the FIRST panel's own month, whatever month that is.
    const days = Array.from(popup.querySelectorAll<HTMLElement>('[data-vc-date-month="current"]'), (el) => el.dataset.vcDate!);
    const start = days[0]!;
    const end = days[4]!;
    clickDay(start);
    clickDay(end);
    const fmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const label = (iso: string): string => fmt.format(new Date(`${iso}T00:00:00`));
    expect(input.value).toBe(`${label(start)} – ${label(end)}`);
  });

  it('datetime mode renders the calendar AND the time editor', () => {
    expect(() => mountAndRun('<div data-sw-component="datetimepicker" data-mode="datetime"></div>')).not.toThrow();
    expect(monthGrids()).toBe(1);
    expect(document.querySelector('[data-vc="time"]')).not.toBeNull();
  });

  it('time mode renders only the time editor', () => {
    expect(() => mountAndRun('<div data-sw-component="datetimepicker" data-mode="time"></div>')).not.toThrow();
    expect(document.querySelector('[data-vc="time"]')).not.toBeNull();
    expect(monthGrids()).toBe(0);
  });

  it('a range picker no longer takes the pickers AFTER it on the page down with it', () => {
    // The runtime enhances every marker in one pass, so the range picker's throw also left each later
    // picker in document order as a bare text box — a booking form lost its plain date field too.
    mountAndRun('<div id="a" data-sw-component="datetimepicker" data-mode="range"></div><div id="b" data-sw-component="datetimepicker"></div>');
    expect(monthGrids(document.getElementById('a')!)).toBe(2);
    expect(monthGrids(document.getElementById('b')!)).toBe(1);
  });
});

describe('DateTimePicker runtime — follows the SITE theme, live (jsdom)', () => {
  // The runtime decides light/dark from the site's surface token (--sw-color-base-100). jsdom resolves
  // custom properties through the cascade AND keeps a CSS Color 4 colour in its own space, exactly like
  // Chromium: the platform's dark token comes back as `oklch(0.2533 0.016 252.42)`, not rgb(). So these
  // tests run against the REAL theme stylesheet a themes-on site ships, plus a light brand palette.
  let os = false; // the emulated prefers-color-scheme: dark
  const osListeners = new Set<() => void>();
  let sheet: HTMLStyleElement;
  beforeAll(() => {
    window.matchMedia = (media: string): MediaQueryList =>
      ({
        get matches() {
          return media.includes('prefers-color-scheme: dark') ? os : false;
        },
        media,
        onchange: null,
        addEventListener: (_: string, fn: () => void) => osListeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => osListeners.delete(fn),
        addListener: (fn: () => void) => osListeners.add(fn),
        removeListener: (fn: () => void) => osListeners.delete(fn),
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  });
  beforeEach(() => {
    os = false;
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-sw-theme');
    sheet = document.createElement('style');
    sheet.textContent = ':root{--sw-color-base-100:#ffffff;--sw-color-base-content:#1f2937}\n' + themeCss();
    document.head.appendChild(sheet);
  });
  afterEach(() => {
    sheet.remove();
    document.documentElement.removeAttribute('data-sw-theme');
  });

  const themeOf = (el: Element | null): string | null => (el ? el.getAttribute('data-vc-theme') : null);
  /** MutationObserver callbacks are microtasks: let them run. */
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  it('a pinned dark site starts dark; a light one starts light', () => {
    document.documentElement.setAttribute('data-sw-theme', 'dark');
    mountAndRun('<div id="i" data-sw-component="datetimepicker"></div>');
    expect(themeOf(document.getElementById('i'))).toBe('dark');
    document.documentElement.setAttribute('data-sw-theme', 'light');
    mountAndRun('<div id="j" data-sw-component="datetimepicker"></div>');
    expect(themeOf(document.getElementById('j'))).toBe('light');
  });

  it('the theme toggle flipping <html data-sw-theme> re-themes an inline calendar AND an open popup', async () => {
    document.documentElement.setAttribute('data-sw-theme', 'light');
    mountAndRun('<div id="i" data-sw-component="datetimepicker"></div><input id="d" data-sw-component="datetimepicker" />');
    const popup = openPopup(document.getElementById('d') as HTMLInputElement);
    expect(themeOf(popup)).toBe('light');
    document.documentElement.setAttribute('data-sw-theme', 'dark');
    await settle();
    expect(themeOf(document.getElementById('i'))).toBe('dark');
    expect(themeOf(popup)).toBe('dark');
    document.documentElement.setAttribute('data-sw-theme', 'light');
    await settle();
    expect(themeOf(document.getElementById('i'))).toBe('light');
    expect(themeOf(popup)).toBe('light');
  });

  it('a popup first opened AFTER a flip opens in the new theme', async () => {
    document.documentElement.setAttribute('data-sw-theme', 'light');
    mountAndRun('<input id="d" data-sw-component="datetimepicker" />');
    document.documentElement.setAttribute('data-sw-theme', 'dark');
    await settle();
    expect(themeOf(openPopup(document.getElementById('d') as HTMLInputElement))).toBe('dark');
  });

  it("an 'auto' site follows the OS preference, including a change while the page is open", async () => {
    // No data-sw-theme: the prefers-color-scheme media query in themeCss governs the tokens. jsdom does
    // not evaluate @media, so emulate the OS flip on both ends: the tokens AND the change event.
    mountAndRun('<div id="i" data-sw-component="datetimepicker"></div>');
    expect(themeOf(document.getElementById('i'))).toBe('light');
    os = true;
    sheet.textContent += '\n:root:not([data-sw-theme]){--sw-color-base-100:oklch(25.33% 0.016 252.42)}';
    osListeners.forEach((fn) => fn());
    await settle();
    expect(themeOf(document.getElementById('i'))).toBe('dark');
  });

  it('reads a LIGHT oklch surface as light (not every non-rgb colour is dark)', () => {
    // A site may set its surface in oklch (identity.cssTokens / its own CSS). Reading the first three
    // numbers of `oklch(0.98 0.01 250)` as r,g,b made every such colour "dark".
    sheet.textContent += '\n:root{--sw-color-base-100:oklch(98% 0.01 250)}';
    mountAndRun('<div id="i" data-sw-component="datetimepicker"></div>');
    expect(themeOf(document.getElementById('i'))).toBe('light');
  });

  it('reads the LINEAR colour spaces on their own scale too (srgb-linear, xyz)', () => {
    // Their channels are light-linear: a dark grey is a small number, so it must not fall through to
    // "unknown → light", and a light one must not be read as gamma-encoded.
    for (const [surface, want] of [
      ['color(srgb-linear 0.01 0.012 0.015)', 'dark'],
      ['color(srgb-linear 0.6 0.6 0.6)', 'light'],
      ['color(xyz-d65 0.012 0.013 0.016)', 'dark'],
      ['color(xyz-d65 0.85 0.9 0.95)', 'light'],
    ] as const) {
      sheet.textContent = `:root{--sw-color-base-100:${surface}}`;
      mountAndRun('<div id="i" data-sw-component="datetimepicker"></div>');
      expect(themeOf(document.getElementById('i')), surface).toBe(want);
    }
  });

  it("the platform's own sw-* classes toggling on <html> (the sticky header, on scroll) do not re-probe", async () => {
    // The sticky header toggles sw-scrolled / sw-nav-hidden / … on <html> at every scroll-direction
    // change; none of them changes the palette, so none may cost a probe + style recalc.
    mountAndRun('<div id="i" data-sw-component="datetimepicker"></div>');
    const probes = vi.spyOn(window, 'getComputedStyle');
    try {
      const root = document.documentElement;
      for (const c of ['sw-scrolled', 'sw-nav-hidden', 'sw-header-offtop', 'sw-measure']) root.classList.add(c);
      await settle();
      root.classList.remove('sw-nav-hidden', 'sw-measure');
      await settle();
      expect(probes).not.toHaveBeenCalled();
      // An author's OWN class on <html> may be their dark switch — that one is still followed.
      root.classList.add('dark');
      await settle();
      expect(probes).toHaveBeenCalled();
    } finally {
      probes.mockRestore();
      document.documentElement.className = '';
    }
  });

  it('a theme attribute written with its CURRENT value does not re-probe', async () => {
    document.documentElement.setAttribute('data-sw-theme', 'light');
    mountAndRun('<div id="i" data-sw-component="datetimepicker"></div>');
    await settle(); // deliver the setup write above before counting
    const probes = vi.spyOn(window, 'getComputedStyle');
    try {
      document.documentElement.setAttribute('data-sw-theme', 'light');
      await settle();
      expect(probes).not.toHaveBeenCalled();
    } finally {
      probes.mockRestore();
    }
  });

  it('a picker removed from the page is dropped from the live re-theme', async () => {
    document.documentElement.setAttribute('data-sw-theme', 'light');
    mountAndRun('<div id="i" data-sw-component="datetimepicker"></div><div id="j" data-sw-component="datetimepicker"></div>');
    const gone = document.getElementById('i')!;
    gone.remove();
    document.documentElement.setAttribute('data-sw-theme', 'dark');
    await settle();
    expect(themeOf(gone)).toBe('light'); // no longer held + re-themed
    expect(themeOf(document.getElementById('j'))).toBe('dark');
  });
});
