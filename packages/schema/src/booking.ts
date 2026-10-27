import { z } from 'zod';
import { SitePathSchema } from './website.js';

/**
 * BOOKING — any booking of a date or a time: an appointment, a room by the hour, a tour or class at a set
 * time, a holiday rental by the night, equipment by the day.
 *
 * Two things are configured:
 *   - a RESOURCE is what a booking occupies: a person, a room, an apartment, a vehicle, an item. It has a
 *     time zone, a capacity (how many bookings it takes at once; seats, units), opening hours and blocked
 *     times. Its calendars (busy times read from outside, bookings written out) are connected separately.
 *   - an OFFERING is what a visitor books. It names the resources that can serve it and one MODE:
 *       `duration`  a fixed length, starting on a grid inside opening hours (appointments);
 *       `slots`     defined start times per weekday, each with its own seats (tours, classes);
 *       `range`     the visitor picks start and end, within a minimum and a maximum (rooms by the hour);
 *       `days`      whole nights or days (rentals), with check-in and check-out times.
 *
 * Every time here is WALL-CLOCK time in the resource's own time zone ("09:00" means nine in the morning
 * where the resource is, summer or winter). The API turns them into instants; the booking widget shows them
 * on the resource's clock too, and names the time zone when it is not the visitor's.
 */

/** Bounds on one project's booking configuration. It is ordinary content, so it stays small. */
export const BOOKING_LIMITS = {
  resources: 50,
  offerings: 100,
  resourcesPerOffering: 20,
  hoursRules: 28,
  blocks: 200,
  /** Weekly blocks repeat on every date a listing looks at, so they are capped harder than one-off ones. */
  weeklyBlocks: 28,
  slots: 100,
  capacity: 1000,
  /** The furthest ahead anything can be booked. */
  maxAdvanceDays: 730,
} as const;

/** A resource's or offering's id: lower-case letters, digits and dashes, used in URLs and calendar events. */
export const BookingIdSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9-]+$/, 'use lower-case letters, digits and dashes')
  .refine((v) => !v.startsWith('-') && !v.endsWith('-'), 'start and end with a letter or digit');

/** Weekdays, Monday first (ISO 8601). */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const WeekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof WeekdaySchema>;

/** Minutes since midnight for `HH:MM` (`24:00` = 1440, the end of the day). */
export function clockMinutes(clock: string): number {
  const [h, m] = clock.split(':');
  return Number(h) * 60 + Number(m);
}

/** A time of day, `HH:MM`, 24-hour. `24:00` is allowed as an END: "until midnight". */
export const ClockTimeSchema = z.string().regex(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/, 'a time of day, HH:MM');
/** A time of day something STARTS at: as above, without `24:00`. */
export const StartClockSchema = ClockTimeSchema.refine((v) => v !== '24:00', 'a start time cannot be 24:00');

/** True for a real calendar date `YYYY-MM-DD` (no 31 February). */
export function isLocalDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** A calendar date, `YYYY-MM-DD`. */
export const LocalDateSchema = z.string().refine(isLocalDate, 'a date, YYYY-MM-DD');
/** A wall-clock date and time, `YYYY-MM-DDTHH:MM`. */
export const LocalDateTimeSchema = z
  .string()
  .refine((v) => /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(v) && isLocalDate(v.slice(0, 10)), 'a date and time, YYYY-MM-DDTHH:MM');

/** True for an IANA time zone this runtime knows (`Europe/Berlin`, `Africa/Windhoek`, `UTC`). */
export function isTimeZone(value: unknown): boolean {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
/** A time zone, stored by its canonical name (`europe/berlin` becomes `Europe/Berlin`), so one zone is one string. */
export const TimeZoneSchema = z
  .string()
  .refine(isTimeZone, 'an IANA time zone, e.g. Europe/Berlin')
  .transform((tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone);

const NoteSchema = z.string().trim().max(200).optional();

/** Opening hours: on these weekdays, from–to. Several rules make split days ("09:00–12:00, 13:00–17:00"). */
export const HoursRuleSchema = z
  .strictObject({ days: z.array(WeekdaySchema).min(1).max(7), from: StartClockSchema, to: ClockTimeSchema })
  .refine((r) => clockMinutes(r.from) < clockMinutes(r.to), { message: 'closes after it opens (use two rules to cross midnight)', path: ['to'] });
export type HoursRule = z.infer<typeof HoursRuleSchema>;

/**
 * A blocked time: the resource takes no bookings during it.
 *   `dates`   whole days, from–to inclusive (holidays, closures);
 *   `once`    a stretch of time on one occasion;
 *   `weekly`  the same hours every week (a lunch break, a standing meeting).
 */
export const BookingBlockSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({ kind: z.literal('dates'), from: LocalDateSchema, to: LocalDateSchema, note: NoteSchema })
    .refine((b) => b.from <= b.to, { message: 'ends on or after the day it starts', path: ['to'] }),
  z
    .strictObject({ kind: z.literal('once'), start: LocalDateTimeSchema, end: LocalDateTimeSchema, note: NoteSchema })
    .refine((b) => b.start < b.end, { message: 'ends after it starts', path: ['end'] }),
  z
    .strictObject({ kind: z.literal('weekly'), days: z.array(WeekdaySchema).min(1).max(7), from: StartClockSchema, to: ClockTimeSchema, note: NoteSchema })
    .refine((b) => clockMinutes(b.from) < clockMinutes(b.to), { message: 'ends after it starts', path: ['to'] }),
]);
export type BookingBlock = z.infer<typeof BookingBlockSchema>;

