import { describe, it, expect } from 'vitest';
import { RESERVED_TRANSLATION_DEFAULTS } from '@sitewright/schema';
import { bookingMails, bookingWhen, type BookingMailFacts } from '../src/booking/mails.js';

/**
 * What one booking event sends, and to whom. ★ White-label throughout: the customer's link is the business's
 * site, replies go to the business, and nothing names the platform.
 */

const en = (key: string): string => RESERVED_TRANSLATION_DEFAULTS[key] ?? '';
const FACTS: BookingMailFacts = {
  kind: 'booked',
  claimId: 'c-1',
  offering: { name: 'Massage', mode: 'duration' },
  timeZone: 'Europe/Berlin',
  // Wednesday 28 October 2026, 10:00 to 11:00 in Berlin.
  start: Date.UTC(2026, 9, 28, 9, 0),
  end: Date.UTC(2026, 9, 28, 10, 0),
  quantity: 1,
  customer: { name: 'Ada Lovelace', email: 'ada@example.com', phone: '+49 30 1234', note: 'First visit' },
  business: { name: 'Studio Nord', email: 'hello@studio.example' },
  resource: { name: 'Anna', email: 'anna@studio.example' },
  statusUrl: 'https://studio.example/my-booking/#t=ref-1',
  uidDomain: 'p-1',
  locale: 'en-GB',
  ownerLocale: 'en-GB',
  t: en,
  now: Date.UTC(2026, 9, 27, 18, 0),
};
const mails = (over: Partial<BookingMailFacts> = {}) => bookingMails({ ...FACTS, ...over });
/** A calendar object with its folded lines joined back. */
const unfold = (ics: string | undefined) => (ics ?? '').replace(/\r\n /g, '');

