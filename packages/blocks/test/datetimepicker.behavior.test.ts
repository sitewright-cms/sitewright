// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { componentAssets } from '../src/components.js';

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
