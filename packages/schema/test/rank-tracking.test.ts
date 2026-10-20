import { describe, expect, it } from 'vitest';
import {
  normalizeRankDomain,
  normalizeRankKeyword,
  RankKeywordsInputSchema,
  RankProjectSettingsInputSchema,
  RankTrackingAdminInputSchema,
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
