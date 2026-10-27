import type { BookingMode } from '@sitewright/schema';
import type { RenderedBody } from '../mail/mailer.js';
import { buildIcs, type IcsMethod, type IcsPerson } from './ics.js';

/**
 * THE BOOKING MAILS — what the customer and the business hear when a booking is made, requested or cancelled.
 *
 *   customer   in the language of the page they booked on, from the business, with a link to the booking's own
 *              page on the business's site and the booking as a calendar file;
 *   business   in English (as the shop's order mails are), with the customer's details, and the booking as an
 *              invitation its calendar puts in place: one to the business's address, and one to the resource's
 *              own address when it has one (a person's calendar, a room's).
 *
 * ★ White-label: no link, header or calendar field names the platform. The status link is the business's site,
 * the calendar UID's domain is its host, and replies go to the business (the customer's copy) or to the customer
 * (the business's copy).
 * ★ Rendered once, when the booking happens, and queued as they are: a cancelled booking has no row left to
 * render from, and a retry must send what was true at the time.
 */

/**
 * booked      a booking stands (made by the customer, or a request the business accepted);
 * requested   a request waits for the business's answer;
 * cancelled   a booking or request was called off (by the customer, or by the business);
 * declined    the business turned a request down (the customer is told; the business did it);
 * lapsed      a request ran out unanswered.
 */
export type BookingMailKind = 'booked' | 'requested' | 'cancelled' | 'declined' | 'lapsed';

export interface BookingMailFacts {
  kind: BookingMailKind;
  /** A cancellation of a booking calendars already hold (rather than of a request): they get a CANCEL. */
  wasBooked?: boolean;
  /** Who did it, when it was the business (it accepted a request, or cancelled from its Bookings tab). */
  by?: 'business';
  claimId: string;
  offering: { name: string; mode: BookingMode; unit?: 'night' | 'day' };
  timeZone: string;
  start: number;
  end: number;
  quantity: number;
  customer: { name?: string; email?: string; phone?: string; note?: string };
  /** The business: its name, and the address it gets booking mails at. */
  business: { name: string; email?: string };
  resource: { name: string; email?: string };
  /** The booking's own page on the business's site, with the reference: `<site><statusPath>#t=<ref>`. */
  statusUrl?: string;
  /**
   * The calendar UID's domain part. It must stay the same between a booking and its cancellation, or the
   * cancellation would not find the event, so it is the project's id rather than a site address that can change.
   */
  uidDomain: string;
  /** The customer's language, for dates and times. */
  locale: string;
  /** The business's (the project's main language), for the dates and times in its own mails. */
  ownerLocale: string;
  /** The customer's strings, in their language (the site's own translations over the defaults). */
  t: (key: string) => string;
  now: number;
}

/** One mail, ready to queue. */
export interface QueuedBookingMail {
  /** The customer's own copy, or one of the business's. */
  role: 'customer' | 'business';
  recipient: string;
  subject: string;
  replyTo?: string;
  rendered: RenderedBody;
}

/** Escapes text for an HTML body. */
function esc(v: string): string {
  // eslint-disable-next-line security/detect-object-injection -- c is one of the five characters matched just above
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** One line of a subject or header: no line breaks, bounded. */
function oneLine(v: string, max = 200): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching the C0 range, and Unicode's line separators
  return v.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ').trim().slice(0, max);
}

function formatter(locale: string, timeZone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, ...opts });
  } catch {
    return new Intl.DateTimeFormat('en', { timeZone, ...opts });
  }
}

/** The zone's everyday name in the reader's language ("Central European Time"), else its id. */
function zoneName(locale: string, timeZone: string, at: number): string {
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'longGeneric' }).formatToParts(at).find((p) => p.type === 'timeZoneName');
    if (part?.value) return part.value;
  } catch {
    // An unknown locale: the id below says it plainly.
  }
  return timeZone.replace(/_/g, ' ');
}

