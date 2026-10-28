// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { webcrypto, createHash } from 'node:crypto';
import { BookingConfigSchema } from '@sitewright/schema';
import { BOOKING_JS } from '../src/booking-runtime.js';
import { bookingRenderContext } from '../src/booking.js';
import { renderTemplate } from '../src/template.js';

/**
 * ★ booking.js, driven through the real runtime against a scripted API.
 *
 * What would hurt most, in order: a booking sent for a time other than the one shown; a widget that
 * shows a time the visitor cannot read on the business's clock; a refusal that leaves the visitor stuck;
 * a preview that books for real; a status page that cancels from the editor.
 */

const MIN = 60_000;
const H = 60 * MIN;
// Monday 2 March 2026, 09:00 in Berlin (UTC+1 until the end of March).
const NOW = Date.UTC(2026, 2, 2, 8, 0);
const berlin = (day: number, hour: number, minute = 0) => Date.UTC(2026, 2, day, hour - 1, minute);

const CONFIG = BookingConfigSchema.parse({
  resources: [{ id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin' }],
  offerings: [{ id: 'massage', name: 'Massage', resourceIds: ['anna'], mode: 'duration', durationMin: 60 }],
  statusPath: '/my-booking/',
});

const DURATION = {
  id: 'massage', name: 'Massage', mode: 'duration', confirmation: 'instant', maxQuantity: 1,
  minNoticeMin: 0, maxAdvanceDays: 90, timeZone: 'Europe/Berlin', durationMin: 60,
};

interface Call { url: string; method: string; body?: Record<string, string> }
type Reply = { status: number; body: unknown };
// A route may answer later (a promise) or not at all (null: the network failed).
type Answer = Reply | null | Promise<Reply | null>;
let calls: Call[];
let route: (c: Call) => Answer;
let preview: boolean;

function widget(attrs: { pow?: boolean; captcha?: boolean; missing?: boolean } = {}): HTMLElement {
  const booking = bookingRenderContext(
    { ...CONFIG, pow: attrs.pow === true, captcha: attrs.captcha === true || attrs.missing === true },
    attrs.captcha ? { provider: 'hcaptcha', siteKey: 'site-key' } : undefined,
  );
  document.body.innerHTML = renderTemplate('{{sw-booking "massage"}}', { booking });
  (0, eval)(BOOKING_JS);
  return document.querySelector('[data-sw-booking]') as HTMLElement;
}
function statusPage(url: string): HTMLElement {
  window.history.replaceState({}, '', url);
  document.body.innerHTML = renderTemplate('{{sw-booking-status}}', { booking: bookingRenderContext(CONFIG) });
  (0, eval)(BOOKING_JS);
  return document.querySelector('[data-sw-booking-status]') as HTMLElement;
}
const part = (root: Element, name: string) => root.querySelector(`[data-sw-part="${name}"]`) as HTMLElement;
const parts = (root: Element, name: string) => Array.from(root.querySelectorAll(`[data-sw-part="${name}"]`)) as HTMLButtonElement[];
const shown = (el: Element | null) => !!el && !el.hasAttribute('hidden');
const posts = () => calls.filter((c) => c.method === 'POST');
const lists = () => calls.filter((c) => c.url.includes('/availability'));
const query = (c: Call) => new URL(c.url, 'https://site.test').searchParams;
const settle = () => new Promise((r) => setTimeout(r, 0));
async function until(check: () => void): Promise<void> {
  await vi.waitFor(check, { timeout: 2000, interval: 5 });
}
function fill(root: Element, values: Record<string, string>): void {
  for (const [name, value] of Object.entries(values)) {
    const el = root.querySelector(`[name="${name}"]`) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
function submit(root: Element): void {
  part(root, 'details').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  calls = [];
  preview = false;
  document.documentElement.lang = 'en-GB';
  window.history.replaceState({}, '', '/book/');
  const swb = (s: string, w?: unknown) => `/b/p1/${s}${w && preview ? '?preview=1' : ''}`;
  Object.defineProperty(swb, 'preview', { get: () => preview });
  (window as unknown as { __swb: unknown }).__swb = swb;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = { url, method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, string> } : {}) };
    calls.push(call);
    const reply = await route(call);
    if (!reply) throw new TypeError('Failed to fetch');
    return { status: reply.status, json: async () => reply.body } as Response;
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as unknown as { __swb?: unknown }).__swb;
});

