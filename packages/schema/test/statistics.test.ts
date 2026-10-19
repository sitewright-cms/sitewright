import { describe, expect, it } from 'vitest';
import { shiftStatsDay, statsDay, statsRetentionStart, StatsQuerySchema, WebsiteStatisticsSchema } from '../src/statistics.js';

describe('statistics days', () => {
  it('counts the 25-month retention window back from today', () => {
    expect(statsRetentionStart('2026-10-19')).toBe('2024-09-19');
    expect(statsRetentionStart('2026-01-15')).toBe('2023-12-15');
  });

  it('★ clamps a month-end day to the target month instead of overflowing into the next', () => {
    // 31 October minus 25 months: there is no 31 September, and it must not become 1 October.
    expect(statsRetentionStart('2026-10-31')).toBe('2024-09-30');
    expect(statsRetentionStart('2026-03-31')).toBe('2024-02-29'); // a leap February
    expect(statsRetentionStart('2027-03-31')).toBe('2025-02-28');
  });

  it('moves days across months and years', () => {
    expect(shiftStatsDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftStatsDay('2026-02-28', 1)).toBe('2026-03-01');
    expect(statsDay(new Date('2026-10-19T23:59:59Z'))).toBe('2026-10-19');
  });
});

describe('statistics schemas', () => {
  it('accepts the setting and a query, and rejects junk', () => {
    expect(WebsiteStatisticsSchema.parse({ enabled: true })).toEqual({ enabled: true });
    expect(StatsQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-19', device: 'mobile', country: 'DE' }).success).toBe(true);
    expect(StatsQuerySchema.safeParse({ from: 'yesterday', to: '2026-10-19' }).success).toBe(false);
    expect(StatsQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-19', country: 'de' }).success).toBe(false);
    expect(StatsQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-19', device: 'phone' }).success).toBe(false);
  });
});
