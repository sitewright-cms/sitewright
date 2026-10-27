import type { TileStatus } from '../board/summaries';
import { BookingConfigSchema, WEEKDAYS, type BookingConfig, type BookingMode, type BookingOffering, type BookingResource, type HoursRule, type Weekday } from '@sitewright/schema';

/**
 * The BOOKING SET-UP screen's pure rules: new resources and offerings, switching an offering's mode, the
 * schema's verdict by field, and the one-line summaries the Booking tile shows.
 *
 * The draft is a whole `BookingConfig`, replaced (never mutated) on every edit, and saved as one document.
 */

export const EMPTY_CONFIG: BookingConfig = { resources: [], offerings: [], pow: false, captcha: false };

export const MODE_LABELS: Record<BookingMode, string> = {
  duration: 'Appointments',
  slots: 'Set times',
  range: 'From–to',
  days: 'Nights or days',
};

export const MODE_HINTS: Record<BookingMode, string> = {
  duration: 'A fixed length, starting on a grid inside the opening hours (a haircut, a consultation).',
  slots: 'Set start times per weekday, each with its own seats (a tour, a class).',
  range: 'The visitor picks the start and the end, within a minimum and a maximum (a room by the hour).',
  days: 'Whole nights or days, with check-in and check-out times (a holiday flat, a bike by the day).',
};

export const WEEKDAY_LABELS: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

/** An id from a name: lower-case letters, digits and dashes, unique among `taken`. */
export function idFromName(name: string, taken: ReadonlySet<string>, fallback: string): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || fallback;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** The browser's own time zone, the likeliest one for a new resource. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Every time zone this browser knows, for the picker. */
export function timeZones(current: string): string[] {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf('timeZone');
  } catch {
    all = [];
  }
  // A stored zone the browser does not list (an alias such as UTC) stays pickable.
  return all.includes(current) ? all : [current, ...all];
}

const WORKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

export function newResource(config: BookingConfig, name: string): BookingResource {
  return {
    id: idFromName(name, new Set(config.resources.map((r) => r.id)), 'resource'),
    name,
    timeZone: config.resources[0]?.timeZone ?? localTimeZone(),
    capacity: 1,
    hours: [{ days: WORKDAYS, from: '09:00', to: '17:00' }],
    blocks: [],
  };
}

/** The fields one mode adds, at their defaults. */
function modeFields(mode: BookingMode): Record<string, unknown> {
  switch (mode) {
    case 'duration':
      return { durationMin: 60, bufferBeforeMin: 0, bufferAfterMin: 0 };
    case 'slots':
      return { slots: [{ days: WORKDAYS, at: '10:00', durationMin: 60 }] };
    case 'range':
      return { minMin: 60, maxMin: 240, stepMin: 30 };
    case 'days':
      return { unit: 'night', minUnits: 1, maxUnits: 14, checkIn: '15:00', checkOut: '11:00' };
  }
}

const BASE_KEYS = ['id', 'name', 'resourceIds', 'confirmation', 'minNoticeMin', 'maxAdvanceDays', 'maxQuantity', 'chooseResource'] as const;

export function newOffering(config: BookingConfig, name: string, mode: BookingMode): BookingOffering {
  return {
    id: idFromName(name, new Set(config.offerings.map((o) => o.id)), 'offering'),
    name,
    resourceIds: config.resources[0] ? [config.resources[0].id] : [],
    confirmation: 'instant',
    minNoticeMin: 0,
    maxAdvanceDays: 90,
    maxQuantity: 1,
    chooseResource: false,
    mode,
    ...modeFields(mode),
  } as BookingOffering;
}

/** The offering in another mode: what all modes share is kept, the new mode's own fields start at defaults. */
export function withMode(offering: BookingOffering, mode: BookingMode): BookingOffering {
  if (offering.mode === mode) return offering;
  const base = Object.fromEntries(BASE_KEYS.map((k) => [k, offering[k]]));
  return { ...base, mode, ...modeFields(mode) } as BookingOffering;
}

/** A resource removed, and with it from every offering that named it. */
export function removeResource(config: BookingConfig, id: string): BookingConfig {
  return {
    ...config,
    resources: config.resources.filter((r) => r.id !== id),
    offerings: config.offerings.map((o) => (o.resourceIds.includes(id) ? { ...o, resourceIds: o.resourceIds.filter((r) => r !== id) } : o)),
  };
}