describe('the widget: a week of times', () => {
  const times = [
    { start: berlin(2, 10), end: berlin(2, 11) },
    { start: berlin(2, 11), end: berlin(2, 12) },
    { start: berlin(4, 14), end: berlin(4, 15) },
  ];
  beforeEach(() => {
    route = (c) =>
      c.method === 'POST'
        ? { status: 200, body: { ok: true, reference: 'ref-1', state: 'booked', start: berlin(2, 11), end: berlin(2, 12) } }
        : { status: 200, body: { offering: DURATION, kind: 'times', times, truncated: false } };
  });

  it('shows the week on the business clock and books exactly the time picked', async () => {
    const root = widget();
    await until(() => expect(parts(root, 'time')).toHaveLength(2));
    // It asked from now, through the platform resolver, never a hard-coded address.
    expect(lists()[0]!.url.startsWith('/b/p1/massage/availability?')).toBe(true);
    expect(Number(query(lists()[0]!).get('from'))).toBe(NOW);
    expect(shown(part(root, 'loading'))).toBe(false);
    const days = parts(root, 'day');
    expect(days).toHaveLength(7);
    expect(days[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(days[1]!.disabled).toBe(true);
    expect(days[2]!.disabled).toBe(false);
    expect(parts(root, 'time').map((b) => b.textContent)).toEqual(['10:00', '11:00']);

    parts(root, 'time')[1]!.click();
    expect(shown(part(root, 'details'))).toBe(true);
    expect(shown(part(root, 'picker'))).toBe(false);
    expect(part(root, 'summary').textContent).toContain('11:00 – 12:00');
    expect(part(root, 'submit').textContent).toBe('Book');
    // One place per booking: no quantity to choose.
    expect(shown((root.querySelector('[name="quantity"]') as HTMLElement).parentElement)).toBe(false);

    fill(root, { name: 'Ada', email: 'ada@example.com', note: 'First time' });
    submit(root);
    await until(() => expect(shown(part(root, 'done'))).toBe(true));
    const sent = posts()[0]!;
    expect(sent.url).toBe('/b/p1/massage');
    expect(sent.body).toMatchObject({ name: 'Ada', email: 'ada@example.com', phone: '', note: 'First time', start: String(berlin(2, 11)), _hpt: '' });
    // The page's language, for the customer's emails.
    expect(sent.body!.lang).toBe('en-GB');
    expect(sent.body).not.toHaveProperty('end');
    expect(sent.body).not.toHaveProperty('quantity');
    expect(sent.body!._elapsed).toMatch(/^\d+$/);
    expect(sent.body!._ix).toMatch(/^\d+\.\d+\.\d+$/);
    expect(part(root, 'done-message').textContent).toBe('You are booked. A confirmation is on its way to your email.');
    // The way back to the booking is a page of the site, carrying the reference.
    // …in the fragment, which no server, Referer header or page-view beacon ever sees.
    expect(part(root, 'manage').getAttribute('href')).toBe('/my-booking/#t=ref-1');
  });

  it('passes a filled honeypot on, so the server’s trap sees what a bot wrote', async () => {
    const root = widget();
    await until(() => expect(parts(root, 'time')).toHaveLength(2));
    // Off-screen and out of the accessibility tree, never display:none (some bots skip hidden fields).
    expect(part(root, 'hp').getAttribute('aria-hidden')).toBe('true');
    parts(root, 'time')[0]!.click();
    fill(root, { name: 'Bot', email: 'bot@example.com', _hpt: 'http://spam.example' });
    submit(root);
    await until(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body!._hpt).toBe('http://spam.example');
  });

  it('goes back to the times, and starts afresh after a booking', async () => {
    route = (c) =>
      c.method === 'POST'
        ? { status: 200, body: { ok: true, reference: 'r', state: 'booked', start: berlin(2, 10), end: berlin(2, 11) } }
        : { status: 200, body: { offering: { ...DURATION, mode: 'slots', maxQuantity: 4 }, kind: 'times', times: times.map((x) => ({ ...x, places: 4 })), truncated: false } };
    const root = widget();
    await until(() => expect(parts(root, 'time')).toHaveLength(2));
    parts(root, 'time')[0]!.click();
    part(root, 'back').click();
    expect(shown(part(root, 'picker'))).toBe(true);
    expect(shown(part(root, 'details'))).toBe(false);
    expect(document.activeElement).toBe(parts(root, 'day')[0]);
    parts(root, 'time')[1]!.click();
    fill(root, { name: 'Ada', email: 'ada@example.com', quantity: '3' });
    submit(root);
    await until(() => expect(shown(part(root, 'done'))).toBe(true));
    part(root, 'another').click();
    await until(() => expect(lists()).toHaveLength(2));
    await until(() => expect(part(root, 'view').getAttribute('aria-busy')).toBe('false'));
    parts(root, 'time')[0]!.click();
    expect((root.querySelector('[name="quantity"]') as HTMLInputElement).value).toBe('1');
    expect((root.querySelector('[name="name"]') as HTMLInputElement).value).toBe('');
  });

  it('sends one booking however often the button is pressed', async () => {
    let answer: (r: Reply) => void = () => undefined;
    route = (c) =>
      c.method === 'POST' ? new Promise<Reply>((r) => { answer = r; }) : { status: 200, body: { offering: DURATION, kind: 'times', times, truncated: false } };
    const root = widget();
    await until(() => expect(parts(root, 'time')).toHaveLength(2));
    parts(root, 'time')[0]!.click();
    fill(root, { name: 'Ada', email: 'ada@example.com' });
    submit(root);
    submit(root);
    await until(() => expect(posts()).toHaveLength(1));
    expect((part(root, 'submit') as HTMLButtonElement).disabled).toBe(true);
    submit(root);
    answer({ status: 200, body: { ok: true, reference: 'r', state: 'booked', start: berlin(2, 10), end: berlin(2, 11) } });
    await until(() => expect(shown(part(root, 'done'))).toBe(true));
    expect(posts()).toHaveLength(1);
  });

  it('moves to another day of the week', async () => {
    const root = widget();
    await until(() => expect(parts(root, 'time')).toHaveLength(2));
    parts(root, 'day')[2]!.click();
    expect(parts(root, 'day')[2]!.getAttribute('aria-pressed')).toBe('true');
    expect(parts(root, 'time').map((b) => b.textContent)).toEqual(['14:00']);
  });

  it('sends a request, and says so, when the offering is confirmed by hand', async () => {
    route = (c) =>
      c.method === 'POST'
        ? { status: 200, body: { ok: true, reference: 'ref-2', state: 'pending', start: berlin(2, 10), end: berlin(2, 11) } }
        : { status: 200, body: { offering: { ...DURATION, confirmation: 'request' }, kind: 'times', times, truncated: false } };
    const root = widget();
    await until(() => expect(parts(root, 'time')).toHaveLength(2));
    parts(root, 'time')[0]!.click();
    expect(part(root, 'submit').textContent).toBe('Send request');
    fill(root, { name: 'Ada', email: 'ada@example.com' });
    submit(root);
    await until(() => expect(shown(part(root, 'done'))).toBe(true));
    expect(part(root, 'done-message').textContent).toBe('Your request is sent. You will hear back by email.');
  });

  it('sends the visitor back to choose again when the time went meanwhile', async () => {
    route = (c) =>
      c.method === 'POST' ? { status: 409, body: { error: 'taken' } } : { status: 200, body: { offering: DURATION, kind: 'times', times, truncated: false } };
    const root = widget();
    await until(() => expect(parts(root, 'time')).toHaveLength(2));
    parts(root, 'time')[0]!.click();
    fill(root, { name: 'Ada', email: 'ada@example.com' });
    submit(root);
    await until(() => expect(part(root, 'message').textContent).toBe('That time was just taken. Please choose another.'));
    expect(shown(part(root, 'picker'))).toBe(true);
    expect(shown(part(root, 'details'))).toBe(false);
    // …with a fresh listing.
    expect(lists().length).toBe(2);
  });

  it('marks the fields the server refused', async () => {
    route = (c) =>
      c.method === 'POST' ? { status: 400, body: { error: 'invalid-fields', fields: ['email'] } } : { status: 200, body: { offering: DURATION, kind: 'times', times, truncated: false } };
    const root = widget();
    await until(() => expect(parts(root, 'time')).toHaveLength(2));
    parts(root, 'time')[0]!.click();
    fill(root, { name: 'Ada', email: 'not-an-address' });
    submit(root);
    await until(() => expect(part(root, 'message').textContent).toBe('Please check your details.'));
    expect(root.querySelector('[name="email"]')!.getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector('[name="name"]')!.hasAttribute('aria-invalid')).toBe(false);
    expect(shown(part(root, 'details'))).toBe(true);
    expect((part(root, 'submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('books nothing from the editor preview', async () => {
    preview = true;
    route = (c) =>
      c.method === 'POST' ? { status: 200, body: { ok: true, preview: true } } : { status: 200, body: { offering: DURATION, kind: 'times', times, truncated: false } };
    // A captcha on the set-up is not asked for in the preview, where nothing is spent.
    const root = widget({ captcha: true });
    await until(() => expect(parts(root, 'time')).toHaveLength(2));
    parts(root, 'time')[0]!.click();
    expect(part(root, 'captcha')).toBeNull();
    fill(root, { name: 'Ada', email: 'ada@example.com' });
    submit(root);
    await until(() => expect(shown(part(root, 'done'))).toBe(true));
    expect(posts()[0]!.url).toBe('/b/p1/massage?preview=1');
    expect(part(root, 'done-message').textContent).toBe('Preview: this would be booked. Nothing was saved.');
    expect(part(root, 'manage')).toBeNull();
  });

  it('looks ahead to the first week with something free', async () => {
    const later = { start: berlin(16, 9), end: berlin(16, 10) };
    route = (c) => {
      const from = Number(query(c).get('from'));
      const list = from <= later.start && later.start < Number(query(c).get('to')) ? [later] : [];
      return { status: 200, body: { offering: DURATION, kind: 'times', times: list, truncated: false } };
    };
    const root = widget();
    await until(() => expect(parts(root, 'time')).toHaveLength(1));
    expect(lists().length).toBe(3);
    expect(part(root, 'range-label').textContent).toBe('16 Mar – 22 Mar');
    // The first page it asked for is this week on the business clock: from now to Monday next week, 00:00 Berlin.
    expect(Number(query(lists()[1]!).get('from'))).toBe(Date.UTC(2026, 2, 8, 23));
  });

  it('names the time zone when it is not the visitor’s', async () => {
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const far = own === 'Pacific/Chatham' ? 'Pacific/Kiritimati' : 'Pacific/Chatham';
    route = () => ({ status: 200, body: { offering: { ...DURATION, timeZone: far }, kind: 'times', times: [], truncated: false } });
    const root = widget();
    await until(() => expect(shown(part(root, 'note'))).toBe(true));
    expect(part(root, 'note').textContent).toMatch(/^Times are shown in .+\.$/);
    route = () => ({ status: 200, body: { offering: { ...DURATION, timeZone: own }, kind: 'times', times: [], truncated: false } });
    const same = widget();
    await until(() => expect(parts(same, 'day')).toHaveLength(7));
    expect(shown(part(same, 'note'))).toBe(false);
  });

  it('offers the resources by name when the visitor picks, and books the one picked', async () => {
    const offering = { ...DURATION, resources: [{ id: 'anna', name: 'Anna' }, { id: 'ben', name: 'Ben' }] };
    route = (c) =>
      c.method === 'POST'
        ? { status: 200, body: { ok: true, reference: 'r', state: 'booked', start: berlin(2, 10), end: berlin(2, 11) } }
        : { status: 200, body: { offering, kind: 'times', times: [{ ...times[0], resources: ['ben'] }], truncated: false } };
    const root = widget();
    await until(() => expect(root.querySelector('select[name="resource"]')).not.toBeNull());
    const select = root.querySelector('select[name="resource"]') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['No preference', 'Anna', 'Ben']);
    choose(select, 'ben');
    await until(() => expect(query(lists().at(-1)!).get('resource')).toBe('ben'));
    // While the new listing loads, the picker is busy: its buttons and the resource choice are disabled.
    expect(select.disabled).toBe(true);
    await until(() => expect(part(root, 'view').getAttribute('aria-busy')).toBe('false'));
    expect(select.disabled).toBe(false);
    expect(parts(root, 'time')).toHaveLength(1);
    parts(root, 'time')[0]!.click();
    fill(root, { name: 'Ada', email: 'ada@example.com' });
    submit(root);
    await until(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body!.resource).toBe('ben');
  });

  it('lets the visitor take several places where an offering sells them, up to what is left', async () => {
    route = (c) =>
      c.method === 'POST'
        ? { status: 200, body: { ok: true, reference: 'r', state: 'booked', start: berlin(2, 10), end: berlin(2, 11) } }
        : { status: 200, body: { offering: { ...DURATION, mode: 'slots', maxQuantity: 4 }, kind: 'times', times: [{ ...times[0], places: 3 }], truncated: false } };
    const root = widget();
    await until(() => expect(parts(root, 'time')).toHaveLength(1));
    parts(root, 'time')[0]!.click();
    const qty = root.querySelector('[name="quantity"]') as HTMLInputElement;
    expect(shown(qty.parentElement)).toBe(true);
    expect(qty.max).toBe('3');
    fill(root, { name: 'Ada', email: 'ada@example.com', quantity: '2' });
    submit(root);
    await until(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body!.quantity).toBe('2');
  });

  describe('a paid offering', () => {
    const PAID = { ...DURATION, mode: 'slots', maxQuantity: 4, price: { amountMinor: 2550, per: 'unit', currency: 'EUR', digits: 2 } };
    let assigned: string[];
    let real: Location;
    beforeEach(() => {
      assigned = [];
      real = window.location;
      // jsdom refuses a real navigation: capture where the widget sends the visitor instead.
      delete (window as unknown as Record<string, unknown>).location;
      (window as unknown as { location: unknown }).location = { ...real, assign: (u: string) => void assigned.push(u) };
    });
    afterEach(() => {
      (window as unknown as { location: unknown }).location = real;
    });
    const paidRoute = (pay: string) => (c: Call) =>
      c.method === 'POST'
        ? { status: 200, body: { ok: true, reference: 'r', state: 'hold', start: berlin(2, 10), end: berlin(2, 11), pay } }
        : { status: 200, body: { offering: PAID, kind: 'times', times: [{ ...times[0], places: 4 }], truncated: false } };

    it('shows the total for the places taken, and hands the visitor to the provider to pay', async () => {
      route = paidRoute('https://pay.example.test/s/1');
      const root = widget();
      await until(() => expect(parts(root, 'time')).toHaveLength(1));
      parts(root, 'time')[0]!.click();
      expect(part(root, 'submit').textContent).toBe('Book and pay');
      expect(shown(part(root, 'total'))).toBe(true);
      expect(part(root, 'total').textContent).toBe('Total: €25.50');
      fill(root, { name: 'Ada', email: 'ada@example.com', quantity: '3' });
      expect(part(root, 'total').textContent).toBe('Total: €76.50');
      submit(root);
      await until(() => expect(assigned).toEqual(['https://pay.example.test/s/1']));
      // What the browser sends names no amount: the server prices the booking.
      expect(Object.keys(posts()[0]!.body!).some((k) => /price|amount|total/i.test(k))).toBe(false);
      expect(part(root, 'done-message').textContent).toBe('Taking you to the payment…');
      expect(root.querySelector('[data-sw-part="manage"]')).toBeNull();
    });

    it('★ goes nowhere but https', async () => {
      route = paidRoute('javascript:alert(1)');
      const root = widget();
      await until(() => expect(parts(root, 'time')).toHaveLength(1));
      parts(root, 'time')[0]!.click();
      fill(root, { name: 'Ada', email: 'ada@example.com' });
      submit(root);
      await until(() => expect(part(root, 'message').textContent).toBe('Sorry, that did not work. Please try again.'));
      expect(assigned).toEqual([]);
      expect(shown(part(root, 'done'))).toBe(false);
    });

    it('a free offering shows no total', async () => {
      route = (c) => (c.method === 'POST' ? null : { status: 200, body: { offering: DURATION, kind: 'times', times, truncated: false } });
      const root = widget();
      await until(() => expect(parts(root, 'time')).toHaveLength(2));
      parts(root, 'time')[0]!.click();
      expect(shown(part(root, 'total'))).toBe(false);
    });
  });

  it('refuses up front when the set-up asks for a captcha the project does not have', async () => {
    const root = widget({ missing: true });
    await settle();
    expect(calls).toHaveLength(0);
    expect(part(root, 'message').textContent).toBe('Online booking is not available right now.');
    expect(shown(part(root, 'loading'))).toBe(false);
  });

  it('says so when the offering is gone', async () => {
    route = () => ({ status: 404, body: { error: 'not-found' } });
    const root = widget();
    await until(() => expect(part(root, 'message').textContent).toBe('Online booking is not available right now.'));
  });
});

describe('the widget: when things go wrong', () => {
  const ok = (times: unknown[], extra: Record<string, unknown> = {}) => ({ status: 200, body: { offering: DURATION, kind: 'times', times, truncated: false, ...extra } });

  it('offers to try again after a network failure, from where the visitor was', async () => {
    let down = false;
    route = (c) => (down ? null : ok(Number(query(c).get('from')) > berlin(8, 0) ? [{ start: berlin(10, 9), end: berlin(10, 10) }] : [{ start: berlin(2, 10), end: berlin(2, 11) }]));
    const root = widget();
    await until(() => expect(parts(root, 'time')).toHaveLength(1));
    down = true;
    (root.querySelector('[data-sw-nav="later"]') as HTMLButtonElement).click();
    await until(() => expect(shown(part(root, 'retry'))).toBe(true));
    expect(part(root, 'message').textContent).toBe('Sorry, that did not work. Please try again.');
    // The picker stays; only its buttons wait.
    expect(shown(part(root, 'picker'))).toBe(true);
    down = false;
    part(root, 'retry').click();
    await until(() => expect(part(root, 'range-label').textContent).toBe('9 Mar – 15 Mar'));
    expect(shown(part(root, 'retry'))).toBe(false);
    expect(part(root, 'message').textContent).toBe('');
    expect(parts(root, 'time').map((b) => b.textContent)).toEqual(['9:00']);
  });

  it('is never left stuck by an answer it cannot draw', async () => {
    // A malformed offering throws while the picker is built.
    let broken = true;
    route = () => (broken ? { status: 200, body: { offering: { ...DURATION, resources: [null, null] }, kind: 'times', times: [], truncated: false } } : ok([{ start: berlin(2, 10), end: berlin(2, 11) }]));
    const root = widget();
    await until(() => expect(shown(part(root, 'retry'))).toBe(true));
    expect(part(root, 'message').textContent).toBe('Sorry, that did not work. Please try again.');
    broken = false;
    part(root, 'retry').click();
    await until(() => expect(parts(root, 'time')).toHaveLength(1));
  });

  it('draws only the newest listing when an older answer arrives last', async () => {
    const offering = { ...DURATION, resources: [{ id: 'anna', name: 'Anna' }, { id: 'ben', name: 'Ben' }] };
    let release: (r: Reply) => void = () => undefined;
    route = (c) => {
      const res = query(c).get('resource');
      if (res === 'anna') return new Promise<Reply>((r) => { release = r; });
      const times = res === 'ben' ? [{ start: berlin(2, 15), end: berlin(2, 16) }] : [{ start: berlin(2, 10), end: berlin(2, 11) }];
      return { status: 200, body: { offering, kind: 'times', times, truncated: false } };
    };
    const root = widget();
    await until(() => expect(root.querySelector('select[name="resource"]')).not.toBeNull());
    const select = root.querySelector('select[name="resource"]') as HTMLSelectElement;
    choose(select, 'anna');
    choose(select, 'ben');
    await until(() => expect(parts(root, 'time').map((b) => b.textContent)).toEqual(['15:00']));
    release({ status: 200, body: { offering, kind: 'times', times: [{ start: berlin(2, 11), end: berlin(2, 12) }], truncated: false } });
    await settle();
    expect(parts(root, 'time').map((b) => b.textContent)).toEqual(['15:00']);
  });

  it('fetches a day on its own when the week’s listing was cut short', async () => {
    route = (c) => {
      const from = Number(query(c).get('from'));
      const to = Number(query(c).get('to'));
      // The week: cut after Tuesday. A single day: complete.
      if (to - from > 2 * 24 * H) return ok([{ start: berlin(2, 10), end: berlin(2, 11) }, { start: berlin(3, 10), end: berlin(3, 11) }], { truncated: true });
      return ok([{ start: berlin(5, 9), end: berlin(5, 10) }, { start: berlin(5, 16), end: berlin(5, 17) }]);
    };
    const root = widget();
    await until(() => expect(parts(root, 'time')).toHaveLength(1));
    const days = parts(root, 'day');
    // Tuesday's listing may be incomplete, and every day after it is unknown: none is shown as closed.
    expect(days[1]!.disabled).toBe(false);
    expect(days[3]!.disabled).toBe(false);
    days[3]!.click();
    await until(() => expect(parts(root, 'time').map((b) => b.textContent)).toEqual(['9:00', '16:00']));
    const single = lists().at(-1)!;
    expect(Number(query(single).get('from'))).toBe(Date.UTC(2026, 2, 4, 23));
    expect(Number(query(single).get('to'))).toBe(Date.UTC(2026, 2, 5, 23));
    expect(parts(root, 'day')[3]!.getAttribute('aria-pressed')).toBe('true');
    expect(parts(root, 'day')[0]!.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps a time on its own date where the clocks skip midnight', async () => {
    // Santiago, 6 September 2026: 23:59 is followed by 01:00, so that date begins at 01:00.
    vi.setSystemTime(Date.UTC(2026, 8, 3, 15));
    const santiago = { ...DURATION, timeZone: 'America/Santiago' };
    route = () => ({ status: 200, body: { offering: santiago, kind: 'times', times: [
      { start: Date.parse('2026-09-06T03:30:00Z'), end: Date.parse('2026-09-06T04:30:00Z') },
      { start: Date.parse('2026-09-06T05:30:00Z'), end: Date.parse('2026-09-06T06:30:00Z') },
    ], truncated: false } });
    const root = widget();
    await until(() => expect(parts(root, 'time')).toHaveLength(1));
    // 23:30 on the 5th is the 5th's; 02:30 on the 6th (summer time by then) is the 6th's.
    expect(parts(root, 'day')[2]!.getAttribute('aria-pressed')).toBe('true');
    expect(parts(root, 'time').map((b) => b.textContent)).toEqual(['23:30']);
    parts(root, 'day')[3]!.click();
    expect(parts(root, 'time').map((b) => b.textContent)).toEqual(['2:30']);
  });
});

describe('the widget: a captcha', () => {
  let vendor: { render: ReturnType<typeof vi.fn>; getResponse: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vendor = { render: vi.fn(() => 7), getResponse: vi.fn((id: number) => (id === 7 ? 'answer-7' : 'someone-else')), reset: vi.fn() };
    (window as unknown as { hcaptcha: unknown }).hcaptcha = vendor;
  });
  afterEach(() => {
    delete (window as unknown as { hcaptcha?: unknown }).hcaptcha;
  });

  it('renders its own widget, sends that widget’s answer, and resets that widget when refused', async () => {
    let refuse = true;
    route = (c) =>
      c.method === 'POST'
        ? refuse ? { status: 400, body: { error: 'captcha-failed' } } : { status: 200, body: { ok: true, reference: 'r', state: 'booked', start: berlin(2, 10), end: berlin(2, 11) } }
        : { status: 200, body: { offering: DURATION, kind: 'times', times: [{ start: berlin(2, 10), end: berlin(2, 11) }], truncated: false } };
    const root = widget({ captcha: true });
    await until(() => expect(parts(root, 'time')).toHaveLength(1));
    parts(root, 'time')[0]!.click();
    const box = part(root, 'captcha');
    expect(vendor.render).toHaveBeenCalledWith(box, { sitekey: 'site-key' });
    // No vendor class: the vendor's own auto-render (a contact form's) never touches this box.
    expect(box.className).toBe('');
    fill(root, { name: 'Ada', email: 'ada@example.com' });
    submit(root);
    await until(() => expect(part(root, 'message').textContent).toBe('Please complete the captcha.'));
    expect(posts()[0]!.body!['h-captcha-response']).toBe('answer-7');
    expect(vendor.reset).toHaveBeenCalledWith(7);
    refuse = false;
    submit(root);
    await until(() => expect(shown(part(root, 'done'))).toBe(true));
  });

  it('asks for the captcha before sending anything when it is not done', async () => {
    vendor.getResponse.mockReturnValue('');
    route = () => ({ status: 200, body: { offering: DURATION, kind: 'times', times: [{ start: berlin(2, 10), end: berlin(2, 11) }], truncated: false } });
    const root = widget({ captcha: true });
    await until(() => expect(parts(root, 'time')).toHaveLength(1));
    parts(root, 'time')[0]!.click();
    fill(root, { name: 'Ada', email: 'ada@example.com' });
    submit(root);
    await until(() => expect(part(root, 'message').textContent).toBe('Please complete the captcha.'));
    expect(posts()).toHaveLength(0);
  });
});

describe('the widget: a start and a length', () => {
  const RANGE = { ...DURATION, mode: 'range', minMin: 60, maxMin: 180, stepMin: 30 };
  it('offers every start that fits and the lengths that fit after it, and books start and end', async () => {
    route = (c) =>
      c.method === 'POST'
        ? { status: 200, body: { ok: true, reference: 'r', state: 'booked', start: berlin(2, 10, 30), end: berlin(2, 12) } }
        : { status: 200, body: { offering: RANGE, kind: 'windows', windows: [{ start: berlin(2, 10), end: berlin(2, 13) }], truncated: false } };
    const root = widget();
    await until(() => expect(root.querySelector('select[name="start"]')).not.toBeNull());
    const start = root.querySelector('select[name="start"]') as HTMLSelectElement;
    const len = root.querySelector('select[name="length"]') as HTMLSelectElement;
    expect(Array.from(start.options).map((o) => o.textContent)).toEqual(['10:00', '10:30', '11:00', '11:30', '12:00']);
    choose(start, '1');
    // From 10:30 the stretch leaves 2½ hours: 1:00 to 2:30, in steps of 30 minutes.
    expect(Array.from(len.options).map((o) => o.value)).toEqual(['60', '90', '120', '150']);
    expect(len.options[1]!.textContent).toBe('10:30 – 12:00 (1:30)');
    choose(len, '90');
    part(root, 'continue').click();
    expect(part(root, 'summary').textContent).toContain('10:30 – 12:00');
    fill(root, { name: 'Ada', email: 'ada@example.com' });
    submit(root);
    await until(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ start: String(berlin(2, 10, 30)), end: String(berlin(2, 12)) });
  });
});

describe('the widget: nights on a calendar', () => {
  const NIGHTS = { ...DURATION, mode: 'days', unit: 'night', minUnits: 1, maxUnits: 7, checkIn: '15:00', checkOut: '11:00' };
  const free = ['2026-03-05', '2026-03-06', '2026-03-07', '2026-03-10'].map((date) => ({ date }));
  beforeEach(() => {
    route = (c) =>
      c.method === 'POST'
        ? { status: 200, body: { ok: true, reference: 'r', state: 'booked', start: berlin(5, 15), end: berlin(7, 11) } }
        : { status: 200, body: { offering: NIGHTS, kind: 'days', days: free, truncated: false } };
  });
  const day = (root: Element, date: string) => root.querySelector(`[data-sw-part="day"][aria-label="${new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(Date.parse(date))}"]`) as HTMLButtonElement;

  it('asks once for the whole horizon, and books check-in and the number of nights', async () => {
    const root = widget();
    await until(() => expect(part(root, 'range-label')?.textContent).toBe('March 2026'));
    const horizon = lists().at(-1)!;
    expect(Number(query(horizon).get('to')) - Number(query(horizon).get('from'))).toBe(90 * 24 * H);
    expect(day(root, '2026-03-04').disabled).toBe(true);
    expect(day(root, '2026-03-05').disabled).toBe(false);
    // The calendar starts on Monday: March 2026 begins on a Sunday, so six fillers come first.
    expect(parts(root, 'filler')).toHaveLength(6);

    day(root, '2026-03-05').click();
    expect(part(root, 'hint').textContent).toBe('Now choose your check-out date.');
    // Check-out can be any morning the nights up to it are free: the 6th, 7th or 8th, not the 9th.
    expect(day(root, '2026-03-08').disabled).toBe(false);
    expect(day(root, '2026-03-09').disabled).toBe(true);
    day(root, '2026-03-07').click();
    expect(day(root, '2026-03-06').hasAttribute('data-sw-in-range')).toBe(true);
    expect(part(root, 'summary').textContent).toContain('Nights: 2');
    expect(part(root, 'summary').textContent).toContain('15:00');
    part(root, 'continue').click();
    fill(root, { name: 'Ada', email: 'ada@example.com' });
    submit(root);
    await until(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ date: '2026-03-05', units: '2' });
    expect(posts()[0]!.body).not.toHaveProperty('start');
  });

  it('books whole days across the end of a month, and keeps the choice while paging', async () => {
    const DAYS = { ...NIGHTS, unit: 'day', minUnits: 2, maxUnits: 5 };
    route = (c) =>
      c.method === 'POST'
        ? { status: 200, body: { ok: true, reference: 'r', state: 'booked', start: berlin(30, 0), end: Date.UTC(2026, 3, 1, 22) } }
        : { status: 200, body: { offering: DAYS, kind: 'days', days: ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02'].map((date) => ({ date })), truncated: false } };
    const root = widget();
    await until(() => expect(part(root, 'range-label')?.textContent).toBe('March 2026'));
    day(root, '2026-03-30').click();
    (root.querySelector('[data-sw-nav="later"]') as HTMLButtonElement).click();
    expect(part(root, 'range-label').textContent).toBe('April 2026');
    // The last day may be the 31st (2 days) to the 2nd (4 days); the 3rd is not free.
    expect(day(root, '2026-04-02').disabled).toBe(false);
    expect(day(root, '2026-04-03').disabled).toBe(true);
    day(root, '2026-04-01').click();
    expect(part(root, 'summary').textContent).toContain('Days: 3');
    // Focus stays on the date just picked, not on the page body.
    expect(document.activeElement).toBe(day(root, '2026-04-01'));
    part(root, 'continue').click();
    fill(root, { name: 'Ada', email: 'ada@example.com' });
    submit(root);
    await until(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toMatchObject({ date: '2026-03-30', units: '3' });
  });

  it('pages only as far as the listing it fetched, at most 400 days', async () => {
    route = () => ({ status: 200, body: { offering: { ...NIGHTS, maxAdvanceDays: 730 }, kind: 'days', days: free, truncated: false } });
    const root = widget();
    await until(() => expect(part(root, 'range-label')?.textContent).toBe('March 2026'));
    let pages = 0;
    for (let later = root.querySelector('[data-sw-nav="later"]') as HTMLButtonElement; !later.disabled && pages < 40; pages += 1) {
      later.click();
      later = root.querySelector('[data-sw-nav="later"]') as HTMLButtonElement;
    }
    // 400 days from 2 March 2026 is 6 April 2027: thirteen pages on, and no further.
    expect(pages).toBe(13);
    expect(part(root, 'range-label').textContent).toBe('April 2027');
  });

  it('takes a single possible night without a second click', async () => {
    const root = widget();
    await until(() => expect(part(root, 'range-label')?.textContent).toBe('March 2026'));
    day(root, '2026-03-10').click();
    expect(part(root, 'summary').textContent).toContain('Nights: 1');
  });
});

describe('the widget: proof of work', () => {
  it('solves the challenge and sends the solution, fetching a new one once when it went stale', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const salt = 'salt-1';
    const challenge = createHash('sha256').update(`${salt}3`).digest('hex');
    let refusals = 0;
    route = (c) => {
      if (c.url.endsWith('/challenge')) return { status: 200, body: { algorithm: 'SHA-256', challenge, salt, maxnumber: 10, signature: 'sig' } };
      if (c.method === 'POST') {
        if (refusals++ === 0) return { status: 400, body: { error: 'challenge-failed' } };
        return { status: 200, body: { ok: true, reference: 'r', state: 'booked', start: berlin(2, 10), end: berlin(2, 11) } };
      }
      return { status: 200, body: { offering: DURATION, kind: 'times', times: [{ start: berlin(2, 10), end: berlin(2, 11) }], truncated: false } };
    };
    const root = widget({ pow: true });
    await until(() => expect(parts(root, 'time')).toHaveLength(1));
    parts(root, 'time')[0]!.click();
    fill(root, { name: 'Ada', email: 'ada@example.com' });
    submit(root);
    await until(() => expect(shown(part(root, 'done'))).toBe(true));
    expect(calls.filter((c) => c.url === '/b/p1/massage/challenge')).toHaveLength(2);
    expect(posts()).toHaveLength(2);
    const pow = JSON.parse(atob(posts()[1]!.body!._pow!)) as Record<string, unknown>;
    expect(pow).toEqual({ algorithm: 'SHA-256', challenge, salt, number: 3, signature: 'sig' });
  });
});

describe('a booking’s own page', () => {
  const BOOKED = {
    state: 'booked', start: berlin(2, 10), end: berlin(2, 11), quantity: 1, cancellable: true,
    offering: { id: 'massage', name: 'Massage', mode: 'duration', timeZone: 'Europe/Berlin' },
  };

  it('shows the booking and cancels it after a second, explicit yes', async () => {
    route = (c) => (c.method === 'POST' ? { status: 200, body: { ok: true } } : { status: 200, body: BOOKED });
    const root = statusPage('/my-booking/#t=ref-1');
    await until(() => expect(shown(part(root, 'status-booked'))).toBe(true));
    expect(calls[0]!.url).toBe('/b/p1/_booking/ref-1');
    expect(shown(part(root, 'status-loading'))).toBe(false);
    expect(root.querySelector('[data-sw-field="offering"]')!.textContent).toBe('Massage');
    expect(root.querySelector('[data-sw-field="when"]')!.textContent).toBe('Mon, 2 Mar 2026, 10:00 – 11:00');
    part(root, 'cancel').click();
    expect(posts()).toHaveLength(0);
    expect(shown(part(root, 'cancel-confirm'))).toBe(true);
    part(root, 'cancel-no').click();
    expect(shown(part(root, 'cancel'))).toBe(true);
    part(root, 'cancel').click();
    part(root, 'cancel-yes').click();
    await until(() => expect(shown(part(root, 'status-cancelled'))).toBe(true));
    expect(posts()[0]!.url).toBe('/b/p1/_booking/ref-1/cancel');
    expect(shown(part(root, 'status-booked'))).toBe(false);
    expect(shown(part(root, 'details'))).toBe(false);
  });

  it('shows a request as waiting, and offers no cancel once it has started', async () => {
    route = () => ({ status: 200, body: { ...BOOKED, state: 'pending', cancellable: false } });
    // A query reference (an older link) is read too.
    const root = statusPage('/my-booking/?t=ref-1');
    await until(() => expect(shown(part(root, 'status-pending'))).toBe(true));
    expect(calls[0]!.url).toBe('/b/p1/_booking/ref-1');
    expect(shown(part(root, 'cancel'))).toBe(false);
  });

  it('never reads a time that is only held as booked: it waits for its payment', async () => {
    route = () => ({ status: 200, body: { ...BOOKED, state: 'hold' } });
    const root = statusPage('/my-booking/#t=ref-1');
    await until(() => expect(shown(part(root, 'status-payment'))).toBe(true));
    expect(part(root, 'status-payment').textContent).toBe('Your booking is waiting for its payment. It is confirmed as soon as the payment arrives.');
    expect(shown(part(root, 'status-booked'))).toBe(false);
    expect(shown(part(root, 'status-pending'))).toBe(false);
  });

  it('says it could not find a booking without a reference, or one the platform does not know', async () => {
    route = () => ({ status: 404, body: { error: 'not-found' } });
    const none = statusPage('/my-booking/');
    await settle();
    expect(calls).toHaveLength(0);
    expect(shown(part(none, 'status-unknown'))).toBe(true);
    const gone = statusPage('/my-booking/?t=forged');
    await until(() => expect(shown(part(gone, 'status-unknown'))).toBe(true));
  });

  it('★ says what cancelling a paid booking does with the money, before the customer says yes', async () => {
    route = () => ({ status: 200, body: { ...BOOKED, refund: 'none' } });
    const root = statusPage('/my-booking/#t=ref-1');
    await until(() => expect(shown(part(root, 'cancel'))).toBe(true));
    // It is part of the confirmation, which shows when the customer asks to cancel.
    expect(shown(part(root, 'cancel-confirm'))).toBe(false);
    part(root, 'cancel').click();
    expect(shown(part(root, 'cancel-confirm'))).toBe(true);
    expect(shown(part(root, 'cancel-refund'))).toBe(true);
    expect(part(root, 'cancel-refund').textContent).toBe('It is too close to its start for a refund: your payment will not be refunded.');
    expect(posts()).toHaveLength(0);
  });

  it('says a paid booking cancelled in time is refunded, and nothing of money for a free one', async () => {
    route = () => ({ status: 200, body: { ...BOOKED, refund: 'full' } });
    const paid = statusPage('/my-booking/#t=ref-1');
    await until(() => expect(shown(part(paid, 'cancel'))).toBe(true));
    expect(part(paid, 'cancel-refund').textContent).toBe('Your payment will be refunded in full.');
    route = () => ({ status: 200, body: BOOKED });
    const free = statusPage('/my-booking/#t=ref-2');
    await until(() => expect(shown(part(free, 'cancel'))).toBe(true));
    expect(part(free, 'cancel-refund').textContent).toBe('');
  });

  it('★ adds the warning to an authored confirmation that has no place for it', async () => {
    route = () => ({ status: 200, body: { ...BOOKED, refund: 'none' } });
    window.history.replaceState({}, '', '/my-booking/#t=ref-1');
    const booking = bookingRenderContext(CONFIG);
    document.body.innerHTML = renderTemplate(
      '{{#sw-booking-status}}<p data-sw-part="status-booked" hidden>Booked</p><button data-sw-part="cancel" hidden>Cancel</button>' +
        '<div data-sw-part="cancel-confirm" hidden><p>Sure?</p><button data-sw-part="cancel-yes">Yes</button></div><p data-sw-part="message"></p>{{/sw-booking-status}}',
      { booking },
    );
    (0, eval)(BOOKING_JS);
    const root = document.querySelector('[data-sw-booking-status]') as HTMLElement;
    await until(() => expect(shown(part(root, 'cancel'))).toBe(true));
    const added = part(root, 'cancel-refund');
    expect(added.textContent).toBe('It is too close to its start for a refund: your payment will not be refunded.');
    // Before the yes, inside the confirmation.
    expect(added.nextElementSibling).toBe(part(root, 'cancel-yes'));
  });

  describe('an accepted paid request', () => {
    let assigned: string[];
    let real: Location;
    beforeEach(() => {
      assigned = [];
      real = window.location;
    });
    afterEach(() => {
      (window as unknown as { location: unknown }).location = real;
    });
    // Once the page has read its reference: jsdom refuses a real navigation, so where it would go is captured.
    const captureNavigation = () => {
      const now = window.location;
      delete (window as unknown as Record<string, unknown>).location;
      (window as unknown as { location: unknown }).location = { ...now, assign: (u: string) => void assigned.push(u) };
    };
    const HELD = { ...BOOKED, state: 'hold', payable: true, payBy: berlin(2, 20) };

    it('★ shows its deadline and takes the customer to pay, only to https', async () => {
      route = (c) => (c.method === 'POST' ? { status: 200, body: { ok: true, pay: 'https://pay.example.test/s/9' } } : { status: 200, body: HELD });
      const root = statusPage('/my-booking/#t=ref-1');
      await until(() => expect(shown(part(root, 'pay'))).toBe(true));
      expect(shown(part(root, 'status-payment'))).toBe(true);
      expect(part(root, 'pay').textContent).toBe('Pay now');
      expect(part(root, 'pay-by').textContent).toBe('Pay by: Mon, 2 Mar 2026, 20:00');
      captureNavigation();
      part(root, 'pay').click();
      await until(() => expect(assigned).toEqual(['https://pay.example.test/s/9']));
      expect(posts()[0]!.url).toBe('/b/p1/_booking/ref-1/pay');
      expect(posts()[0]!.body).toEqual({ lang: 'en-GB' });
    });

    it('goes nowhere but https, and offers no payment for a booking that is not waiting for one', async () => {
      route = (c) => (c.method === 'POST' ? { status: 200, body: { ok: true, pay: 'http://pay.example.test/s/9' } } : { status: 200, body: HELD });
      const root = statusPage('/my-booking/#t=ref-1');
      await until(() => expect(shown(part(root, 'pay'))).toBe(true));
      captureNavigation();
      part(root, 'pay').click();
      await until(() => expect(part(root, 'message').textContent).toBe('Sorry, that did not work. Please try again.'));
      expect(assigned).toEqual([]);
      route = () => ({ status: 200, body: BOOKED });
      const booked = statusPage('/my-booking/#t=ref-2');
      await until(() => expect(shown(part(booked, 'status-booked'))).toBe(true));
      expect(shown(part(booked, 'pay'))).toBe(false);
    });

    it('never starts a payment from the editor preview', async () => {
      preview = true;
      route = () => ({ status: 200, body: HELD });
      const root = statusPage('/my-booking/#t=ref-1');
      await until(() => expect(shown(part(root, 'pay'))).toBe(true));
      part(root, 'pay').click();
      expect(posts()).toHaveLength(0);
    });
  });

  it('tells the visitor when it is too late to cancel', async () => {
    route = (c) => (c.method === 'POST' ? { status: 409, body: { error: 'started' } } : { status: 200, body: BOOKED });
    const root = statusPage('/my-booking/?t=ref-1');
    await until(() => expect(shown(part(root, 'cancel'))).toBe(true));
    part(root, 'cancel').click();
    part(root, 'cancel-yes').click();
    await until(() => expect(part(root, 'message').textContent).toBe('This booking has started, so it can no longer be cancelled online.'));
  });

  it('never cancels from the editor preview', async () => {
    preview = true;
    route = () => ({ status: 200, body: BOOKED });
    const root = statusPage('/my-booking/?t=ref-1');
    await until(() => expect(shown(part(root, 'cancel'))).toBe(true));
    part(root, 'cancel').click();
    part(root, 'cancel-yes').click();
    await settle();
    expect(posts()).toHaveLength(0);
    expect(part(root, 'message').textContent).toBe('Preview: this would be booked. Nothing was saved.');
  });

  it('reads a stay by its dates and times', async () => {
    route = () => ({ status: 200, body: { ...BOOKED, start: berlin(5, 15), end: berlin(7, 11), offering: { ...BOOKED.offering, mode: 'days', unit: 'night' } } });
    const root = statusPage('/my-booking/?t=ref-1');
    await until(() => expect(root.querySelector('[data-sw-field="when"]')!.textContent).toBe('Thu, 5 Mar 2026, 15:00 – Sat, 7 Mar 2026, 11:00'));
  });
});
