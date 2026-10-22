import { describe, expect, it, vi } from 'vitest';
import { bingDay, type BingStat } from '../src/webmaster/bing.js';
import type { GoogleSearchRow } from '../src/webmaster/google.js';
import { SearchPerformance, type SearchDataSource } from '../src/webmaster/performance.js';
import { bingData, googleReport, reportedPeriod, searchPeriod, type GoogleAsk } from '../src/webmaster/search-data.js';

/**
 * Search performance, shaped: the period (Pacific days, as both search engines count them), Google's and Bing's
 * answers turned into the same numbers, and the hour-long cache in front of them.
 */

// 05:00 UTC on the 22nd is still the 21st in California.
const NOW = new Date('2026-10-22T05:00:00Z');

describe('searchPeriod', () => {
  it('ends today in Pacific time, and the period before is as long', () => {
    expect(searchPeriod(28, NOW)).toEqual({ days: 28, start: '2026-09-24', end: '2026-10-21', previous: { start: '2026-08-27', end: '2026-09-23' } });
    expect(searchPeriod(7, new Date('2026-10-22T09:00:00Z'))).toMatchObject({ start: '2026-10-16', end: '2026-10-22' });
  });

  it('counts calendar days across a daylight-saving change', () => {
    // 1 Nov 2026 has 25 hours in California, 8 Mar 2026 has 23.
    expect(searchPeriod(7, new Date('2026-11-04T20:00:00Z'))).toMatchObject({ start: '2026-10-29', end: '2026-11-04', previous: { start: '2026-10-22', end: '2026-10-28' } });
    expect(searchPeriod(7, new Date('2026-03-10T20:00:00Z'))).toMatchObject({ start: '2026-03-04', end: '2026-03-10', previous: { start: '2026-02-25', end: '2026-03-03' } });
  });

  it('moves back to the newest reported day — at most three days, so a quiet site stays quiet', () => {
    const p = searchPeriod(7, NOW); // … 2026-10-21
    expect(reportedPeriod(p, ['2026-10-19', '2026-10-12'])).toMatchObject({ start: '2026-10-13', end: '2026-10-19', previous: { start: '2026-10-06', end: '2026-10-12' } });
    expect(reportedPeriod(p, ['2026-10-21'])).toBe(p);
    expect(reportedPeriod(p, ['2026-10-01'])).toMatchObject({ end: '2026-10-18' });
    expect(reportedPeriod(p, [])).toMatchObject({ end: '2026-10-18' });
  });
});

const g = (key: string, clicks: number, impressions: number, position: number): GoogleSearchRow => ({
  keys: [key],
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
});

