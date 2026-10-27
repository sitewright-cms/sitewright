import { describe, it, expect } from 'vitest';
import { BookingConfigSchema } from '@sitewright/schema';
import { BookingNotifier, CUSTOMER_MAILS_PER_DAY, CustomerMailBudget, mailboxOf, matchLocale, type NotifierSettings } from '../src/booking/notify.js';
import type { BookingMailRepository } from '../src/booking/outbox.js';
import type { QueuedBookingMail } from '../src/booking/mails.js';

/** Turning a booking event into its queued mails: the customer's language, the site's address, the budget. */

const CONFIG = BookingConfigSchema.parse({
  resources: [{ id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', email: 'anna@studio.example' }],
  offerings: [{ id: 'massage', name: 'Massage', resourceIds: ['anna'], mode: 'duration', durationMin: 60 }],
  statusPath: '/my-booking/',
  notifyEmail: 'hello@studio.example',
});
const CLAIM = {
  id: 'c1',
  resourceId: 'anna',
  startAt: new Date(Date.UTC(2026, 9, 28, 9)),
  endAt: new Date(Date.UTC(2026, 9, 28, 10)),
  units: 1,
  customer: { name: 'Ada', email: 'ada@example.com' },
  state: 'booked' as const,
};

function notifier(settings: NotifierSettings | null, hosted: string | null = null, now = Date.UTC(2026, 9, 27, 12)) {
  const queued: QueuedBookingMail[][] = [];
  const warned: unknown[] = [];
  let kicks = 0;
  const mails = { enqueue: async (_p: string, m: QueuedBookingMail[]) => (queued.push(m), { queued: m.length, dropped: 0 }) } as unknown as BookingMailRepository;
  const n = new BookingNotifier({
    mails,
    readSettings: async () => settings,
    hostedSiteUrl: async () => hosted,
    kick: () => (kicks += 1),
    log: { warn: (o) => warned.push(o) },
    now: () => now,
    budget: new CustomerMailBudget(),
  });
  const book = (over: Record<string, unknown> = {}) =>
    n.notify({ kind: 'booked', projectId: 'p1', claim: CLAIM, offering: CONFIG.offerings[0]!, config: CONFIG, reference: 'ref/1', ...over });
  return { book, queued, warned, kicks: () => kicks };
}

const SETTINGS: NotifierSettings = {
  identity: { name: 'Studio Nord' },
  website: { siteUrl: 'https://studio.example/', translations: { 'booking.mail_booked': { en: 'Booking confirmed: {offering}', de: 'Buchung bestätigt: {offering}' } } },
  settings: { defaultLocale: 'en', locales: ['en', 'de'] },
};

describe('BookingNotifier', () => {
  it('queues the customer’s and the business’s mails, linking to the booking on the business’s own site', async () => {
    const { book, queued, kicks } = notifier(SETTINGS);
    await book();
    const [customer, ...business] = queued[0]!;
    expect(customer!.rendered.text).toContain('https://studio.example/my-booking/#t=ref%2F1');
    expect(business.map((m) => m.recipient)).toEqual(['hello@studio.example', 'anna@studio.example']);
    expect(customer!.rendered.attachments![0]!.content).toContain('UID:c1@p1');
    expect(kicks()).toBe(1);
  });

  it('writes in the page’s language when the site has it, however the page spells it', async () => {
    for (const lang of ['de', 'DE', 'de-DE', 'de-at']) {
      const { book, queued } = notifier(SETTINGS);
      await book({ locale: lang });
      expect(queued[0]![0]!.subject, lang).toBe('Buchung bestätigt: Massage');
    }
    const { book, queued } = notifier(SETTINGS);
    await book({ locale: 'fr' });
    expect(queued[0]![0]!.subject).toBe('Booking confirmed: Massage');
  });

  it('★ links only to the site’s own address: none when the platform has no address that is the site’s', async () => {
    const hosted = notifier({ ...SETTINGS, website: {} }, 'https://studio.sites.agency.example/');
    await hosted.book();
    expect(hosted.queued[0]![0]!.rendered.text).toContain('https://studio.sites.agency.example/my-booking/#t=');
    const none = notifier({ ...SETTINGS, website: {} }, null);
    await none.book();
    expect(none.queued[0]![0]!.rendered.text).not.toContain('#t=');
  });

  it('★ gives one customer mailbox only its daily share, and always tells the business', async () => {
    const { book, queued, warned } = notifier(SETTINGS);
    for (let i = 0; i < CUSTOMER_MAILS_PER_DAY + 2; i += 1) {
      // The same mailbox spelt differently is the same mailbox.
      await book({ claim: { ...CLAIM, customer: { name: 'Ada', email: i % 2 ? 'Ada+x@Example.com' : 'ada@example.com' } } });
    }
    const customerMails = queued.flat().filter((m) => m.role === 'customer');
    expect(customerMails).toHaveLength(CUSTOMER_MAILS_PER_DAY);
    expect(queued.flat().filter((m) => m.role === 'business')).toHaveLength(2 * (CUSTOMER_MAILS_PER_DAY + 2));
    expect(warned).toHaveLength(2);
  });

  it('never throws: a booking stands whatever its mail does', async () => {
    const n = new BookingNotifier({
      mails: { enqueue: async () => { throw new Error('disk full'); } } as unknown as BookingMailRepository,
      readSettings: async () => SETTINGS,
      hostedSiteUrl: async () => null,
      kick: () => undefined,
      log: { warn: () => undefined },
    });
    await expect(n.notify({ kind: 'booked', projectId: 'p1', claim: CLAIM, offering: CONFIG.offerings[0]!, config: CONFIG })).resolves.toBeUndefined();
  });
});

describe('the pieces', () => {
  it('matches a page language to the site’s', () => {
    expect(matchLocale('pt-BR', ['en', 'pt-BR', 'pt'])).toBe('pt-BR');
    expect(matchLocale('pt-br', ['en', 'pt-BR'])).toBe('pt-BR');
    expect(matchLocale('pt-PT', ['en', 'pt'])).toBe('pt');
    expect(matchLocale('fr', ['en'])).toBeNull();
    expect(matchLocale(undefined, ['en'])).toBeNull();
  });

  it('reads an address as its mailbox', () => {
    expect(mailboxOf(' Ada+Booking@Example.COM ')).toBe('ada@example.com');
    expect(mailboxOf('ada@example.com')).toBe('ada@example.com');
  });

  it('gives a mailbox its share again a day later', () => {
    const b = new CustomerMailBudget();
    const t0 = Date.UTC(2026, 9, 27);
    for (let i = 0; i < CUSTOMER_MAILS_PER_DAY; i += 1) expect(b.take('p1', 'ada@example.com', t0)).toBe(true);
    expect(b.take('p1', 'ada@example.com', t0)).toBe(false);
    // Another project's customer is another budget.
    expect(b.take('p2', 'ada@example.com', t0)).toBe(true);
    expect(b.take('p1', 'ada@example.com', t0 + 24 * 60 * 60 * 1000)).toBe(true);
  });
});
