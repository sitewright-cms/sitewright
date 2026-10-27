// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect } from 'vitest';
import { BookingConfigSchema } from '@sitewright/schema';
import { renderTemplate } from '../src/template.js';
import { bookingRenderContext, usesBooking, type RenderBooking } from '../src/booking.js';

/**
 * The booking helpers: what {{sw-booking}} and {{sw-booking-status}} put in the page for booking.js to fill.
 * The runtime's own behaviour is in booking.behavior.test.ts.
 */

const CONFIG = BookingConfigSchema.parse({
  resources: [{ id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', hours: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }] }],
  offerings: [{ id: 'massage', name: 'Massage <60 min>', resourceIds: ['anna'], mode: 'duration', durationMin: 60 }],
});

const ctx = (booking: RenderBooking | undefined, extra: Record<string, unknown> = {}) => ({ ...(booking ? { booking } : {}), ...extra });
const mount = (html: string): Element => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.querySelector('[data-sw-booking],[data-sw-booking-status]') as Element;
};
const labels = (el: Element): Record<string, string> => JSON.parse(el.getAttribute('data-sw-labels') ?? '{}') as Record<string, string>;

describe('bookingRenderContext', () => {
  it('carries the offerings, the gates and the status page, and nothing when nothing is offered', () => {
    expect(bookingRenderContext(undefined)).toBeUndefined();
    expect(bookingRenderContext(BookingConfigSchema.parse({}))).toBeUndefined();
    expect(bookingRenderContext(CONFIG)).toEqual({ offerings: { massage: { name: 'Massage <60 min>' } }, pow: false });
    const guarded = bookingRenderContext({ ...CONFIG, pow: true, captcha: true, statusPath: '/my-booking/' }, { provider: 'hcaptcha', siteKey: 'k-1' });
    expect(guarded).toEqual({ offerings: { massage: { name: 'Massage <60 min>' } }, pow: true, captcha: { provider: 'hcaptcha', siteKey: 'k-1' }, statusPath: '/my-booking/' });
    // The set-up asks for a captcha the project does not have: the API will refuse every booking.
    expect(bookingRenderContext({ ...CONFIG, captcha: true })?.captcha).toBe('missing');
    // A project captcha the set-up does not ask for stays off the page.
    expect(bookingRenderContext(CONFIG, { provider: 'hcaptcha', siteKey: 'k-1' })).not.toHaveProperty('captcha');
  });
});

describe('{{sw-booking}}', () => {
  const booking = bookingRenderContext(CONFIG)!;

  it('mounts the widget for a known offering, with its strings and no address', () => {
    const html = renderTemplate('{{sw-booking "massage"}}', ctx(booking));
    const el = mount(html);
    expect(el.getAttribute('data-sw-booking')).toBe('massage');
    expect(el.getAttribute('aria-label')).toBe('Massage <60 min>');
    expect(labels(el)['booking.submit']).toBe('Book');
    expect(labels(el)['booking.time_zone']).toBe('Times are shown in {zone}.');
    // The status page's own strings stay off the widget, and the emails' stay on the server.
    expect(labels(el)).not.toHaveProperty('booking.cancel_yes');
    expect(Object.keys(labels(el)).some((k) => k.startsWith('booking.mail_'))).toBe(false);
    expect(el.querySelector('[data-sw-part="loading"]')?.textContent).toBe('Loading available times…');
    expect(html).not.toContain('/b/');
    expect(el.hasAttribute('data-sw-pow')).toBe(false);
    expect(el.hasAttribute('data-sw-captcha')).toBe(false);
  });

  it('localizes its strings from the catalog for the page language', () => {
    const el = mount(renderTemplate('{{sw-booking "massage"}}', ctx(booking, { website: { t: { 'booking.submit': 'Buchen', 'booking.loading': 'Lädt <…>' } } })));
    expect(labels(el)['booking.submit']).toBe('Buchen');
    expect(labels(el)['booking.back']).toBe('Back');
    expect(el.querySelector('[data-sw-part="loading"]')?.textContent).toBe('Lädt <…>');
  });

  it('keeps the strings intact through the directive pass', () => {
    // Any data-sw-* directive on the page sends the whole fragment through a parse and serialize.
    const src = '<p data-sw-text="intro">Hi</p>{{sw-booking "massage"}}';
    const el = mount(renderTemplate(src, ctx(booking, { website: { t: { 'booking.submit': 'Book & pay <now>' } }, page: { data: { intro: 'Hello' } } })));
    expect(labels(el)['booking.submit']).toBe('Book & pay <now>');
  });

  it('names the spam gates and the status page the set-up asks for', () => {
    const guarded = bookingRenderContext({ ...CONFIG, pow: true, captcha: true, statusPath: '/my-booking/' }, { provider: 'recaptcha-v3', siteKey: 'site-key' })!;
    const el = mount(renderTemplate('{{sw-booking "massage" class="my-booking"}}', ctx(guarded)));
    expect(el.hasAttribute('data-sw-pow')).toBe(true);
    expect(el.getAttribute('data-sw-captcha')).toBe('recaptcha-v3');
    expect(el.getAttribute('data-captcha-sitekey')).toBe('site-key');
    expect(el.getAttribute('data-status-path')).toBe('/my-booking/');
    expect(el.getAttribute('class')).toBe('my-booking');
    const missing = mount(renderTemplate('{{sw-booking "massage"}}', ctx(bookingRenderContext({ ...CONFIG, captcha: true }))));
    expect(missing.hasAttribute('data-sw-captcha-missing')).toBe(true);
    expect(missing.hasAttribute('data-sw-captcha')).toBe(false);
  });

  it('renders nothing on the site for an unknown offering, and says so in the preview', () => {
    expect(renderTemplate('{{sw-booking "yoga"}}', ctx(booking))).toBe('');
    expect(renderTemplate('{{sw-booking "massage"}}', ctx(undefined))).toBe('');
    // An inherited name is not an offering.
    expect(renderTemplate('{{sw-booking "constructor"}}', ctx(booking))).toBe('');
    const note = renderTemplate('{{sw-booking "yoga"}}', ctx(booking, { preview: true }));
    expect(note).toContain('data-sw-booking-missing');
    expect(note).toContain('yoga');
    expect(note).not.toContain('data-sw-booking=');
    expect(renderTemplate('{{sw-booking}}', ctx(booking, { preview: true }))).toContain('Name the offering');
  });

  it('escapes the offering id it was given', () => {
    const note = renderTemplate('{{sw-booking "<img src=x>"}}', ctx(booking, { preview: true }));
    expect(note).not.toContain('<img');
  });
});

describe('{{sw-booking-status}}', () => {
  const booking = bookingRenderContext(CONFIG)!;

  it('emits a complete default page: loading shown, every state hidden until the script decides', () => {
    const el = mount(renderTemplate('{{sw-booking-status}}', ctx(booking)));
    expect(el.hasAttribute('data-sw-booking-status')).toBe(true);
    expect(el.querySelector('[data-sw-part="status-loading"]')?.hasAttribute('hidden')).toBe(false);
    for (const part of ['status-booked', 'status-pending', 'status-cancelled', 'status-unknown', 'details', 'cancel', 'cancel-confirm']) {
      expect(el.querySelector(`[data-sw-part="${part}"]`)?.hasAttribute('hidden'), part).toBe(true);
    }
    expect(el.querySelector('[data-sw-field="when"]')).not.toBeNull();
    expect(labels(el)['booking.started']).toMatch(/can no longer be cancelled/);
    // The widget's strings stay off the status page.
    expect(labels(el)).not.toHaveProperty('booking.submit');
  });

  it('keeps an authored page as written', () => {
    const src = '{{#sw-booking-status}}<p data-sw-part="status-booked" hidden>See you, {{company.name}}</p>{{/sw-booking-status}}';
    const el = mount(renderTemplate(src, ctx(booking, { company: { name: 'Studio' } })));
    expect(el.innerHTML).toBe('<p data-sw-part="status-booked" hidden="">See you, Studio</p>');
  });

  it('renders nothing for a project that offers nothing', () => {
    expect(renderTemplate('{{sw-booking-status}}', ctx(undefined))).toBe('');
  });
});

describe('usesBooking', () => {
  it('is true for the helpers and for their rendered mounts', () => {
    expect(usesBooking('{{sw-booking "massage"}}')).toBe(true);
    expect(usesBooking('{{#sw-booking-status}}{{/sw-booking-status}}')).toBe(true);
    expect(usesBooking('<div data-sw-booking="massage"></div>')).toBe(true);
    expect(usesBooking('{{~sw-booking "massage"~}}')).toBe(true);
    expect(usesBooking('<p>Book now</p>')).toBe(false);
    // Text that only mentions them ships nothing.
    expect(usesBooking('<p>Use the sw-booking helper.</p>')).toBe(false);
    expect(usesBooking('<div data-sw-booking-missing>…</div>')).toBe(false);
    expect(usesBooking(undefined)).toBe(false);
  });
});