describe('googleReport', () => {
  const p = searchPeriod(7, NOW); // 2026-10-15 … 2026-10-21

  /** Google's answers, by the dimension asked for; every query asked is kept, and every round (one `ask`) counted. */
  function google(byDimension: Record<string, GoogleSearchRow[]>) {
    const asked: Array<{ dimensions?: string[]; startDate: string; endDate: string }> = [];
    let rounds = 0;
    const ask: GoogleAsk = async (queries) => {
      rounds++;
      asked.push(...queries);
      return queries.map((q) => byDimension[q.dimensions?.[0] ?? ''] ?? []);
    };
    return { ask, asked, rounds: () => rounds };
  }
  const answers = {
    date: [g('2026-10-12', 1, 30, 9), g('2026-10-13', 2, 100, 10), g('2026-10-15', 6, 300, 4), g('2026-10-19', 1, 20, 5)],
    query: [g('roofing windhoek', 5, 50, 3.2), g('roof repair', 3, 350, 8)],
    page: [g('https://www.example.com/', 8, 400, 5)],
  };

  it('asks for the days, searches and pages in ONE round when the period ends where expected', async () => {
    const { ask, asked, rounds } = google(answers);
    const data = await googleReport(ask, p, '2026-10-19');
    expect(rounds()).toBe(1);
    expect(asked.map((q) => [q.dimensions ?? [], q.startDate, q.endDate])).toEqual([
      [['date'], '2026-10-05', '2026-10-21'],
      [['query'], '2026-10-13', '2026-10-19'],
      [['page'], '2026-10-13', '2026-10-19'],
    ]);
    // Google's newest day is the 19th: the week shown ends there, and the week before is added up the same way.
    expect(data.period).toEqual({ start: '2026-10-13', end: '2026-10-19' });
    expect(data.totals).toEqual({ clicks: 9, impressions: 420, ctr: 9 / 420, position: (10 * 100 + 4 * 300 + 5 * 20) / 420 });
    expect(data.previous).toEqual({ clicks: 1, impressions: 30, ctr: 1 / 30, position: 9 });
    expect(data.daily.map((d) => [d.date, d.clicks])).toEqual([
      ['2026-10-13', 2],
      ['2026-10-14', 0],
      ['2026-10-15', 6],
      ['2026-10-16', 0],
      ['2026-10-17', 0],
      ['2026-10-18', 0],
      ['2026-10-19', 1],
    ]);
    expect(data.queries.map((q) => q.key)).toEqual(['roofing windhoek', 'roof repair']);
    expect(data.queries[0]).toEqual({ key: 'roofing windhoek', clicks: 5, impressions: 50, ctr: 0.1, position: 3.2 });
  });

  it('asks for the searches and pages again when Google’s newest day is not the expected one, and shows those', async () => {
    const { ask, asked, rounds } = google(answers);
    // Nothing known: expected yesterday (the 20th); Google's newest is the 19th.
    const data = await googleReport(ask, p);
    expect(rounds()).toBe(2);
    expect(asked.map((q) => [q.dimensions ?? [], q.startDate, q.endDate])).toEqual([
      [['date'], '2026-10-05', '2026-10-21'],
      [['query'], '2026-10-14', '2026-10-20'],
      [['page'], '2026-10-14', '2026-10-20'],
      [['query'], '2026-10-13', '2026-10-19'],
      [['page'], '2026-10-13', '2026-10-19'],
    ]);
    expect(data.period).toEqual({ start: '2026-10-13', end: '2026-10-19' });
  });

  it('keeps an expected day inside the days a period can end on', async () => {
    const early = google({});
    await googleReport(early.ask, p, '2026-09-01'); // before the three days a period moves back at most
    expect(early.asked[1]).toMatchObject({ startDate: '2026-10-12', endDate: '2026-10-18' });
    expect(early.rounds()).toBe(1); // a quiet site: the period ends three days back, as expected
    const late = google({});
    await googleReport(late.ask, p, '2026-12-01');
    expect(late.asked[1]).toMatchObject({ startDate: '2026-10-15', endDate: '2026-10-21' });
  });

  it('reads an empty answer as nothing at all', async () => {
    const data = await googleReport(google({}).ask, p);
    expect(data).toEqual({
      period: { start: '2026-10-12', end: '2026-10-18' },
      totals: { clicks: 0, impressions: 0, ctr: null, position: null },
      previous: { clicks: 0, impressions: 0, ctr: null, position: null },
      daily: [],
      queries: [],
      pages: [],
    });
  });
});

const b = (date: string, key: string, clicks: number, impressions: number, position: number | null = null): BingStat => ({ date, key, clicks, impressions, position });

describe('bingData', () => {
  const p = searchPeriod(7, NOW);

  it('reads Bing’s WCF dates as Pacific days', () => {
    expect(bingDay('/Date(1316156400000-0700)/')).toBe('2011-09-16');
    expect(bingDay('/Date(1792652400000)/')).toBe('2026-10-22'); // 07:00 UTC = midnight Pacific
    for (const bad of ['2026-10-21', '/Date(abc)/', null, 5]) expect(bingDay(bad)).toBeNull();
  });

  it('ends on Bing’s newest day, adds the queries up across the weeks that overlap it, and weights their position', () => {
    const data = bingData(
      {
        daily: [b('2026-10-01', '', 9, 90), b('2026-10-13', '', 1, 20), b('2026-10-19', '', 3, 30), b('2026-10-09', '', 2, 40)],
        queries: [
          b('2026-10-08', 'roofing', 2, 10, 4), // a week dated before the period that still overlaps it
          b('2026-10-15', 'roofing', 1, 30, 8),
          b('2026-10-15', 'gutters', 0, 5, null),
          b('2026-10-05', 'old query', 50, 500, 1), // a week that ended before the period
        ],
        pages: [b('2026-10-15', 'https://www.example.com/', 4, 50, 6)],
      },
      p,
    );
    expect(data.period).toEqual({ start: '2026-10-13', end: '2026-10-19' });
    expect(data.totals).toEqual({ clicks: 4, impressions: 50, ctr: 0.08, position: null });
    expect(data.previous).toEqual({ clicks: 2, impressions: 40, ctr: 0.05, position: null });
    expect(data.daily.map((d) => d.date)).toEqual(['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']);
    expect(data.queries).toEqual([
      { key: 'roofing', clicks: 3, impressions: 40, ctr: 0.075, position: (4 * 10 + 8 * 30) / 40 },
      { key: 'gutters', clicks: 0, impressions: 5, ctr: 0, position: null },
    ]);
    expect(data.pages[0]!.key).toBe('https://www.example.com/');
  });

  it('has no "before" when Bing keeps no traffic that old', () => {
    expect(bingData({ daily: [b('2026-10-16', '', 1, 10)], queries: [], pages: [] }, p).previous).toBeNull();
  });
});

