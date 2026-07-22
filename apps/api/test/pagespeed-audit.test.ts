import { describe, it, expect } from 'vitest';
import type { RunnerResult } from 'lighthouse';
import { summarize, redactOrigin, rebaseFindingUrls, type PagespeedFinding } from '../src/render/pagespeed-audit.js';

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
        details: {
          type: 'opportunity',
          overallSavingsMs: 750,
          overallSavingsBytes: 120000,
          headings: [{ key: 'url', valueType: 'url', label: 'URL' }],
          items: [
            { url: 'http://127.0.0.1:54321/_assets/a.css', totalBytes: 40000, wastedBytes: 30000, wastedMs: 300 },
            { url: 'http://127.0.0.1:54321/_assets/b.js', totalBytes: 90000, wastedBytes: 90000, wastedMs: 450 },
            { url: 'https://fonts.example/x.woff2', totalBytes: 20000, wastedBytes: 5000, wastedMs: 50 },
          ],
        },
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
        details: {
          type: 'table',
          headings: [{ key: 'node', valueType: 'node', label: 'Failing Elements' }],
          items: [{ node: { type: 'node', nodeLabel: 'Read more', snippet: '<a class="cta">Read more</a>' } }],
        },
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

  it('omits run warnings + benchmark index when Lighthouse reported none', () => {
    expect(r.runWarnings).toBeUndefined();
    expect(r.benchmarkIndex).toBeUndefined();
  });

  it('surfaces run warnings (dropping empty/non-string entries) and the host benchmark index', () => {
    const lhr = fakeLhr() as Record<string, unknown>;
    lhr.runWarnings = ['The tested device appears to have a slower CPU than Lighthouse expects.', '', 42];
    lhr.environment = { benchmarkIndex: 512 };
    const out = summarize('http://x/', 'mobile', { lhr } as unknown as RunnerResult);
    expect(out.runWarnings).toEqual(['The tested device appears to have a slower CPU than Lighthouse expects.']);
    expect(out.benchmarkIndex).toBe(512);
  });
});

describe('summarize — concrete finding detail', () => {
  const r = summarize('http://127.0.0.1/', 'mobile', { lhr: fakeLhr() } as unknown as RunnerResult);
  const rb = r.findings.find((f) => f.id === 'render-blocking')!;
  const cc = r.findings.find((f) => f.id === 'color-contrast')!;

  it('pulls overall savings (ms + bytes) off an opportunity audit', () => {
    expect(rb.overallSavingsMs).toBe(750);
    expect(rb.overallSavingsBytes).toBe(120000);
  });

  it('lists the concrete resources worst-first (biggest byte saving first)', () => {
    expect(rb.items?.map((it) => it.url)).toEqual([
      'http://127.0.0.1:54321/_assets/b.js', // wastedBytes 90000
      'http://127.0.0.1:54321/_assets/a.css', // 30000
      'https://fonts.example/x.woff2', // 5000
    ]);
    expect(rb.items?.[0]).toMatchObject({ totalBytes: 90000, wastedBytes: 90000, wastedMs: 450 });
  });

  it('reads a DOM node label off a table audit (accessibility)', () => {
    expect(cc.items).toEqual([{ label: 'Read more' }]);
  });

  it('caps items and reports the overflow count', () => {
    const lhr = fakeLhr() as { audits: Record<string, unknown> };
    (lhr.audits['render-blocking'] as { details: { items: unknown[] } }).details.items = Array.from(
      { length: 10 },
      (_v, i) => ({ url: `http://h/a${i}.js`, wastedBytes: 1000 - i }),
    );
    const out = summarize('http://x/', 'mobile', { lhr } as unknown as RunnerResult);
    const f = out.findings.find((x) => x.id === 'render-blocking')!;
    expect(f.items).toHaveLength(6);
    expect(f.moreItems).toBe(4);
  });

  it('derives an identifier from each typed cell shape (source-location / url / link / code / label)', () => {
    const lhr = fakeLhr() as { audits: Record<string, unknown> };
    (lhr.audits['render-blocking'] as { details: unknown }).details = {
      type: 'table',
      headings: [{ key: 'thing', valueType: 'text', label: 'Thing' }],
      items: [
        { src: { type: 'source-location', url: 'http://127.0.0.1:54321/_assets/app.js', line: 41 } },
        { ref: { type: 'url', value: 'https://ext.test/z.css' } },
        { ref: { type: 'link', text: 'Privacy', url: 'https://ext.test/privacy' } },
        { snip: { type: 'code', value: '<img src=x width=0>' } },
        { statistic: 'Maximum DOM depth' },
        { irrelevant: 'no id, no numbers' }, // nothing to show → dropped
      ],
    };
    const out = summarize('http://x/', 'mobile', { lhr } as unknown as RunnerResult);
    const f = out.findings.find((x) => x.id === 'render-blocking')!;
    expect(f.items).toEqual([
      { url: 'http://127.0.0.1:54321/_assets/app.js:42' }, // line is 0-indexed → +1
      { url: 'https://ext.test/z.css' },
      { url: 'https://ext.test/privacy', label: 'Privacy' },
      { label: '<img src=x width=0>' },
      { label: 'Maximum DOM depth' },
    ]);
  });

  it('reads groupLabel + non-byte-efficiency numeric fields (mainthread / bootup diagnostics)', () => {
    const lhr = fakeLhr() as { audits: Record<string, unknown> };
    (lhr.audits['render-blocking'] as { details: unknown }).details = {
      type: 'table',
      headings: [],
      items: [
        { groupLabel: 'Script Evaluation', duration: 850.4 }, // mainthread-work-breakdown shape
        { url: 'http://127.0.0.1:54321/_assets/app.js', total: 1200, scripting: 900 }, // bootup-time shape
        { url: 'https://cdn.test/x.png', transferSize: 45000 }, // network-request shape
      ],
    };
    const out = summarize('http://x/', 'mobile', { lhr } as unknown as RunnerResult);
    const f = out.findings.find((x) => x.id === 'render-blocking')!;
    expect(f.items).toEqual([
      { url: 'http://127.0.0.1:54321/_assets/app.js', wastedMs: 1200 }, // `total` → wastedMs
      { label: 'Script Evaluation', wastedMs: 850.4 }, // groupLabel + `duration` → wastedMs
      { url: 'https://cdn.test/x.png', totalBytes: 45000 }, // `transferSize` → totalBytes
    ]);
  });

  it('omits detail fields for an audit with no details table', () => {
    // meta-description passes so it's filtered out; use a fresh failing binary audit with no details.
    const lhr = fakeLhr() as { categories: Record<string, { auditRefs: { id: string }[] }>; audits: Record<string, unknown> };
    lhr.categories.seo!.auditRefs = [{ id: 'plain-fail' }];
    lhr.audits['plain-fail'] = { id: 'plain-fail', title: 'Plain fail', score: 0, scoreDisplayMode: 'binary' };
    const out = summarize('http://x/', 'mobile', { lhr } as unknown as RunnerResult);
    const f = out.findings.find((x) => x.id === 'plain-fail')!;
    expect(f.items).toBeUndefined();
    expect(f.overallSavingsMs).toBeUndefined();
    expect(f.moreItems).toBeUndefined();
  });
});

