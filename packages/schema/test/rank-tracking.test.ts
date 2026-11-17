import { describe, expect, it } from 'vitest';
import {
  normalizeRankDomain,
  normalizeRankKeyword,
  RankKeywordsInputSchema,
  RankProjectSettingsInputSchema,
  RankTrackingAdminInputSchema,
  RANK_DEPTHS,
  rankNextStage,
  rankPagesFor,
  rankStages,
} from '../src/index.js';

describe('normalizeRankDomain', () => {
  it.each([
    ['plumbers.na', 'plumbers.na'],
    ['www.Plumbers.NA', 'plumbers.na'],
    ['https://www.plumbers.na/services/?x=1', 'plumbers.na'],
    ['plumbers.na:8443/path', 'plumbers.na'],
    ['shop.plumbers.co.za.', 'shop.plumbers.co.za'],
    ['http://xn--bcher-kva.example/', 'xn--bcher-kva.example'],
  ])('%s → %s', (raw, host) => {
    expect(normalizeRankDomain(raw)).toBe(host);
  });

  it.each(['', 'localhost', 'not a domain', '-bad.test', 'bad-.test', 'ftp//x', 'a..b', 'co.uk', 'www.com.na'])('refuses %j', (raw) => {
    expect(normalizeRankDomain(raw)).toBeUndefined();
  });
});

describe('keywords', () => {
  it('lowercases and collapses whitespace, so two spellings are one keyword', () => {
    expect(normalizeRankKeyword('  Plumber\t\tWINDHOEK ')).toBe('plumber windhoek');
  });

  it('refuses empty, overlong and control-character keywords, and a malformed location or language', () => {
    const base = { location: { name: 'Namibia', countryCode: 'NA' }, languageCode: 'en' };
    expect(RankKeywordsInputSchema.safeParse({ ...base, keywords: ['ok'] }).success).toBe(true);
    expect(RankKeywordsInputSchema.safeParse({ ...base, keywords: ['   '] }).success).toBe(false);
    expect(RankKeywordsInputSchema.safeParse({ ...base, keywords: ['x'.repeat(121)] }).success).toBe(false);
    expect(RankKeywordsInputSchema.safeParse({ ...base, keywords: ['a\u0000b'] }).success).toBe(false);
    // C1 too: NEL (U+0085) breaks a line in some readers, which could split one search into two.
    expect(RankKeywordsInputSchema.safeParse({ ...base, keywords: ['a\u0085b'] }).success).toBe(false);
    expect(RankKeywordsInputSchema.safeParse({ ...base, keywords: ['café'] }).success).toBe(true);
    expect(RankKeywordsInputSchema.safeParse({ ...base, keywords: [] }).success).toBe(false);
    expect(RankKeywordsInputSchema.safeParse({ ...base, keywords: ['ok'], location: { name: '<b>', countryCode: 'NA' } }).success).toBe(false);
    expect(RankKeywordsInputSchema.safeParse({ ...base, keywords: ['ok'], location: { name: 'Namibia', countryCode: 'na' } }).success).toBe(false);
    expect(RankKeywordsInputSchema.safeParse({ ...base, keywords: ['ok'], languageCode: 'English' }).success).toBe(false);
  });

  it('defaults to Google on desktop', () => {
    const parsed = RankKeywordsInputSchema.parse({ keywords: ['ok'], location: { name: 'Namibia', countryCode: 'NA' }, languageCode: 'pt-BR' });
    expect(parsed).toMatchObject({ engine: 'google', device: 'desktop', languageCode: 'pt-BR' });
  });
});

describe('settings', () => {
  it('normalizes the domain and defaults to a weekly check of the top 100', () => {
    expect(RankProjectSettingsInputSchema.parse({ domain: 'https://www.plumbers.na' })).toEqual({
      domain: 'plumbers.na',
      includeSubdomains: true,
      schedule: 'weekly',
      depth: 100,
    });
    expect(RankProjectSettingsInputSchema.safeParse({ domain: 'plumbers.na', depth: 15 }).success).toBe(false);
    // Top 30 is gone: existing projects were moved to Top 50.
    expect(RankProjectSettingsInputSchema.safeParse({ domain: 'plumbers.na', depth: 30 }).success).toBe(false);
    expect(RANK_DEPTHS).toEqual([10, 20, 50, 100]);
  });

  it('admin input: field names are plain identifiers, budgets have a ceiling', () => {
    expect(RankTrackingAdminInputSchema.safeParse({ credentials: { dataforseo: { login: 'a' } } }).success).toBe(true);
    expect(RankTrackingAdminInputSchema.safeParse({ credentials: { dataforseo: { __proto__x: 'a' } } }).success).toBe(false);
    expect(RankTrackingAdminInputSchema.safeParse({ credentials: { other: { login: 'a' } } }).success).toBe(false);
    expect(RankTrackingAdminInputSchema.safeParse({ monthlyBudgetUsd: -1 }).success).toBe(false);
    // Credentials for some providers, not every one.
    expect(RankTrackingAdminInputSchema.safeParse({ credentials: {} }).success).toBe(true);
  });
});

describe('stages: a check reads further pages only while the site has not turned up', () => {
  it('reads page 1, then 2, then 3–5, then 6–10 — cut at the depth', () => {
    expect(rankStages(10)).toEqual([{ startPage: 1, pages: 1 }]);
    expect(rankStages(20)).toEqual([
      { startPage: 1, pages: 1 },
      { startPage: 2, pages: 1 },
    ]);
    expect(rankStages(50)).toEqual([
      { startPage: 1, pages: 1 },
      { startPage: 2, pages: 1 },
      { startPage: 3, pages: 3 },
    ]);
    expect(rankStages(100)).toEqual([
      { startPage: 1, pages: 1 },
      { startPage: 2, pages: 1 },
      { startPage: 3, pages: 3 },
      { startPage: 6, pages: 5 },
    ]);
  });

  it('copes with depths that are not tiers: a check sent before the change, or one past the plan', () => {
    expect(rankStages(30)).toEqual([
      { startPage: 1, pages: 1 },
      { startPage: 2, pages: 1 },
      { startPage: 3, pages: 1 },
    ]);
    expect(rankStages(120).at(-1)).toEqual({ startPage: 11, pages: 2 });
    for (const d of [10, 20, 30, 50, 100, 120]) expect(rankStages(d).reduce((n, s) => n + s.pages, 0)).toBe(rankPagesFor(d));
  });

  it('the next request is the rest of the stage the next unread page falls in', () => {
    expect(rankNextStage(100, 0)).toEqual({ startPage: 1, pages: 1 });
    expect(rankNextStage(100, 1)).toEqual({ startPage: 2, pages: 1 });
    expect(rankNextStage(100, 2)).toEqual({ startPage: 3, pages: 3 });
    expect(rankNextStage(100, 4)).toEqual({ startPage: 5, pages: 1 }); // a stage cut short: only what is left of it
    expect(rankNextStage(100, 5)).toEqual({ startPage: 6, pages: 5 });
    expect(rankNextStage(100, 10)).toBeNull();
    expect(rankNextStage(20, 2)).toBeNull();
    expect(rankNextStage(10, 1)).toBeNull();
  });
});
