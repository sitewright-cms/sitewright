import { describe, it, expect } from 'vitest';
import { BookingConfigSchema } from '@sitewright/schema';
import { BookingNotifier, CUSTOMER_MAILS_PER_DAY, CustomerMailBudget, mailboxOf, matchLocale, notifyLapsed, type NotifierSettings } from '../src/booking/notify.js';
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

  it('writes to one side only when asked (a second payment for a booking that stands is the business’s concern)', async () => {
    const { book, queued } = notifier(SETTINGS);
    await book({ kind: 'refunded', refund: 'manual', duplicate: true, only: 'business' });
    expect(queued[0]!.map((m) => m.role)).toEqual(['business', 'business']);
    expect(queued[0]![0]!.rendered.text).toContain('paid twice for Massage');
  });

  it('never withholds a reminder for the mailbox’s daily share: one per booking, never a visitor’s to trigger', async () => {
    const { book, queued } = notifier(SETTINGS);
    for (let i = 0; i < CUSTOMER_MAILS_PER_DAY + 2; i++) await book();
    await book({ kind: 'reminder' });
    expect(queued[queued.length - 1]!.map((m) => m.role)).toEqual(['customer']);
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

describe('notifyLapsed', () => {
  const lapsed = (projectId: string, offeringId = 'massage') => ({ ...CLAIM, id: `${projectId}-${offeringId}`, projectId, offeringId }) as never;

  it('★ tells every lapsed request, whatever one of them does, reading each project’s set-up once', async () => {
    const reads: string[] = [];
    const told: string[] = [];
    const warned: unknown[] = [];
    const n = await notifyLapsed([lapsed('p1'), lapsed('p2'), lapsed('p1'), lapsed('p1', 'gone'), lapsed('p3')], {
      readConfig: async (projectId) => {
        reads.push(projectId);
        if (projectId === 'p2') throw new Error('database is locked');
        return CONFIG;
      },
      notify: async (e) => {
        if (e.claim.id === 'p3-massage') throw new Error('unexpected');
        told.push(e.claim.id);
      },
      log: { warn: (o) => warned.push(o) },
    });
    expect(told).toEqual(['p1-massage', 'p1-massage']);
    expect(n).toBe(2);
    expect(reads).toEqual(['p1', 'p2', 'p3']);
    // p2's unreadable set-up, the removed offering, and p3's failure: each logged, none stopping the rest.
    expect(warned).toHaveLength(3);
  });

  it('★ tells an accepted paid request left unpaid as such, and says nothing of an abandoned checkout', async () => {
    const paid = BookingConfigSchema.parse({
      ...CONFIG,
      offerings: [
        { id: 'consult', name: 'Consultation', resourceIds: ['anna'], mode: 'duration', durationMin: 60, confirmation: 'request', price: { amountMinor: 8000 } },
        { id: 'massage', name: 'Massage', resourceIds: ['anna'], mode: 'duration', durationMin: 60, price: { amountMinor: 4500 } },
      ],
      payment: { gatewayId: 'mock', currency: 'EUR' },
    });
    const held = (offeringId: string) => ({ ...CLAIM, id: offeringId, projectId: 'p1', offeringId, state: 'hold' }) as never;
    const told: Array<[string, string]> = [];
    const n = await notifyLapsed([held('consult'), held('massage'), lapsed('p1', 'consult')], {
      readConfig: async () => paid,
      notify: async (e) => void told.push([e.claim.id, e.kind]),
      log: { warn: () => undefined },
    });
    expect(told).toEqual([
      ['consult', 'unpaid'],
      ['p1-consult', 'lapsed'],
    ]);
    expect(n).toBe(2);
  });
});