describe('rebaseFindingUrls', () => {
  const findings: PagespeedFinding[] = [
    {
      id: 'a',
      title: 'A',
      category: 'performance',
      score: 0.1,
      items: [
        { url: 'http://127.0.0.1:54321/_assets/x.css', wastedBytes: 100 },
        { url: 'https://cdn.example/y.js', wastedBytes: 50 },
        { label: 'a node' },
      ],
    },
    { id: 'b', title: 'B', category: 'seo', score: 0 }, // no items
  ];

  it('strips the loopback origin from same-site item URLs, leaving third-party + labels intact', () => {
    const out = rebaseFindingUrls(findings, 'http://127.0.0.1:54321');
    expect(out[0]?.items).toEqual([
      { url: '/_assets/x.css', wastedBytes: 100 },
      { url: 'https://cdn.example/y.js', wastedBytes: 50 },
      { label: 'a node' },
    ]);
  });

  it('returns the same finding reference when it has no matching item URL (no needless copy)', () => {
    const out = rebaseFindingUrls(findings, 'http://127.0.0.1:54321');
    expect(out[1]).toBe(findings[1]); // untouched finding kept by reference
  });

  it('is a no-op for an empty origin', () => {
    const out = rebaseFindingUrls(findings, '');
    expect(out).toEqual(findings);
  });

  it('also scrubs the loopback origin out of an item label (defense-in-depth)', () => {
    const withLabel: PagespeedFinding[] = [
      { id: 'csp', title: 'CSP', category: 'bestPractices', score: 0, items: [{ label: 'allows http://127.0.0.1:54321/x and http://127.0.0.1:54321/y' }] },
    ];
    const out = rebaseFindingUrls(withLabel, 'http://127.0.0.1:54321');
    expect(out[0]?.items?.[0]?.label).toBe('allows /x and /y'); // every occurrence removed
  });
});

describe('redactOrigin', () => {
  it('strips the internal loopback origin from run-warnings (never leak the ephemeral host:port)', () => {
    expect(
      redactOrigin(['test URL (http://127.0.0.1:54321/about/) was redirected to http://127.0.0.1:54321/x/'], 'http://127.0.0.1:54321'),
    ).toEqual(['test URL (/about/) was redirected to /x/']);
  });

  it('passes a warning through unchanged when it contains no loopback origin', () => {
    expect(redactOrigin(['slower CPU than expected'], 'http://127.0.0.1:9')).toEqual(['slower CPU than expected']);
  });

  it('returns undefined for undefined input, and is a no-op for an empty origin', () => {
    expect(redactOrigin(undefined, 'http://127.0.0.1:9')).toBeUndefined();
    expect(redactOrigin(['x'], '')).toEqual(['x']);
  });
});
