// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NOTICE_JS } from '../src/notice.js';

// Behavioral coverage: run the REAL shipped runtime string in a DOM and assert the show / dismiss /
// remember logic end-to-end (string-contains assertions in notice.test.ts can't prove behavior).
// The IIFE binds on document.readyState, which is 'complete' under jsdom, so it enhances synchronously.
function mountAndRun(html: string): void {
  document.body.innerHTML = html;
  // Execute our own trusted runtime string in the global scope (indirect eval), exactly as the
  // <script> would on a published page. Not user input — this is the build-output constant.
  (0, eval)(NOTICE_JS);
}

const notice = (attrs: string): string =>
  `<div data-sw-component="notice" data-sw-notice-id="promo" ${attrs} hidden>` +
  '<p>Latest product</p>' +
  '<button data-sw-part="dismiss" type="button">Close</button>' +
  '<button data-sw-part="dismiss-forever" type="button">Don\'t show again</button>' +
  '<button data-sw-part="remind" type="button">Later</button>' +
  '</div>';

const root = (): HTMLElement => document.querySelector('[data-sw-component="notice"]') as HTMLElement;
const click = (part: string): void => (root().querySelector(`[data-sw-part="${part}"]`) as HTMLButtonElement).click();

describe('Notice runtime behavior (jsdom)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = '';
  });

  it('reveals a not-yet-dismissed notice (removes the [hidden] attribute)', () => {
    mountAndRun(notice('data-frequency="once"'));
    expect(root().hasAttribute('hidden')).toBe(false);
    expect(root().getAttribute('data-sw-enhanced')).toBe('true');
  });

  it('"don\'t show again" stores a permanent record and stays hidden on the next load', () => {
    mountAndRun(notice('data-frequency="once"'));
    click('dismiss-forever');
    const rec = JSON.parse(localStorage.getItem('sw-notice:promo') as string);
    expect(rec.p).toBe(1);
    // A fresh load with the same storage never reveals it.
    mountAndRun(notice('data-frequency="once"'));
    expect(root().hasAttribute('hidden')).toBe(true);
  });

  it('a plain dismiss on a "once" notice is permanent', () => {
    mountAndRun(notice('data-frequency="once"'));
    click('dismiss');
    mountAndRun(notice('data-frequency="once"'));
    expect(root().hasAttribute('hidden')).toBe(true);
  });

  it('an "always" notice keeps no memory of a plain dismiss (returns next load) yet still honors "don\'t show again"', () => {
    mountAndRun(notice('data-frequency="always"'));
    click('dismiss');
    expect(localStorage.getItem('sw-notice:promo')).toBeNull(); // not remembered
    mountAndRun(notice('data-frequency="always"'));
    expect(root().hasAttribute('hidden')).toBe(false); // shows again
    // …but an explicit permanent dismiss still wins over the "always".
    click('dismiss-forever');
    mountAndRun(notice('data-frequency="always"'));
    expect(root().hasAttribute('hidden')).toBe(true);
  });

  it('a "session" dismiss stays hidden within the session but returns in a fresh session', () => {
    mountAndRun(notice('data-frequency="session"'));
    click('dismiss');
    mountAndRun(notice('data-frequency="session"'));
    expect(root().hasAttribute('hidden')).toBe(true); // same session id → still hidden
    // Simulate a new browser session (sessionStorage cleared, localStorage kept).
    sessionStorage.clear();
    mountAndRun(notice('data-frequency="session"'));
    expect(root().hasAttribute('hidden')).toBe(false); // new session → returns
  });

  it('tracks two notices independently by their data-sw-notice-id', () => {
    document.body.innerHTML =
      '<div data-sw-component="notice" data-sw-notice-id="a" data-frequency="once" hidden><button data-sw-part="dismiss-forever">x</button></div>' +
      '<div data-sw-component="notice" data-sw-notice-id="b" data-frequency="once" hidden><button data-sw-part="dismiss-forever">x</button></div>';
    (0, eval)(NOTICE_JS);
    (document.querySelector('[data-sw-notice-id="a"] [data-sw-part="dismiss-forever"]') as HTMLButtonElement).click();
    expect(localStorage.getItem('sw-notice:a')).not.toBeNull();
    expect(localStorage.getItem('sw-notice:b')).toBeNull(); // the other is untouched
  });

  it('a "days:N" dismiss reappears only after N days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    mountAndRun(notice('data-frequency="days:3"'));
    click('dismiss');
    vi.setSystemTime(new Date('2026-01-03T00:00:00Z')); // +2 days → still snoozed
    mountAndRun(notice('data-frequency="days:3"'));
    expect(root().hasAttribute('hidden')).toBe(true);
    vi.setSystemTime(new Date('2026-01-04T12:00:00Z')); // +3.5 days → returns
    mountAndRun(notice('data-frequency="days:3"'));
    expect(root().hasAttribute('hidden')).toBe(false);
    vi.useRealTimers();
  });

  it('clamps an invalid days:N (days:0 / non-numeric) to a 1-day reappearance — NOT "always re-show"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    mountAndRun(notice('data-frequency="days:0"'));
    click('dismiss');
    vi.setSystemTime(new Date('2026-01-01T06:00:00Z')); // same day → stays hidden (clamped to 1 day)
    mountAndRun(notice('data-frequency="days:0"'));
    expect(root().hasAttribute('hidden')).toBe(true);
    vi.setSystemTime(new Date('2026-01-02T06:00:00Z')); // next day → returns
    mountAndRun(notice('data-frequency="days:0"'));
    expect(root().hasAttribute('hidden')).toBe(false);
    vi.useRealTimers();
  });

  it('"remind" snoozes for data-remind-days then returns (overriding the base frequency)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    mountAndRun(notice('data-frequency="once" data-remind-days="5"'));
    click('remind');
    vi.setSystemTime(new Date('2026-01-04T00:00:00Z')); // +3 days → still snoozed
    mountAndRun(notice('data-frequency="once" data-remind-days="5"'));
    expect(root().hasAttribute('hidden')).toBe(true);
    vi.setSystemTime(new Date('2026-01-07T00:00:00Z')); // +6 days → returns
    mountAndRun(notice('data-frequency="once" data-remind-days="5"'));
    expect(root().hasAttribute('hidden')).toBe(false);
    vi.useRealTimers();
  });

  it('honors a numeric data-delay (revealed only after the delay elapses)', () => {
    vi.useFakeTimers();
    mountAndRun(notice('data-frequency="once" data-delay="500"'));
    expect(root().hasAttribute('hidden')).toBe(true); // not yet
    vi.advanceTimersByTime(600);
    expect(root().hasAttribute('hidden')).toBe(false); // revealed after the delay
    vi.useRealTimers();
  });

  it('reveals on first scroll for data-delay="scroll"', () => {
    mountAndRun(notice('data-frequency="once" data-delay="scroll"'));
    expect(root().hasAttribute('hidden')).toBe(true);
    window.dispatchEvent(new Event('scroll'));
    expect(root().hasAttribute('hidden')).toBe(false);
  });
});