/**
 * What a booking occupies. With no opening hours a resource takes no `duration` or `range` bookings.
 * Openings that touch across midnight (until 24:00, then from 00:00) join: a booking can run on through it.
 */
export const BookingResourceSchema = z
  .strictObject({
    id: BookingIdSchema,
    name: z.string().trim().min(1).max(120),
    timeZone: TimeZoneSchema,
    /** How many bookings (or seats, or units) it takes at the same time. */
    capacity: z.number().int().min(1).max(BOOKING_LIMITS.capacity).default(1),
    hours: z.array(HoursRuleSchema).max(BOOKING_LIMITS.hoursRules).default([]),
    blocks: z.array(BookingBlockSchema).max(BOOKING_LIMITS.blocks).default([]),
  })
  .refine((r) => r.blocks.filter((b) => b.kind === 'weekly').length <= BOOKING_LIMITS.weeklyBlocks, {
    message: `at most ${BOOKING_LIMITS.weeklyBlocks} weekly blocks`,
    path: ['blocks'],
  });
export type BookingResource = z.infer<typeof BookingResourceSchema>;

/**
 * A set start time in `slots` mode. `capacity` (seats) defaults to the resource's capacity. The seats are the
 * slot's own: bookings of the same slot share them, and while it runs it takes its resource for anything
 * else, as a tour takes its guide.
 */
export const BookingSlotSchema = z.strictObject({
  days: z.array(WeekdaySchema).min(1).max(7),
  at: StartClockSchema,
  durationMin: z.number().int().min(5).max(1440),
  capacity: z.number().int().min(1).max(BOOKING_LIMITS.capacity).optional(),
});
export type BookingSlot = z.infer<typeof BookingSlotSchema>;

const MINUTES_IN_DAY = 1440;

const offeringBase = {
  id: BookingIdSchema,
  name: z.string().trim().min(1).max(120),
  /** The resources that can serve it. With several, a visitor gets whichever is free, or picks one. */
  resourceIds: z.array(BookingIdSchema).min(1).max(BOOKING_LIMITS.resourcesPerOffering),
  /** `instant`: booked the moment it is made. `request`: the owner accepts or declines it first. */
  confirmation: z.enum(['instant', 'request']).default('instant'),
  /** How long before its start a booking can still be made. */
  minNoticeMin: z.number().int().min(0).max(MINUTES_IN_DAY * 365).default(0),
  /** How far ahead a booking can be made. */
  maxAdvanceDays: z.number().int().min(1).max(BOOKING_LIMITS.maxAdvanceDays).default(90),
  /** How many seats or units one booking may take (a family on a tour, three bikes). */
  maxQuantity: z.number().int().min(1).max(BOOKING_LIMITS.capacity).default(1),
  /**
   * The visitor picks which resource ("with Anna"). Off: they get whichever is free, and the resources'
   * names are never shown to them.
   */
  chooseResource: z.boolean().default(false),
};