describe('a booking', () => {
  it('confirms to the customer, in their words, with the link to the booking on the business’s site', () => {
    const [customer] = mails();
    expect(customer!.recipient).toBe('ada@example.com');
    expect(customer!.subject).toBe('Booking confirmed: Massage');
    // Replies reach the business, not whatever address the mail server sends from.
    expect(customer!.replyTo).toBe('hello@studio.example');
    expect(customer!.rendered.text).toContain('Your booking is confirmed.');
    expect(customer!.rendered.text).toContain('When: Wed, 28 Oct 2026, 10:00 – 11:00 (Central European Time)');
    expect(customer!.rendered.text).toContain('View or cancel your booking: https://studio.example/my-booking/#t=ref-1');
    expect(customer!.rendered.html).toContain('<a href="https://studio.example/my-booking/#t=ref-1">View or cancel your booking</a>');
    // The customer's own copy does not repeat their details back, nor the business's other addresses.
    expect(customer!.rendered.text).not.toContain('anna@studio.example');
    expect(customer!.rendered.text).not.toContain('+49 30 1234');
    const ics = customer!.rendered.attachments![0]!;
    expect(ics.filename).toBe('booking.ics');
    expect(ics.contentType).toBe('text/calendar; method=PUBLISH; charset=utf-8');
    expect(ics.content).toContain('METHOD:PUBLISH');
    expect(ics.content).toContain('UID:c-1@p-1');
    // The customer's file is theirs, not an invitation: no organiser, and so not the business's address either.
    expect(ics.content).not.toContain('ORGANIZER');
    expect(customer!.rendered.icalEvent).toBeUndefined();
  });

  it('tells the business at each of its addresses, with the customer’s details', () => {
    const owners = mails().slice(1);
    expect(owners.map((m) => m.recipient)).toEqual(['hello@studio.example', 'anna@studio.example']);
    for (const m of owners) {
      expect(m.role).toBe('business');
      expect(m.subject).toBe('New booking: Massage, Wed, 28 Oct 2026, 10:00 – 11:00 (Central European Time)');
      expect(m.replyTo).toBe('ada@example.com');
      expect(m.rendered.text).toContain('Ada Lovelace booked Massage.');
      expect(m.rendered.text).toContain('Phone: +49 30 1234');
      expect(m.rendered.text).toContain('Note: First visit');
      expect(m.rendered.text).toContain('With: Anna');
    }
  });

  it('invites the resource’s calendar from the business, and gives the business’s own address a calendar file', () => {
    const [, own, anna] = mails();
    // An invitation from the business to the resource puts it in that calendar.
    expect(anna!.rendered.icalEvent?.method).toBe('REQUEST');
    const invite = unfold(anna!.rendered.icalEvent?.content);
    expect(invite).toContain('ORGANIZER;CN="Studio Nord":mailto:hello@studio.example');
    expect(invite).toContain('ATTENDEE;CN="Anna";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:anna@studio.example');
    // The organiser is not invited to its own event.
    expect(invite.match(/ATTENDEE/g)).toHaveLength(1);
    // An invitation from itself to itself is one calendars ignore: the business's own address gets a file.
    expect(own!.rendered.icalEvent).toBeUndefined();
    expect(own!.rendered.attachments![0]!.content).toContain('METHOD:PUBLISH');
  });

  it('sends calendar files, not invitations, when there is no business address to organise them', () => {
    const [, anna] = mails({ business: { name: 'Studio Nord' } });
    expect(anna!.recipient).toBe('anna@studio.example');
    expect(anna!.rendered.icalEvent).toBeUndefined();
    expect(anna!.rendered.attachments![0]!.content).toContain('METHOD:PUBLISH');
    expect(anna!.rendered.attachments![0]!.content).not.toContain('ORGANIZER');
  });

  it('sends the business one mail when its address and the resource’s are the same, and none when it has neither', () => {
    expect(mails({ resource: { name: 'Anna', email: 'hello@studio.example' } }).map((m) => m.recipient)).toEqual(['ada@example.com', 'hello@studio.example']);
    // The same mailbox whatever its case or padding.
    expect(mails({ resource: { name: 'Anna', email: ' Hello@Studio.Example ' } }).map((m) => m.recipient)).toEqual(['ada@example.com', 'hello@studio.example']);
    expect(mails({ business: { name: 'Studio Nord' }, resource: { name: 'Anna' } }).map((m) => m.recipient)).toEqual(['ada@example.com']);
  });

  it('writes the customer’s mail in their language, with their dates', () => {
    const de: Record<string, string> = { 'booking.mail_booked': 'Buchung bestätigt: {offering}', 'booking.status_booked': 'Ihre Buchung ist bestätigt.', 'booking.mail_when': 'Wann' };
    const [customer, owner] = mails({ locale: 'de', t: (k) => de[k] ?? en(k) });
    expect(customer!.subject).toBe('Buchung bestätigt: Massage');
    expect(customer!.rendered.text).toContain('Ihre Buchung ist bestätigt.');
    expect(customer!.rendered.text).toMatch(/Wann: Mi\.?, 28\. Okt\. 2026, 10:00 – 11:00 \(Mitteleuropäische Zeit\)/);
    // The business's own mail stays in its language.
    expect(owner!.subject).toContain('New booking: Massage, Wed, 28 Oct 2026');
  });

  it('shows the number of places only where several were booked', () => {
    expect(mails()[0]!.rendered.text).not.toContain('Places');
    expect(mails({ quantity: 3 })[0]!.rendered.text).toContain('Places: 3');
  });

  it('★ escapes everything it writes into HTML, and keeps subjects on one line', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const out = mails({ offering: { name: `Massage\r\nBcc: x@evil.example\u2028${evil}`, mode: 'duration' }, customer: { name: evil, email: 'ada@example.com', note: evil } });
    for (const m of out) {
      expect(m.rendered.html).not.toContain('<img');
      expect(m.subject).not.toMatch(/[\r\n\u0085\u2028\u2029]/);
    }
    expect(out[1]!.rendered.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('a request', () => {
  it('acknowledges it to the customer and asks the business, with nothing in anyone’s calendar yet', () => {
    const [customer, owner] = mails({ kind: 'requested' });
    expect(customer!.subject).toBe('Booking request received: Massage');
    expect(customer!.rendered.text).toContain('Your request is waiting for confirmation.');
    expect(customer!.rendered.text).toContain('https://studio.example/my-booking/#t=ref-1');
    expect(customer!.rendered.attachments).toBeUndefined();
    expect(owner!.subject.startsWith('New booking request: Massage')).toBe(true);
    expect(owner!.rendered.text).toContain('held for you until you answer');
    expect(owner!.rendered.icalEvent).toBeUndefined();
    expect(owner!.rendered.attachments).toBeUndefined();
  });
});

describe('a cancellation', () => {
  it('takes a booking back out of every calendar that has it, by the same UID', () => {
    const [customer, own, anna] = mails({ kind: 'cancelled', wasBooked: true, statusUrl: undefined });
    expect(customer!.subject).toBe('Booking cancelled: Massage');
    expect(customer!.rendered.text).toContain('Your booking is cancelled.');
    expect(customer!.rendered.text).not.toContain('View or cancel');
    // A published copy is withdrawn by publishing it again, cancelled (iTIP has no CANCEL for one).
    for (const file of [customer!.rendered.attachments![0]!.content, own!.rendered.attachments![0]!.content]) {
      expect(file).toMatch(/METHOD:PUBLISH[\s\S]*UID:c-1@p-1[\s\S]*SEQUENCE:1[\s\S]*STATUS:CANCELLED/);
    }
    expect(own!.subject.startsWith('Booking cancelled: Massage')).toBe(true);
    // The invitation is taken back with CANCEL.
    expect(anna!.rendered.icalEvent?.method).toBe('CANCEL');
    expect(unfold(anna!.rendered.icalEvent?.content)).toMatch(/UID:c-1@p-1[\s\S]*SEQUENCE:1[\s\S]*STATUS:CANCELLED/);
  });

  it('sends no calendar change for a request that was never in a calendar', () => {
    const out = mails({ kind: 'cancelled', wasBooked: false });
    expect(out.every((m) => m.rendered.attachments === undefined && m.rendered.icalEvent === undefined)).toBe(true);
  });
});

describe('bookingWhen', () => {
  it('reads stays and whole days as people do', () => {
    const nights = { offering: { name: 'Flat', mode: 'days' as const, unit: 'night' as const }, timeZone: 'Europe/Berlin', locale: 'en-GB' };
    expect(bookingWhen({ ...nights, start: Date.UTC(2026, 9, 28, 14), end: Date.UTC(2026, 9, 31, 9) })).toBe(
      'Wed, 28 Oct 2026, 15:00 – Sat, 31 Oct 2026, 10:00 (Central European Time)',
    );
    const days = { ...nights, offering: { name: 'Van', mode: 'days' as const, unit: 'day' as const } };
    // Whole days, the end being the midnight after the last one.
    expect(bookingWhen({ ...days, start: Date.UTC(2026, 9, 27, 23), end: Date.UTC(2026, 9, 29, 23) })).toBe('Wed, 28 Oct 2026 – Thu, 29 Oct 2026');
    expect(bookingWhen({ ...days, start: Date.UTC(2026, 9, 27, 23), end: Date.UTC(2026, 9, 28, 23) })).toBe('Wed, 28 Oct 2026');
  });
});
