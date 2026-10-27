import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { bookingMails } from '../src/db/schema.js';
import type { SubmissionMail } from '../src/mail/mailer.js';

/**
 * ★ The booking mails, end to end through the app: a booking, a request and a cancellation each queue their
 * mails and send them at once, the customer's in the language they booked in and linking to the booking's
 * own page on the BUSINESS's site, the business's with an invitation its calendar puts in place.
 */

const ALL_DAY = [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '00:00', to: '24:00' }];
const CONFIG = {
  resources: [
    { id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', hours: ALL_DAY, email: 'anna@studio.example' },
    { id: 'ben', name: 'Ben', timeZone: 'Europe/Berlin', hours: ALL_DAY },
  ],
  offerings: [
    { id: 'massage', name: 'Massage', mode: 'duration', durationMin: 60, resourceIds: ['anna'] },
    { id: 'ask', name: 'Consultation', mode: 'duration', durationMin: 60, resourceIds: ['ben'], confirmation: 'request' },
  ],
  statusPath: '/my-booking/',
  notifyEmail: 'hello@studio.example',
};
const HUMAN = { _hpt: '', _elapsed: '5000', _ix: '3.2.2' };
const ME = { name: 'Ada Lovelace', email: 'ada@example.test' };

let h: Harness;
let client: TestClient;
let pid: string;
let sent: SubmissionMail[];

beforeEach(async () => {
  sent = [];
  h = await makeHarness({ mailer: { send: async (m: SubmissionMail) => (sent.push(m), true) }, publicUrl: 'https://cms.agency.example' });
  client = await h.signup({ email: 'owner@studio.example', admin: true });
  // An instance that sends the platform's mails through its global SMTP.
  expect((await client.put('/admin/settings', { formModes: { globalSmtp: true } })).statusCode).toBe(200);
  pid = await client.createProject('Studio', 'studio');
  const settings = await client.put(`/projects/${pid}/content/settings/settings`, {
    identity: { name: 'Studio Nord' },
    website: { siteUrl: 'https://studio.example', translations: { 'booking.mail_booked': { en: 'Booking confirmed: {offering}', de: 'Buchung bestätigt: {offering}' } } },
    settings: { defaultLocale: 'en', locales: ['en', 'de'] },
  });
  expect(settings.statusCode, settings.body).toBe(200);
  expect((await client.put(`/projects/${pid}/content/booking/booking`, CONFIG)).statusCode).toBe(200);
});
afterEach(() => h.close());

const firstStart = async (offering: string): Promise<number> => {
  const from = Date.now();
  const res = await h.app.inject({ method: 'GET', url: `/b/${pid}/${offering}/availability?from=${from}&to=${from + 7 * 86_400_000}` });
  return res.json().times[3].start as number;
};
const book = async (offering: string, extra: Record<string, string> = {}, query = '') => {
  const start = await firstStart(offering);
  return h.app.inject({ method: 'POST', url: `/b/${pid}/${offering}${query}`, payload: { ...HUMAN, ...ME, start: String(start), ...extra } });
};
/** Mails go out right after the answer; wait for them rather than for a maintenance pass. */
const until = async (n: number): Promise<void> => {
  for (let i = 0; i < 200 && sent.length < n; i += 1) await new Promise((r) => setTimeout(r, 10));
  expect(sent.length).toBe(n);
};
const to = (addr: string) => sent.filter((m) => m.recipient === addr);
const unfold = (s: string | undefined) => (s ?? '').replace(/\r\n /g, '');

describe('a booking', () => {
  it('confirms to the customer and invites the business at both its addresses, at once', async () => {
    const res = await book('massage');
    expect(res.statusCode, res.body).toBe(200);
    const { reference } = res.json();
    await until(3);
    const [customer] = to('ada@example.test');
    expect(customer!.subject).toBe('Booking confirmed: Massage');
    expect(customer!.replyTo).toBe('hello@studio.example');
    // ★ White-label: the link is the business's own site, never the platform's.
    expect(customer!.rendered!.text).toContain(`https://studio.example/my-booking/#t=${encodeURIComponent(reference)}`);
    const everything = JSON.stringify(sent);
    expect(everything).not.toContain('cms.agency.example');
    expect(everything.toLowerCase()).not.toContain('sitewright');
    expect(customer!.rendered!.attachments![0]!.content).toContain('METHOD:PUBLISH');
    for (const owner of [...to('hello@studio.example'), ...to('anna@studio.example')]) {
      expect(owner.subject.startsWith('New booking: Massage, ')).toBe(true);
      expect(owner.replyTo).toBe('ada@example.test');
    }
    // Anna's calendar gets an invitation from the business; the business's own address a calendar file.
    const invite = unfold(to('anna@studio.example')[0]!.rendered!.icalEvent?.content);
    expect(to('anna@studio.example')[0]!.rendered!.icalEvent?.method).toBe('REQUEST');
    expect(invite).toContain(`UID:${customer!.rendered!.attachments![0]!.content.match(/UID:([^\r\n]+)/)![1]}`);
    expect(invite).toContain('ORGANIZER;CN="Studio Nord":mailto:hello@studio.example');
    expect(to('hello@studio.example')[0]!.rendered!.attachments![0]!.content).toContain('METHOD:PUBLISH');
    // Sent, so nothing is left queued.
    expect(await h.db.select().from(bookingMails)).toEqual([]);
  });

  it('writes to the customer in the language they booked in, if the site has it', async () => {
    expect((await book('massage', { lang: 'de' })).statusCode).toBe(200);
    await until(3);
    expect(to('ada@example.test')[0]!.subject).toBe('Buchung bestätigt: Massage');
    // A language the site does not have reads as its main one.
    sent = [];
    expect((await book('massage', { lang: 'fr' })).statusCode).toBe(200);
    await until(3);
    expect(to('ada@example.test')[0]!.subject).toBe('Booking confirmed: Massage');
  });

  it('sends nothing for a preview', async () => {
    expect((await book('massage', {}, '?preview=1')).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(sent).toEqual([]);
    expect(await h.db.select().from(bookingMails)).toEqual([]);
  });

  it('takes a cancelled booking back out of every calendar', async () => {
    const { reference } = (await book('massage')).json();
    await until(3);
    sent = [];
    const res = await h.app.inject({ method: 'POST', url: `/b/${pid}/_booking/${reference}/cancel` });
    expect(res.statusCode).toBe(200);
    await until(3);
    const [customer] = to('ada@example.test');
    expect(customer!.subject).toBe('Booking cancelled: Massage');
    expect(customer!.rendered!.attachments![0]!.content).toMatch(/METHOD:PUBLISH[\s\S]*SEQUENCE:1[\s\S]*STATUS:CANCELLED/);
    expect(to('anna@studio.example')[0]!.rendered!.icalEvent?.method).toBe('CANCEL');
  });
});

describe('a request', () => {
  it('acknowledges it and asks the business, with nothing in a calendar yet', async () => {
    expect((await book('ask')).statusCode).toBe(200);
    // Ben has no address of his own: the customer and the business's address.
    await until(2);
    expect(to('ada@example.test')[0]!.subject).toBe('Booking request received: Consultation');
    const [owner] = to('hello@studio.example');
    expect(owner!.subject.startsWith('New booking request: Consultation')).toBe(true);
    expect(owner!.rendered!.icalEvent).toBeUndefined();
  });
});

describe('when mail cannot go', () => {
  it('keeps the booking, and keeps the mails queued for the next try', async () => {
    await h.close();
    sent = [];
    h = await makeHarness({ mailer: { send: async () => false } });
    client = await h.signup({ email: 'owner@studio.example', admin: true });
    pid = await client.createProject('Studio', 'studio');
    expect((await client.put(`/projects/${pid}/content/booking/booking`, CONFIG)).statusCode).toBe(200);
    const res = await book('massage');
    expect(res.statusCode).toBe(200);
    for (let i = 0; i < 100; i += 1) {
      const rows = await h.db.select().from(bookingMails);
      if (rows.length === 3 && rows.every((r) => r.attempts === 1)) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const rows = await h.db.select().from(bookingMails);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.state === 'pending' && r.attempts === 1)).toBe(true);
  });
});