export const BookingOfferingSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    ...offeringBase,
    mode: z.literal('duration'),
    durationMin: z.number().int().min(5).max(MINUTES_IN_DAY),
    /** Minutes between possible start times. Unset: one start every `durationMin`. */
    stepMin: z.number().int().min(5).max(MINUTES_IN_DAY).optional(),
    /** Kept free before and after each booking (setting up, travelling, cleaning). */
    bufferBeforeMin: z.number().int().min(0).max(MINUTES_IN_DAY).default(0),
    bufferAfterMin: z.number().int().min(0).max(MINUTES_IN_DAY).default(0),
  }),
  z
    .strictObject({
      ...offeringBase,
      mode: z.literal('slots'),
      slots: z.array(BookingSlotSchema).min(1).max(BOOKING_LIMITS.slots),
    })
    .superRefine((o, ctx) => {
      // Two slots starting at the same time on the same day would be one start with two seat counts.
      const seen = new Set<string>();
      o.slots.forEach((slot, i) => {
        for (const day of slot.days) {
          const key = `${day} ${slot.at}`;
          if (seen.has(key)) ctx.addIssue({ code: 'custom', message: `two slots start at ${slot.at} on ${day}`, path: ['slots', i, 'at'] });
          seen.add(key);
        }
      });
    }),
  z
    .strictObject({
      ...offeringBase,
      mode: z.literal('range'),
      minMin: z.number().int().min(5).max(MINUTES_IN_DAY),
      maxMin: z.number().int().min(5).max(MINUTES_IN_DAY),
      /**
       * Start and end fall on this grid of the local clock (every 30 minutes: 09:00, 09:30…). It divides the
       * day, so the grid is the same every day and runs on through midnight.
       */
      stepMin: z.number().int().min(5).max(MINUTES_IN_DAY).default(30),
    })
    .refine((o) => o.minMin <= o.maxMin, { message: 'the minimum is not longer than the maximum', path: ['maxMin'] })
    .refine((o) => MINUTES_IN_DAY % o.stepMin === 0, { message: 'a step that divides the day: 5, 10, 15, 20, 30, 45, 60, 90…', path: ['stepMin'] }),
  z
    .strictObject({
      ...offeringBase,
      mode: z.literal('days'),
      /** `night`: a stay, from check-in to check-out the next day. `day`: whole calendar days (check-in and check-out unused). */
      unit: z.enum(['night', 'day']).default('night'),
      minUnits: z.number().int().min(1).max(365).default(1),
      maxUnits: z.number().int().min(1).max(365).default(30),
      checkIn: StartClockSchema.default('15:00'),
      checkOut: StartClockSchema.default('11:00'),
    })
    .refine((o) => o.minUnits <= o.maxUnits, { message: 'the minimum is not longer than the maximum', path: ['maxUnits'] })
    // Otherwise one night's guest would still be there when the next night's arrives.
    .refine((o) => o.unit !== 'night' || clockMinutes(o.checkOut) <= clockMinutes(o.checkIn), {
      message: 'check-out is no later than check-in',
      path: ['checkOut'],
    }),
]);
export type BookingOffering = z.infer<typeof BookingOfferingSchema>;
export type BookingMode = BookingOffering['mode'];

/** A project's whole booking set-up. Ids are unique, and every offering names resources that exist. */
export const BookingConfigSchema = z
  .strictObject({
    resources: z.array(BookingResourceSchema).max(BOOKING_LIMITS.resources).default([]),
    offerings: z.array(BookingOfferingSchema).max(BOOKING_LIMITS.offerings).default([]),
    /** Proof of work on every booking request: self-hosted, no third party, needs the site on HTTPS. */
    pow: z.boolean().default(false),
    /** The project's captcha (Website settings) on every booking request. */
    captcha: z.boolean().default(false),
    /**
     * The page on the site where a customer sees their booking and can cancel it: the page carrying
     * `{{sw-booking-status}}`. Booking emails link there, with the booking's reference in the fragment
     * (`#t=…`), so every link a customer gets points at the business's own site.
     */
    // The reference is appended as `#t=…`, so the path carries no fragment of its own.
    statusPath: SitePathSchema.refine((p) => !p.includes('#'), 'must not contain #').optional(),
  })
  .superRefine((cfg, ctx) => {
    const resources = new Set<string>();
    cfg.resources.forEach((r, i) => {
      if (resources.has(r.id)) ctx.addIssue({ code: 'custom', message: `resource id "${r.id}" is used twice`, path: ['resources', i, 'id'] });
      resources.add(r.id);
    });
    const offerings = new Set<string>();
    cfg.offerings.forEach((o, i) => {
      if (offerings.has(o.id)) ctx.addIssue({ code: 'custom', message: `offering id "${o.id}" is used twice`, path: ['offerings', i, 'id'] });
      offerings.add(o.id);
      o.resourceIds.forEach((id, j) => {
        if (!resources.has(id)) ctx.addIssue({ code: 'custom', message: `no resource "${id}"`, path: ['offerings', i, 'resourceIds', j] });
      });
      // One offering, one clock: a visitor's calendar shows its days and times in a single time zone.
      const zones = new Set(o.resourceIds.map((id) => cfg.resources.find((r) => r.id === id)?.timeZone).filter((z) => z !== undefined));
      if (zones.size > 1) ctx.addIssue({ code: 'custom', message: `the resources of "${o.id}" are in different time zones`, path: ['offerings', i, 'resourceIds'] });
    });
  });
export type BookingConfig = z.infer<typeof BookingConfigSchema>;
