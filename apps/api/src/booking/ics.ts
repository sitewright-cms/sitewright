/**
 * ONE BOOKING AS A CALENDAR OBJECT (RFC 5545, sent as iTIP per RFC 5546).
 *
 *   PUBLISH   the customer's copy: a file their calendar adds.
 *   REQUEST   the business's copy: an invitation their calendar (Outlook, Google, Apple) puts in place.
 *   CANCEL    takes an invitation back out again, matched by the same UID and a higher SEQUENCE. A PUBLISH copy
 *             is withdrawn by publishing it again with STATUS:CANCELLED (iTIP has no CANCEL for a PUBLISH).
 *
 * ★ White-label: the product identifier is neutral, the UID's domain is the business's site, and the organiser
 * is the business. Nothing in the object names the platform.
 */

export type IcsMethod = 'PUBLISH' | 'REQUEST' | 'CANCEL';

export interface IcsPerson {
  email: string;
  name?: string;
}

export interface IcsEvent {
  method: IcsMethod;
  /** Stable for the booking's life: `<claim id>@<site host>`. */
  uid: string;
  /** 0 when created; a change or a cancellation carries a higher one. */
  sequence: number;
  /** The event is cancelled. A CANCEL always is; a PUBLISH copy is withdrawn by publishing it again cancelled. */
  cancelled?: boolean;
  start: number;
  end: number;
  /** Whole days (a rental by the day): written as dates, the end date exclusive. */
  allDay?: { startDate: string; endDate: string };
  summary: string;
  description?: string;
  organizer?: IcsPerson;
  attendees?: IcsPerson[];
  /** DTSTAMP: when this object was made. */
  now: number;
}

/** The product identifier, deliberately generic. */
export const ICS_PRODID = '-//Online booking//EN';

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** `20261028T090000Z`. */
export function icsUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** TEXT value escaping: backslash, semicolon, comma, and line breaks (RFC 5545 §3.3.11). */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    // Unicode's own line and paragraph separators too: a lenient parser breaks lines on them.
    .replace(/\r\n|\r|\n|\u0085|\u2028|\u2029/g, '\\n')
    // Any other control character has no place in a calendar line.
    // eslint-disable-next-line no-control-regex -- deliberately matching the C0 range
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

/** A CN parameter: quoted, with what a quoted parameter may not hold removed. */
function cn(name: string | undefined): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching the C0 range
  const clean = (name ?? '').replace(/["\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  return clean ? `;CN="${clean}"` : '';
}

/** An address as a mailto URI, or nothing when it is not a plain address. */
function mailto(email: string): string | null {
  // eslint-disable-next-line no-control-regex -- deliberately matching the C0 range
  return /^[^\s"<>:;,\u0000-\u001f\u007f]+@[^\s"<>:;,\u0000-\u001f\u007f]+$/.test(email) ? `mailto:${email}` : null;
}

/**
 * Folds a content line at 75 octets (RFC 5545 §3.1): CRLF and one space, never inside a UTF-8 character.
 */
export function icsFold(line: string): string {
  const out: string[] = [];
  let current = '';
  let octets = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    // The first line holds 75 octets; a continuation line's leading space counts toward its 75.
    if (octets + size > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = '';
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** The VCALENDAR for one booking, CRLF line endings, folded. */
export function buildIcs(e: IcsEvent): string {
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${ICS_PRODID}`, 'CALSCALE:GREGORIAN', `METHOD:${e.method}`, 'BEGIN:VEVENT'];
  lines.push(`UID:${icsText(e.uid)}`);
  lines.push(`DTSTAMP:${icsUtc(e.now)}`);
  if (e.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${e.allDay.startDate.replace(/-/g, '')}`);
    lines.push(`DTEND;VALUE=DATE:${e.allDay.endDate.replace(/-/g, '')}`);
  } else {
    lines.push(`DTSTART:${icsUtc(e.start)}`);
    lines.push(`DTEND:${icsUtc(e.end)}`);
  }
  lines.push(`SEQUENCE:${e.sequence}`);
  lines.push(`STATUS:${e.method === 'CANCEL' || e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push('TRANSP:OPAQUE');
  lines.push(`SUMMARY:${icsText(e.summary)}`);
  if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
  const organizer = e.organizer ? mailto(e.organizer.email) : null;
  if (e.organizer && organizer) lines.push(`ORGANIZER${cn(e.organizer.name)}:${organizer}`);
  for (const a of e.attendees ?? []) {
    const uri = mailto(a.email);
    if (uri) lines.push(`ATTENDEE${cn(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:${uri}`);
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
