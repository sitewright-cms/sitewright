import { shiftStatsDay, statsDay, type StatsClass, type StatsSource } from '@sitewright/schema';

/** The ranges the Statistics tab offers, in days (today counts as one). */
export const STATS_RANGES = [
  { id: 'today', label: 'Today', days: 1 },
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: '12m', label: '12 months', days: 365 },
] as const;
export type StatsRangeId = (typeof STATS_RANGES)[number]['id'];

/** The UTC days a range covers, ending today. */
export function rangeDays(id: StatsRangeId, now: Date = new Date()): { from: string; to: string } {
  const to = statsDay(now);
  const days = STATS_RANGES.find((r) => r.id === id)?.days ?? 30;
  return { from: shiftStatsDay(to, -(days - 1)), to };
}

const numberFmt = new Intl.NumberFormat('en');
export const fmt = (n: number): string => numberFmt.format(n);

/** `part` as a whole percentage of `total` ('0%' for an empty total). */
export function pct(part: number, total: number): string {
  if (total <= 0) return '0%';
  const p = (part / total) * 100;
  return `${p > 0 && p < 1 ? '<1' : Math.round(p)}%`;
}

let regionNames: Intl.DisplayNames | null = null;
/** A country's English name; `ZZ` is the collector's "unknown". */
export function countryName(code: string): string {
  if (code === 'ZZ') return 'Unknown';
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** A country's flag emoji (a globe for unknown). */
export function countryFlag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code) || code === 'ZZ') return '🌐';
  const base = 0x1f1e6;
  return String.fromCodePoint(base + code.charCodeAt(0) - 65, base + code.charCodeAt(1) - 65);
}

export const BOT_LABELS: Record<Exclude<StatsClass, 'human'>, string> = {
  search: 'Search engines',
  ai: 'AI crawlers and assistants',
  seo: 'SEO tools',
  monitor: 'Uptime monitors',
  social: 'Link previews',
  bot: 'Other bots',
};

export const SOURCE_LABELS: Record<StatsSource, string> = {
  direct: 'Direct',
  search: 'Search',
  social: 'Social',
  ai: 'AI assistants',
  referral: 'Referral',
  campaign: 'Campaign',
};

/** A day with its weekday and year, as a tooltip heads it: "Mon, 19 Oct 2026". */
export function longDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** `n` with its noun, singular for one: "1 visitor", "1,200 visitors". */
export function counted(n: number, noun: string): string {
  return `${fmt(n)} ${noun}${n === 1 ? '' : 's'}`;
}

/** A day for a chart label: `19 Oct`. */
export function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
