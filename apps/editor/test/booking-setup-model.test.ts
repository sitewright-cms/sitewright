import { describe, it, expect } from 'vitest';
import type { BookingConfig } from '@sitewright/schema';
import {
  EMPTY_CONFIG,
  bookingStatus,
  describeDays,
  describeHours,
  describeMinutes,
  describeOffering,
  idFollowingName,
  idFromName,
  issuesByPath,
  issuesUnder,
  moved,
  newOffering,
  newResource,
  protectionLabel,
  removeResource,
  replaceResource,
  since,
  stableJson,
  withMode,
} from '../src/views/settings/booking/model';

/** The booking set-up screen's pure rules. */

const withAnna = (): BookingConfig => {
  const anna = { ...newResource(EMPTY_CONFIG, 'Anna Müller'), timeZone: 'Europe/Berlin' };
  const config = { ...EMPTY_CONFIG, resources: [anna] };
  return { ...config, offerings: [newOffering(config, 'Haircut', 'duration')] };
};

describe('ids', () => {
  it('makes an id from a name, unique among those taken', () => {
    expect(idFromName('Anna Müller', new Set(), 'resource')).toBe('anna-muller');
    expect(idFromName('Anna Müller', new Set(['anna-muller', 'anna-muller-2']), 'resource')).toBe('anna-muller-3');
    expect(idFromName('  ***  ', new Set(), 'resource')).toBe('resource');
    expect(idFromName('x'.repeat(60), new Set(), 'r')).toHaveLength(40);
  });
});

describe('new things start valid', () => {
  it('a resource with weekday hours, and an offering served by the first resource', () => {
    const config = withAnna();
    expect(config.resources[0]).toMatchObject({ id: 'anna-muller', capacity: 1, hours: [{ from: '09:00', to: '17:00' }] });
    expect(config.offerings[0]).toMatchObject({ id: 'haircut', mode: 'duration', durationMin: 60, resourceIds: ['anna-muller'] });
    expect(issuesByPath(config).size).toBe(0);
  });

  it('every mode, and a switch between modes, keeps what the modes share', () => {
    const config = withAnna();
    for (const mode of ['duration', 'slots', 'range', 'days'] as const) {
      const switched = withMode({ ...config.offerings[0]!, name: 'Renamed', maxAdvanceDays: 30 }, mode);
      expect(switched).toMatchObject({ mode, name: 'Renamed', maxAdvanceDays: 30, resourceIds: ['anna-muller'] });
      expect(issuesByPath({ ...config, offerings: [switched] }).size).toBe(0);
    }
    // No field of the old mode is left behind (the schema is strict).
    expect(withMode(config.offerings[0]!, 'days')).not.toHaveProperty('durationMin');
  });
});

describe('ids that follow names', () => {
  it('follows the name until the id is typed in by hand', () => {
    expect(idFollowingName({ id: 'resource-1', name: 'Resource 1' }, 'Anna', new Set(), 'resource')).toBe('anna');
    // Unique among the others: a second Anna.
    expect(idFollowingName({ id: 'resource-2', name: 'Resource 2' }, 'Anna', new Set(['anna']), 'resource')).toBe('anna-2');
    expect(idFollowingName({ id: 'my-own-id', name: 'Resource 1' }, 'Anna', new Set(), 'resource')).toBe('my-own-id');
  });

  it('changes a resource’s id in the offerings that name it', () => {
    const config = withAnna();
    const next = replaceResource(config, 0, { ...config.resources[0]!, id: 'anna' });
    expect(next.offerings[0]!.resourceIds).toEqual(['anna']);
    expect(issuesByPath(next).size).toBe(0);
  });
});

describe('removing a resource', () => {
  it('takes it out of the offerings that named it, and the schema then says what is missing', () => {
    const config = removeResource(withAnna(), 'anna-muller');
    expect(config.resources).toEqual([]);
    expect(config.offerings[0]!.resourceIds).toEqual([]);
    expect(issuesUnder(issuesByPath(config), 'offerings.0').length).toBeGreaterThan(0);
  });
});

describe('the schema’s verdict by field', () => {
  it('names the field', () => {
    const config = withAnna();
    const bad = { ...config, resources: [{ ...config.resources[0]!, hours: [{ days: ['mon'], from: '17:00', to: '09:00' }] }] };
    const issues = issuesByPath(bad);
    expect(issues.get('resources.0.hours.0.to')).toMatch(/closes after it opens/);
    expect(issuesUnder(issues, 'resources.0')).toHaveLength(1);
    expect(issuesUnder(issues, 'offerings')).toHaveLength(0);
  });
});

describe('words', () => {
  it('describes days, hours and lengths', () => {
    expect(describeDays(['mon', 'tue', 'wed', 'thu', 'fri'])).toBe('Mon–Fri');
    expect(describeDays(['sat', 'sun'])).toBe('Sat, Sun');
    expect(describeDays(['mon', 'wed', 'thu', 'fri', 'sun'])).toBe('Mon, Wed–Fri, Sun');
    expect(describeDays(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])).toBe('every day');
    expect(describeHours([])).toBe('no opening hours');
    expect(describeHours([{ days: ['mon'], from: '09:00', to: '12:00' }, { days: ['mon'], from: '13:00', to: '17:00' }])).toBe('Mon 09:00–12:00 · Mon 13:00–17:00');
    expect(describeMinutes(90)).toBe('1 h 30 min');
    expect(describeMinutes(45)).toBe('45 min');
    expect(describeMinutes(2880)).toBe('2 days');
    expect(describeOffering(withMode(withAnna().offerings[0]!, 'days'))).toBe('1–14 nights');
  });

  it('sums up the set-up for the tile', () => {
    expect(bookingStatus(null)).toEqual({ kind: 'na', label: 'Off' });
    expect(bookingStatus(EMPTY_CONFIG)).toEqual({ kind: 'na', label: 'Off' });
    expect(bookingStatus(withAnna())).toEqual({ kind: 'set', label: '1 offering' });
    expect(protectionLabel({ ...EMPTY_CONFIG, pow: true, captcha: true })).toBe('proof of work + captcha');
    expect(protectionLabel(EMPTY_CONFIG)).toBe('none');
  });
});

describe('stableJson', () => {
  it('gives the same text whatever the order of the keys', () => {
    expect(stableJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: 3 } })).toBe(stableJson({ a: { c: 3, d: [{ x: 2, y: 1 }] }, b: 1 }));
    expect(stableJson({ a: [1, 2] })).not.toBe(stableJson({ a: [2, 1] }));
  });
});

describe('since', () => {
  it('says how long ago', () => {
    const now = Date.UTC(2026, 9, 27, 12);
    expect(since(now - 20_000, now)).toBe('just now');
    expect(since(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(since(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(since(now - 50 * 3_600_000, now)).toBe('2 days ago');
  });
});

describe('moved', () => {
  it('moves an item, and leaves the list alone at the edges', () => {
    expect(moved(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moved(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });
});
