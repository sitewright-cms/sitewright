import { describe, it, expect } from 'vitest';
import { parseLiveTarget, buildLiveUrl } from '../src/lib/live-target';

describe('parseLiveTarget', () => {
  it('parses a well-formed ?live=project/page', () => {
    expect(parseLiveTarget('?live=p1/home')).toEqual({ projectId: 'p1', pageId: 'home' });
  });

  it('returns null when the param is absent', () => {
    expect(parseLiveTarget('')).toBeNull();
    expect(parseLiveTarget('?foo=bar')).toBeNull();
  });

  it('returns null for malformed values (wrong arity or empty segments)', () => {
    expect(parseLiveTarget('?live=p1')).toBeNull();
    expect(parseLiveTarget('?live=p1/page/extra')).toBeNull();
    expect(parseLiveTarget('?live=/home')).toBeNull();
  });

  it('round-trips through buildLiveUrl', () => {
    const target = { projectId: 'p1', pageId: 'home' };
    const url = buildLiveUrl('https://cms.test', '/', target);
    expect(url).toBe('https://cms.test/?live=p1%2Fhome');
    expect(parseLiveTarget(new URL(url).search)).toEqual(target);
  });
});
