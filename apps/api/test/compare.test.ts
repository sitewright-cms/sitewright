import { describe, it, expect } from 'vitest';
import { compareTargets } from '../src/render/compare.js';

const base = { projectId: 'p1', sig: 'SIG', originHostPort: '127.0.0.1:80' };

describe('compareTargets', () => {
  it('errors when the page is missing', () => {
    expect(compareTargets({ ...base, page: null })).toEqual({ error: 'not-found' });
  });

  it('errors when the page has no imported source', () => {
    expect(compareTargets({ ...base, page: { path: 'about', data: {} } })).toEqual({ error: 'no-source' });
    expect(compareTargets({ ...base, page: { path: 'about', data: { swImport: {} } } })).toEqual({ error: 'no-source' });
  });

  it('builds the loopback preview URL for the home route (no trailing segment)', () => {
    const t = compareTargets({ ...base, page: { path: '', data: { swImport: { sourceUrl: 'https://ex.com/' } } } });
    expect(t).toMatchObject({ sourceUrl: 'https://ex.com/', route: '' });
    if ('buildUrl' in t) expect(t.buildUrl).toBe('http://127.0.0.1:80/preview-site/p1/SIG/');
  });

  it('rebases a nested route with a trailing slash + strips a leading slash', () => {
    const t = compareTargets({ ...base, page: { path: '/about/team', data: { swImport: { sourceUrl: 'https://ex.com/about/team' } } } });
    expect(t).toMatchObject({ route: 'about/team' });
    if ('buildUrl' in t) expect(t.buildUrl).toBe('http://127.0.0.1:80/preview-site/p1/SIG/about/team/');
  });

  it('parses + filters the viewports query string (drops unknowns, trims)', () => {
    const page = { path: '', data: { swImport: { sourceUrl: 'https://ex.com/' } } };
    expect(compareTargets({ ...base, page, viewports: 'fullhd, mobile, bogus' })).toMatchObject({ viewports: ['fullhd', 'mobile'] });
    expect('viewports' in compareTargets({ ...base, page, viewports: '' })).toBe(false);
    expect('viewports' in compareTargets({ ...base, page })).toBe(false); // omitted entirely
  });
});
