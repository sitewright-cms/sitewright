import { describe, expect, it, vi } from 'vitest';
import { bingDay, type BingStat } from '../src/webmaster/bing.js';
import type { GoogleSearchRow } from '../src/webmaster/google.js';
import { SearchPerformance, type SearchDataSource } from '../src/webmaster/performance.js';
import { bingData, googleData, googleQueries, searchPeriod } from '../src/webmaster/search-data.js';

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
});

const g = (key: string, clicks: number, impressions: number, position: number): GoogleSearchRow => ({
  keys: [key],
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
});

describe('googleData', () => {
  const p = searchPeriod(7, NOW); // 2026-10-15 … 2026-10-21

  it('asks for the days, the top queries and pages, and the period before', () => {
    expect(googleQueries(p).map((q) => [q.dimensions ?? [], q.startDate, q.endDate])).toEqual([
      [['date'], '2026-10-15', '2026-10-21'],
      [['query'], '2026-10-15', '2026-10-21'],
      [['page'], '2026-10-15', '2026-10-21'],
      [[], '2026-10-08', '2026-10-14'],
    ]);
  });

  it('adds the days up, weights the position by impressions, and fills a quiet day — but not the days Google has not reported yet', () => {
    const data = googleData(
      [
        [g('2026-10-15', 2, 100, 10), g('2026-10-17', 6, 300, 4)],
        [g('roofing windhoek', 5, 50, 3.2), g('roof repair', 3, 350, 8)],
        [g('https://www.example.com/', 8, 400, 5)],
        [g('', 4, 200, 7)],
      ],
      p,
    );
    expect(data.totals).toEqual({ clicks: 8, impressions: 400, ctr: 0.02, position: (10 * 100 + 4 * 300) / 400 });
    expect(data.daily).toEqual([
      { date: '2026-10-15', clicks: 2, impressions: 100 },
      { date: '2026-10-16', clicks: 0, impressions: 0 },
      { date: '2026-10-17', clicks: 6, impressions: 300 },
    ]);
    expect(data.queries.map((q) => q.key)).toEqual(['roofing windhoek', 'roof repair']);
    expect(data.queries[0]).toEqual({ key: 'roofing windhoek', clicks: 5, impressions: 50, ctr: 0.1, position: 3.2 });
    expect(data.previous).toEqual({ clicks: 4, impressions: 200, ctr: 0.02, position: 7 });
  });

  it('reads an empty answer as nothing at all', () => {
    expect(googleData([[], [], [], []], p)).toEqual({
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

  it('keeps the period, adds the queries up across weeks, and weights their position', () => {
    const data = bingData(
      {
        daily: [b('2026-10-01', '', 9, 90), b('2026-10-15', '', 1, 20), b('2026-10-16', '', 3, 30), b('2026-10-09', '', 2, 40)],
        queries: [
          b('2026-10-15', 'roofing', 2, 10, 4),
          b('2026-10-20', 'roofing', 1, 30, 8),
          b('2026-10-15', 'gutters', 0, 5, null),
          b('2026-09-01', 'old query', 50, 500, 1),
        ],
        pages: [b('2026-10-15', 'https://www.example.com/', 4, 50, 6)],
      },
      p,
    );
    expect(data.totals).toEqual({ clicks: 4, impressions: 50, ctr: 0.08, position: null });
    expect(data.previous).toEqual({ clicks: 2, impressions: 40, ctr: 0.05, position: null });
    expect(data.daily.map((d) => d.date)).toEqual(['2026-10-15', '2026-10-16']);
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
  const data = { totals: { clicks: 1, impressions: 2, ctr: 0.5, position: 3 }, previous: null, daily: [], queries: [], pages: [] };
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
    expect(a).toMatchObject({ service: 'google', period: { days: 28, end: '2026-10-21' }, totals: data.totals, fetchedAt: NOW.toISOString() });
    now = new Date(NOW.getTime() + 59 * 60_000);
    await perf.view('p1', 'x', 'google', 28);
    expect(read).toHaveBeenCalledTimes(1);
    now = new Date(NOW.getTime() + 61 * 60_000);
    await perf.view('p1', 'x', 'google', 28);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('never reuses an answer for another period, URL or account, and forgets a failure', async () => {
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

    const failing = new SearchPerformance({ sources: async () => [source(async () => Promise.reject(new Error('down')))], now: () => NOW });
    await expect(failing.view('p1', 'x', 'google', 28)).rejects.toThrow('down');
    await expect(failing.view('p1', 'x', 'google', 28)).rejects.toThrow('down');
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
});