/** The booking as a person reads it, on the business's clock: dates, and times where times matter. */
export function bookingWhen(f: Pick<BookingMailFacts, 'start' | 'end' | 'timeZone' | 'locale' | 'offering'>): string {
  const date = formatter(f.locale, f.timeZone, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = formatter(f.locale, f.timeZone, { hour: 'numeric', minute: '2-digit' });
  const day = (t: number): string => date.format(t);
  if (f.offering.mode === 'days' && f.offering.unit === 'day') {
    const last = f.end - 1;
    return day(f.start) === day(last) ? day(f.start) : `${day(f.start)} – ${day(last)}`;
  }
  const zone = zoneName(f.locale, f.timeZone, f.start);
  const sameDay = day(f.start) === day(f.end);
  return `${day(f.start)}, ${time.format(f.start)} – ${sameDay ? '' : `${day(f.end)}, `}${time.format(f.end)} (${zone})`;
}

/** The local date of an instant on the business's clock, YYYY-MM-DD. */
function localDate(ms: number, timeZone: string): string {
  const p = Object.fromEntries(formatter('en-CA', timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function ics(
  f: BookingMailFacts,
  method: IcsMethod,
  summary: string,
  description: string,
  people: { organizer?: IcsPerson; attendees?: IcsPerson[] },
): string {
  const allDay = f.offering.mode === 'days' && f.offering.unit === 'day' ? { startDate: localDate(f.start, f.timeZone), endDate: localDate(f.end, f.timeZone) } : undefined;
  return buildIcs({
    method,
    uid: `${f.claimId}@${f.uidDomain}`,
    // A cancellation supersedes the booking it takes back.
    sequence: f.kind === 'cancelled' ? 1 : 0,
    cancelled: f.kind === 'cancelled',
    start: f.start,
    end: f.end,
    ...(allDay ? { allDay } : {}),
    summary,
    description,
    ...(people.organizer ? { organizer: people.organizer } : {}),
    ...(people.attendees ? { attendees: people.attendees } : {}),
    now: f.now,
  });
}

/** Label: value rows, as text and as an HTML table. */
function rows(pairs: Array<[string, string]>): { text: string; html: string } {
  const kept = pairs.filter(([, v]) => v.trim() !== '');
  return {
    text: kept.map(([k, v]) => `${k}: ${v.replace(/\r?\n/g, '\n  ')}`).join('\n'),
    html:
      `<table role="presentation" style="border-collapse:collapse">` +
      kept.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#555;vertical-align:top">${esc(k)}</td><td style="padding:2px 0;white-space:pre-wrap">${esc(v)}</td></tr>`).join('') +
      `</table>`,
  };
}

const wrap = (inner: string): string => `<div style="font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1f2937">${inner}</div>`;

/** The customer's mail, in their language. None when they gave no address. */
function customerMail(f: BookingMailFacts, when: string): QueuedBookingMail | null {
  const to = f.customer.email?.trim();
  if (!to) return null;
  const t = f.t;
  const subject = oneLine(t(`booking.mail_${f.kind}`).split('{offering}').join(f.offering.name));
  const intro = t(
    f.kind === 'booked'
      ? 'booking.status_booked'
      : f.kind === 'requested'
        ? 'booking.status_pending'
        : f.kind === 'declined'
          ? 'booking.mail_declined_text'
          : f.kind === 'lapsed'
            ? 'booking.mail_lapsed_text'
            : 'booking.status_cancelled',
  );
  const details = rows([
    [t('booking.mail_when'), when],
    ...(f.quantity > 1 ? ([[t('booking.quantity'), String(f.quantity)]] as Array<[string, string]>) : []),
  ]);
  // A cancelled booking has no page left to show; a live one links to its own page on the business's site.
  const link = (f.kind === 'booked' || f.kind === 'requested') && f.statusUrl ? f.statusUrl : undefined;
  const calendar = f.kind === 'booked' ? t('booking.mail_calendar') : '';
  const text = [intro, '', f.offering.name, details.text, ...(link ? ['', `${t('booking.manage')}: ${link}`] : []), ...(calendar ? ['', calendar] : []), '', f.business.name].join('\n');
  const html = wrap(
    `<p style="font-size:16px;font-weight:600">${esc(intro)}</p>` +
      `<p style="margin:12px 0 4px;font-weight:600">${esc(f.offering.name)}</p>${details.html}` +
      (link ? `<p style="margin-top:16px"><a href="${esc(link)}">${esc(t('booking.manage'))}</a></p>` : '') +
      (calendar ? `<p style="color:#555">${esc(calendar)}</p>` : '') +
      `<p style="margin-top:16px;color:#555">${esc(f.business.name)}</p>`,
  );
  // The booking for their own calendar: published when booked, and published again as cancelled when a booked
  // one is cancelled (a PUBLISH copy has no CANCEL in iTIP). No organiser: the file is theirs, not an invitation.
  const file = f.kind === 'booked' || (f.kind === 'cancelled' && f.wasBooked) ? ics(f, 'PUBLISH', `${f.offering.name} – ${f.business.name}`, link ? `${t('booking.manage')}: ${link}` : '', {}) : null;
  return {
    role: 'customer',
    recipient: to,
    subject,
    ...(f.business.email ? { replyTo: f.business.email } : {}),
    rendered: {
      text,
      html,
      ...(file ? { attachments: [{ filename: 'booking.ics', content: file, contentType: 'text/calendar; method=PUBLISH; charset=utf-8' }] } : {}),
    },
  };
}

/**
 * The business's mails: one per address it has (its own, and the resource's; the same address once, whatever its
 * case). The business's own address gets the booking as a calendar file: an invitation from itself to itself is
 * one calendars ignore. A resource's own address gets a real invitation from the business, which puts it in that
 * calendar, and a cancellation takes it out. With no business address there is no organiser, so a file again.
 */
function businessMails(f: BookingMailFacts, when: string): QueuedBookingMail[] {
  const seen = new Set<string>();
  const to: string[] = [];
  for (const raw of [f.business.email, f.resource.email]) {
    const e = raw?.trim();
    if (!e || seen.has(e.toLowerCase())) continue;
    seen.add(e.toLowerCase());
    to.push(e);
  }
  // The business turned the request down itself: it needs no mail about it.
  if (!to.length || f.kind === 'declined') return [];
  const accepted = f.kind === 'booked' && f.by === 'business';
  const head = accepted
    ? 'Booking confirmed'
    : f.kind === 'booked'
      ? 'New booking'
      : f.kind === 'requested'
        ? 'New booking request'
        : f.kind === 'lapsed'
          ? 'Booking request lapsed'
          : 'Booking cancelled';
  const subject = oneLine(`${head}: ${f.offering.name}, ${when}`);
  const who = f.customer.name?.trim() || f.customer.email?.trim() || 'a customer';
  const details = rows([
    ['Offering', f.offering.name],
    ['When', when],
    ['With', f.resource.name],
    ...(f.quantity > 1 ? ([['Places', String(f.quantity)]] as Array<[string, string]>) : []),
    ['Name', f.customer.name ?? ''],
    ['Email', f.customer.email ?? ''],
    ['Phone', f.customer.phone ?? ''],
    ['Note', f.customer.note ?? ''],
  ]);
  const lead = accepted
    ? `You accepted ${who}’s request: ${f.offering.name} is booked.`
    : f.kind === 'booked'
      ? `${who} booked ${f.offering.name}.`
      : f.kind === 'requested'
        ? `${who} asks to book ${f.offering.name}. The time is held for you until you answer, for up to three days.`
        : f.kind === 'lapsed'
          ? `${who}’s request for ${f.offering.name} ran out unanswered, and its time is free again. ${who} has been told.`
          : f.by === 'business'
            ? `The booking of ${f.offering.name} for ${who} is cancelled, and ${who} has been told.`
            : `${who} cancelled ${f.offering.name}.`;
  const text = `${lead}\n\n${details.text}\n`;
  const html = wrap(`<p style="font-size:16px;font-weight:600">${esc(lead)}</p>${details.html}`);
  // A request is in nobody's calendar until it is accepted.
  const inCalendar = f.kind === 'booked' || (f.kind === 'cancelled' && f.wasBooked);
  const summary = `${f.offering.name} – ${who}`;
  const organizerEmail = f.business.email?.trim();
  const organizer: IcsPerson | undefined = organizerEmail ? { email: organizerEmail, name: f.business.name } : undefined;
  return to.map((recipient): QueuedBookingMail => {
    let calendar: Pick<RenderedBody, 'attachments' | 'icalEvent'> = {};
    if (inCalendar && organizer && recipient.toLowerCase() !== organizer.email.toLowerCase()) {
      const method: IcsMethod = f.kind === 'cancelled' ? 'CANCEL' : 'REQUEST';
      const attendee: IcsPerson = { email: recipient, name: f.resource.name };
      calendar = { icalEvent: { method, filename: method === 'CANCEL' ? 'cancel.ics' : 'invite.ics', content: ics(f, method, summary, details.text, { organizer, attendees: [attendee] }) } };
    } else if (inCalendar) {
      calendar = { attachments: [{ filename: 'booking.ics', content: ics(f, 'PUBLISH', summary, details.text, {}), contentType: 'text/calendar; method=PUBLISH; charset=utf-8' }] };
    }
    return {
      role: 'business',
      recipient,
      subject,
      ...(f.customer.email?.trim() ? { replyTo: f.customer.email.trim() } : {}),
      rendered: { text, html, ...calendar },
    };
  });
}

/** Every mail one booking event sends: the customer's, then the business's. */
export function bookingMails(f: BookingMailFacts): QueuedBookingMail[] {
  const customer = customerMail(f, bookingWhen(f));
  return [...(customer ? [customer] : []), ...businessMails(f, bookingWhen({ ...f, locale: f.ownerLocale }))];
}