/** Moves item `from` to `to` in a list (a new list). */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item as T);
  return out;
}

/** The schema's verdict on the draft: the first message per field, by dotted path (`resources.0.hours.1.to`). */
export function issuesByPath(config: unknown): Map<string, string> {
  const parsed = BookingConfigSchema.safeParse(config);
  const out = new Map<string, string>();
  if (parsed.success) return out;
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.');
    if (!out.has(key)) out.set(key, issue.message);
  }
  return out;
}

/** The messages at or under `prefix` (an item's own and its fields'). */
export function issuesUnder(issues: ReadonlyMap<string, string>, prefix: string): string[] {
  return [...issues].filter(([k]) => k === prefix || k.startsWith(`${prefix}.`)).map(([, m]) => m);
}

/** "Mon–Fri 09:00–17:00 · Sat 10:00–14:00": opening hours in one line. */
export function describeHours(rules: readonly HoursRule[]): string {
  if (rules.length === 0) return 'no opening hours';
  return rules.map((r) => `${describeDays(r.days)} ${r.from}–${r.to}`).join(' · ');
}

/** "Mon–Fri", "Sat, Sun", "every day": a set of weekdays, runs joined. */
export function describeDays(days: readonly Weekday[]): string {
  const idx = [...new Set(days.map((d) => WEEKDAYS.indexOf(d)))].filter((i) => i >= 0).sort((a, b) => a - b);
  if (idx.length === 7) return 'every day';
  const runs: string[] = [];
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j]! + 1) j += 1;
    const from = WEEKDAY_LABELS[WEEKDAYS[idx[i]!]!];
    const to = WEEKDAY_LABELS[WEEKDAYS[idx[j]!]!];
    runs.push(j - i >= 2 ? `${from}–${to}` : i === j ? from : `${from}, ${to}`);
    i = j + 1;
  }
  return runs.join(', ');
}

/** How long, in words: 90 → "1 h 30 min", 1440 → "1 day". */
export function describeMinutes(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} day${min === 1440 ? '' : 's'}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min';
}

/** What one offering is, in a few words, for its row. */
export function describeOffering(o: BookingOffering): string {
  switch (o.mode) {
    case 'duration':
      return `${describeMinutes(o.durationMin)} appointments`;
    case 'slots':
      return `${o.slots.length} set time${o.slots.length === 1 ? '' : 's'}`;
    case 'range':
      return `${describeMinutes(o.minMin)} to ${describeMinutes(o.maxMin)}`;
    case 'days':
      return `${o.minUnits}–${o.maxUnits} ${o.unit === 'night' ? 'nights' : 'days'}`;
  }
}

/** The Booking tile's status chip: off (nothing offered) or how many offerings. */
export function bookingStatus(config: BookingConfig | null): TileStatus {
  if (!config || config.offerings.length === 0) return { kind: 'na', label: 'Off' };
  const n = config.offerings.length;
  return { kind: 'set', label: `${n} offering${n === 1 ? '' : 's'}` };
}

/** How the booking requests are protected, in a word or two. */
export function protectionLabel(config: BookingConfig): string {
  const parts = [config.pow ? 'proof of work' : '', config.captcha ? 'captcha' : ''].filter(Boolean);
  return parts.length ? parts.join(' + ') : 'none';
}

/** "just now", "5 min ago", "3 h ago", "2 days ago": how long ago `at` was. */
export function since(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/**
 * While a resource or an offering is unsaved its id follows its name, unless the id was typed in by hand (it no
 * longer is the one the name gives). `others`: the ids of the rest of its kind.
 */
export function idFollowingName(prev: { id: string; name: string }, nextName: string, others: ReadonlySet<string>, fallback: string): string {
  return prev.id === idFromName(prev.name, others, fallback) ? idFromName(nextName, others, fallback) : prev.id;
}

/** Resource `index` replaced; a changed id is changed in the offerings that name it too. */
export function replaceResource(config: BookingConfig, index: number, next: BookingResource): BookingConfig {
  const prev = config.resources[index];
  const resources = config.resources.map((r, j) => (j === index ? next : r));
  if (!prev || prev.id === next.id) return { ...config, resources };
  return {
    ...config,
    resources,
    offerings: config.offerings.map((o) => (o.resourceIds.includes(prev.id) ? { ...o, resourceIds: o.resourceIds.map((id) => (id === prev.id ? next.id : id)) } : o)),
  };
}

/** JSON with every object's keys in order: two documents with the same content give the same text. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}
