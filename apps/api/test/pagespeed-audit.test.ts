import { describe, it, expect } from 'vitest';
import type { RunnerResult } from 'lighthouse';
import { summarize } from '../src/render/pagespeed-audit.js';

/**
 * Pure reduction of a Lighthouse result → our compact score/metrics/findings shape. The browser-driven
 * `runPagespeedAudit` is v8-ignored (it spawns Chrome); this tests the logic that shapes its output.
 */

function fakeLhr() {
  return {
    lighthouseVersion: '13.4.0',
    fetchTime: '2026-07-18T21:00:00.000Z',
    categories: {
      performance: { score: 0.73, auditRefs: [{ id: 'render-blocking' }, { id: 'lcp-info' }] },
      accessibility: { score: 0.95, auditRefs: [{ id: 'color-contrast' }] },
      'best-practices': { score: 1, auditRefs: [] },
      seo: { score: 1, auditRefs: [{ id: 'meta-description' }] },
    },
    audits: {
      'render-blocking': {
        id: 'render-blocking',
        title: 'Eliminate render-blocking resources',
        score: 0.2,
        scoreDisplayMode: 'numeric',
        displayValue: 'Est savings of 750 ms',
        description: 'Resources are blocking the first paint of your page. [Learn more](https://x.test).',
      },
      'lcp-info': {
        id: 'lcp-info',
        title: 'Largest Contentful Paint element',
        score: null,
        scoreDisplayMode: 'informative',
        numericValue: 5427,
      },
      'color-contrast': {
        id: 'color-contrast',
        title: 'Background and foreground colors do not have a sufficient contrast ratio.',
        score: 0,
        scoreDisplayMode: 'binary',
      },
      'meta-description': {
        id: 'meta-description',
        title: 'Document has a meta description',
        score: 1,
        scoreDisplayMode: 'binary',
      },
      'first-contentful-paint': { numericValue: 3304 },
      'largest-contentful-paint': { numericValue: 5427 },
      'total-blocking-time': { numericValue: 0 },
      'cumulative-layout-shift': { numericValue: 0.05 },
      'speed-index': { numericValue: 3000 },
    },
  };
}

describe('summarize', () => {
  const r = summarize('http://127.0.0.1/', 'mobile', { lhr: fakeLhr() } as unknown as RunnerResult);

  it('maps 0–1 category scores to 0–100 (rounded)', () => {
    expect(r.scores).toEqual({ performance: 73, accessibility: 95, bestPractices: 100, seo: 100 });
  });

  it('extracts the core lab metrics', () => {
    expect(r.metrics.firstContentfulPaintMs).toBe(3304);
    expect(r.metrics.largestContentfulPaintMs).toBe(5427);
    expect(r.metrics.cumulativeLayoutShift).toBe(0.05);
    expect(r.metrics.speedIndexMs).toBe(3000);
  });

  it('lists only actionable failing audits, worst-first', () => {
    const ids = r.findings.map((f) => f.id);
    expect(ids).toContain('render-blocking');
    expect(ids).toContain('color-contrast');
    expect(ids).not.toContain('lcp-info'); // informative → excluded
    expect(ids).not.toContain('meta-description'); // passing (score 1) → excluded
    expect(r.findings[0]?.id).toBe('color-contrast'); // score 0 sorts before 0.2
    expect(r.findings.find((f) => f.id === 'render-blocking')?.category).toBe('performance');
    expect(r.findings.find((f) => f.id === 'render-blocking')?.displayValue).toBe('Est savings of 750 ms');
    // The audit description (actionable advice) is surfaced for the finding's tooltip.
    expect(r.findings.find((f) => f.id === 'render-blocking')?.description).toContain('blocking the first paint');
  });

  it('carries the version, timestamp, url and form factor through', () => {
    expect(r.lighthouseVersion).toBe('13.4.0');
    expect(r.fetchedAt).toBe('2026-07-18T21:00:00.000Z');
    expect(r.url).toBe('http://127.0.0.1/');
    expect(r.formFactor).toBe('mobile');
  });

  it('reports a null score for a category Lighthouse could not compute', () => {
    const lhr = fakeLhr();
    (lhr.categories.performance as { score: number | null }).score = null;
    const out = summarize('http://x/', 'desktop', { lhr } as unknown as RunnerResult);
    expect(out.scores.performance).toBeNull();
  });
});
