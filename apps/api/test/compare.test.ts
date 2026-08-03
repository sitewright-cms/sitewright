import { describe, it, expect } from 'vitest';
import { compareTargets, scoreFidelity, captureIssue } from '../src/render/compare.js';
import type { ChromeEl, ChromeMeta } from '@sitewright/site-import/fidelity';

const base = { projectId: 'p1', sig: 'SIG', originHostPort: '127.0.0.1:80' };

const cel = (o: Partial<ChromeEl> = {}): ChromeEl => ({
  role: 'button', tag: 'a', text: '', region: 'header', x: 0, y: 10, w: 100, h: 40,
  font: 'secondary-font', size: '14px', weight: '400', color: 'rgb(2,139,192)',
  bg: 'rgba(0, 0, 0, 0)', bgImage: 'none', shadow: 'none', transform: 'none', radius: '5px', ...o,
});
const side = (items: ChromeEl[], meta: ChromeMeta = {}) => ({ items, meta });

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

describe('scoreFidelity', () => {
  it('PASSES when build matches the original (body + chrome + meta all align)', () => {
    const orig = [cel({ text: 'Web Design', region: 'header' }), cel({ role: 'text', tag: 'p', text: 'Hello world', region: 'body' })];
    const build = [cel({ text: 'Web Design', region: 'header' }), cel({ role: 'text', tag: 'p', text: 'Hello world', region: 'body' })];
    const r = scoreFidelity(side(orig, { position: 'fixed', ripple: 5, modalTriggers: 1 }), side(build, { position: 'sticky', ripple: 3, modalTriggers: 2 }));
    expect(r.pass).toBe(true);
    expect(r.chrome.styleOff).toBe(0);
    expect(r.chrome.metaOff).toBe(0);
  });

  it('FAILS and reports the CHROME diffs the old gate missed (skew + weight)', () => {
    const orig = [cel({ text: 'Web Design', transform: 'matrix(1, 0, -0.466308, 1, 0, 0)', weight: '400' })];
    const build = [cel({ text: 'Web Design', transform: 'matrix(1, 0, -0.267949, 1, 0, 0)', weight: '700' })];
    const r = scoreFidelity(side(orig), side(build));
    expect(r.pass).toBe(false);
    expect(r.chrome.styleOff).toBeGreaterThanOrEqual(2);
    expect(r.diffs.chrome.join(' ')).toMatch(/skew:/);
    expect(r.diffs.chrome.join(' ')).toMatch(/weight:400→700/);
  });

  it('FAILS on missing whole-bar structure (fixed header / ripple / modals)', () => {
    const orig = [cel({ text: 'X', region: 'header' })];
    const build = [cel({ text: 'X', region: 'header' })];
    const r = scoreFidelity(side(orig, { position: 'fixed', ripple: 8, modalTriggers: 3 }), side(build, { position: 'static', ripple: 0, modalTriggers: 0 }));
    expect(r.pass).toBe(false);
    expect(r.chrome.metaOff).toBe(3);
    expect(r.diffs.meta.join(' ')).toMatch(/ripple:MISSING/);
    expect(r.diffs.meta.join(' ')).toMatch(/modals:MISSING/);
    expect(r.diffs.meta.join(' ')).toMatch(/not pinned/);
  });

  it('degrades to a low-coverage FAIL when a side is empty (browser render failed)', () => {
    const r = scoreFidelity(side([cel({ text: 'A', role: 'text', tag: 'p', region: 'body' })]), side([]));
    expect(r.pass).toBe(false);
    expect(r.body.coverage).toBe(0);
  });
});

describe('captureIssue', () => {
  const el = { role: 'text', tag: 'p', text: 'x', region: 'body', x: 0, y: 0, w: 10, h: 10 } as unknown as ChromeEl;

  it('says nothing when the capture worked', () => {
    expect(captureIssue({ items: [el] })).toBeUndefined();
  });

  it('names a FAILED capture rather than letting it read as a 0% score', () => {
    // The whole point: a broken render used to be indistinguishable from a clone that reproduced nothing,
    // and an agent reading `coverage: 0` concluded the tool was useless instead of that it had crashed.
    expect(captureIssue({ items: [], failed: 'Timeout 30000ms exceeded' })).toBe('capture failed: Timeout 30000ms exceeded');
  });

  it('flags an EMPTY capture too — a real page always yields something', () => {
    expect(captureIssue({ items: [] })).toBe('captured, but the page yielded no comparable elements');
  });
});