describe('SearchPerformance (the cache)', () => {
  const data = { period: { start: '2026-09-21', end: '2026-10-18' }, totals: { clicks: 1, impressions: 2, ctr: 0.5, position: 3 }, previous: null, daily: [], queries: [], pages: [] };
  const source = (read: SearchDataSource['read'], over: Partial<SearchDataSource> = {}): SearchDataSource => ({
    service: 'google',
    siteUrl: 'https://www.example.com/',
    accountId: 'sa@x.iam.gserviceaccount.com',
    read,
    ...over,
  });

  it('asks once per hour, and once for requests that arrive together', async () => {
    let now = NOW;
    const read = vi.fn(async () => data);
    const perf = new SearchPerformance({ sources: async () => [source(read)], now: () => now });
    const [a, b2] = await Promise.all([perf.view('p1', 'x', 'google', 28), perf.view('p1', 'x', 'google', 28)]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(a).toBe(b2);
    // The days shown are the ones the search engine's answer covers.
    expect(a).toMatchObject({ service: 'google', period: { days: 28, start: '2026-09-21', end: '2026-10-18' }, totals: data.totals, fetchedAt: NOW.toISOString() });
    now = new Date(NOW.getTime() + 59 * 60_000);
    await perf.view('p1', 'x', 'google', 28);
    expect(read).toHaveBeenCalledTimes(1);
    now = new Date(NOW.getTime() + 61 * 60_000);
    await perf.view('p1', 'x', 'google', 28);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('tells the next read of the site where its last answer ended, so Google is asked in one round', async () => {
    const read = vi.fn<SearchDataSource['read']>(async () => data);
    const perf = new SearchPerformance({ sources: async () => [source(read)], now: () => NOW });
    await perf.view('p1', 'x', 'google', 28);
    expect(read.mock.calls[0]![1]).toBeUndefined(); // nothing known yet
    await perf.view('p1', 'x', 'google', 7);
    // The 28 days ended on the 18th, three days before today (the 21st in California): so will the 7.
    expect(read.mock.calls[1]![1]).toBe('2026-10-18');
    await perf.view('p2', 'x', 'google', 7);
    expect(read.mock.calls[2]![1]).toBeUndefined(); // another project's site is not this one
  });

  it('remembers a bounded number of sites’ delays', async () => {
    const read = vi.fn<SearchDataSource['read']>(async () => data);
    const perf = new SearchPerformance({ sources: async (projectId) => [source(read, { siteUrl: `https://${projectId}.example/` })], now: () => NOW, maxEntries: 2 });
    for (const p of ['p1', 'p2', 'p3']) await perf.view(p, 'x', 'google', 28);
    await perf.view('p1', 'x', 'google', 7);
    expect(read.mock.calls.at(-1)![1]).toBeUndefined(); // p1's went to make room
    await perf.view('p3', 'x', 'google', 7);
    expect(read.mock.calls.at(-1)![1]).toBe('2026-10-18');
  });

  it('never reuses an answer for another period, URL or account', async () => {
    const read = vi.fn(async () => data);
    let over: Partial<SearchDataSource> = {};
    const perf = new SearchPerformance({ sources: async () => [source(read, over)], now: () => NOW });
    await perf.view('p1', 'x', 'google', 28);
    await perf.view('p1', 'x', 'google', 7);
    over = { siteUrl: 'https://new.example.com/' };
    await perf.view('p1', 'x', 'google', 7);
    over = { siteUrl: 'https://new.example.com/', accountId: 'other@x.iam.gserviceaccount.com' };
    await perf.view('p1', 'x', 'google', 7);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('remembers a refusal for two minutes, then asks again — and an answer then replaces it', async () => {
    let now = NOW;
    const read = vi.fn<SearchDataSource['read']>().mockRejectedValueOnce(new Error('down')).mockResolvedValue(data);
    const perf = new SearchPerformance({ sources: async () => [source(read)], now: () => now });
    await expect(perf.view('p1', 'x', 'google', 28)).rejects.toThrow('down');
    await expect(perf.view('p1', 'x', 'google', 28)).rejects.toThrow('down');
    expect(read).toHaveBeenCalledTimes(1); // the second viewer did not ask a search engine that is down
    now = new Date(NOW.getTime() + 2 * 60_000 + 1);
    expect(await perf.view('p1', 'x', 'google', 28)).toMatchObject({ totals: data.totals });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('answers null for a search engine without data, and lists the ones with data', async () => {
    const perf = new SearchPerformance({ sources: async () => [source(async () => data, { service: 'bing' })], now: () => NOW });
    expect(await perf.view('p1', 'x', 'google', 28)).toBeNull();
    expect(await perf.available('p1', 'x')).toEqual({ services: ['bing'] });
  });

  it('keeps a bounded number of answers, dropping the oldest', async () => {
    const read = vi.fn(async () => data);
    const perf = new SearchPerformance({ sources: async () => [source(read)], now: () => NOW, maxEntries: 2 });
    await perf.view('p1', 'x', 'google', 7);
    await perf.view('p2', 'x', 'google', 7);
    await perf.view('p3', 'x', 'google', 7);
    await perf.view('p1', 'x', 'google', 7); // dropped: asked again
    await perf.view('p3', 'x', 'google', 7); // kept
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('forgets a deleted project’s answers, refusals and lag, and only that project’s', async () => {
    const read = vi.fn<SearchDataSource['read']>(async () => data);
    const perf = new SearchPerformance({ sources: async () => [source(read)], now: () => NOW });
    await perf.view('p1', 'x', 'google', 28);
    await perf.view('p10', 'x', 'google', 28); // a prefix of another id is not the same project
    read.mockRejectedValueOnce(new Error('down'));
    await expect(perf.view('p1', 'x', 'google', 7)).rejects.toThrow('down');
    expect(read.mock.calls.at(-1)![1]).toBe('2026-10-18'); // p1's lag was known
    perf.forgetProject('p1');
    await perf.view('p1', 'x', 'google', 28); // asked again…
    expect(read.mock.calls.at(-1)![1]).toBeUndefined(); // …with no lag remembered
    await perf.view('p1', 'x', 'google', 7); // the refusal is forgotten too
    await perf.view('p10', 'x', 'google', 28); // still kept
    expect(read).toHaveBeenCalledTimes(5);
  });

  it('drops expired answers and refusals when it stores a new one, instead of keeping them until it overflows', async () => {
    let now = NOW;
    const read = vi.fn<SearchDataSource['read']>().mockRejectedValueOnce(new Error('down')).mockResolvedValue(data);
    const perf = new SearchPerformance({ sources: async () => [source(read)], now: () => now });
    const kept = perf as unknown as { answers: Map<string, unknown>; failures: Map<string, unknown> };
    await expect(perf.view('p1', 'x', 'google', 7)).rejects.toThrow('down');
    await perf.view('p2', 'x', 'google', 28);
    expect([kept.answers.size, kept.failures.size]).toEqual([1, 1]);
    now = new Date(NOW.getTime() + 61 * 60_000);
    await perf.view('p3', 'x', 'google', 28);
    expect([...kept.answers.keys()].map((k) => k.split('\n')[0])).toEqual(['p3']);
    expect(kept.failures.size).toBe(0);
  });
});
