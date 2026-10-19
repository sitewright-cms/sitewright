import { describe, it, expect, vi } from 'vitest';
import type { RunnerResult } from 'lighthouse';
import {
  summarize,
  redactOrigin,
  rebaseFindingUrls,
  rebaseMainThread,
  abortable,
  lighthouseRuntimeError,
  toPagespeedRunError,
  scrubRunMessage,
  PagespeedRunError,
  GENERIC_RUN_FAILURE,
  lighthouseFlags,
  runWithDeadline,
  runLighthouseIsolated,
  toPagespeedRunError as toRunError,
  type PagespeedFinding,
} from '../src/render/pagespeed-audit.js';

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

  it('scrubs the origin from a url that CONTAINS it without starting with it', () => {
    const inner: PagespeedFinding[] = [
      { id: 'r', title: 'R', category: 'performance', score: 0, items: [{ url: 'blob:http://127.0.0.1:54321/9f2c' }] },
    ];
    expect(rebaseFindingUrls(inner, 'http://127.0.0.1:54321')[0]?.items?.[0]?.url).toBe('blob:/9f2c');
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

// ---- main-thread attribution ----------------------------------------------------------------------
// Fixture fragments are shaped like Lighthouse 13's own audit output (core/audits/long-tasks.js,
// non-composited-animations.js, insights/forced-reflow-insight.js): long-tasks is an INFORMATIVE table
// of {url, startTime, duration}; non-composited-animations is an INFORMATIVE table of {node, subItems};
// forced-reflow-insight is a SCORED `list` of two tables keyed {source, reflowTime}.

function longTasksAudit(items: unknown[]) {
  return {
    id: 'long-tasks',
    title: 'Avoid long main-thread tasks',
    score: 1, // informative audits are normalised to 1 — never a "failing" finding
    scoreDisplayMode: 'informative',
    displayValue: `${items.length} long tasks found`,
    details: {
      type: 'table',
      headings: [
        { key: 'url', valueType: 'url', label: 'URL' },
        { key: 'startTime', valueType: 'ms', granularity: 1, label: 'Start Time' },
        { key: 'duration', valueType: 'ms', granularity: 1, label: 'Duration' },
      ],
      items,
      sortedBy: ['duration'],
      skipSumming: ['startTime'],
    },
  };
}

function nonCompositedAudit(items: unknown[]) {
  return {
    id: 'non-composited-animations',
    title: 'Avoid non-composited animations',
    score: 1,
    scoreDisplayMode: 'informative',
    displayValue: `${items.length} animated elements found`,
    details: {
      type: 'table',
      headings: [{ key: 'node', valueType: 'node', subItemsHeading: { key: 'failureReason', valueType: 'text' }, label: 'Element' }],
      items,
    },
  };
}

function animatedNode(nodeLabel: string, reasons: Array<{ failureReason: unknown; animation?: string }>) {
  return {
    node: { type: 'node', lhId: 'x', path: '1,HTML', selector: 'section.hero', boundingRect: {}, snippet: '<section class="hero">', nodeLabel },
    subItems: { type: 'subitems', items: reasons },
  };
}

type MutableLhr = {
  categories: Record<string, { score: number | null; auditRefs: Array<{ id: string }> }>;
  audits: Record<string, unknown>;
};

/** A fakeLhr whose performance is POOR because of blocking time, carrying the two diagnostics. */
function poorTbtLhr(opts: { tbtScore?: number; perfScore?: number } = {}): MutableLhr {
  const lhr = fakeLhr() as unknown as MutableLhr;
  lhr.categories.performance!.score = opts.perfScore ?? 0.41;
  lhr.categories.performance!.auditRefs.push({ id: 'long-tasks' }, { id: 'non-composited-animations' });
  lhr.audits['total-blocking-time'] = { id: 'total-blocking-time', numericValue: 790, score: opts.tbtScore ?? 0.37, scoreDisplayMode: 'numeric' };
  lhr.audits['long-tasks'] = longTasksAudit([
    { url: 'http://127.0.0.1:54321/_assets/_sw/shader-bg.js', startTime: 2310.4, duration: 412.6 },
    { url: 'Unattributable', startTime: 1800, duration: 230 },
    { url: 'http://127.0.0.1:54321/', startTime: 950.2, duration: 180.1 },
    { url: 'Browser GC', startTime: 3000, duration: 90 },
    { url: 'https://cdn.example/x.js', startTime: 3100, duration: 70 },
    { url: 'https://cdn.example/y.js', startTime: 3200, duration: 60 },
    { url: 'https://cdn.example/z.js', startTime: 3300, duration: 55 },
  ]);
  lhr.audits['non-composited-animations'] = nonCompositedAudit([
    animatedNode('Welcome to Acme', [
      { failureReason: 'Unsupported CSS Property: background-position', animation: 'sw-pan' },
      { failureReason: 'Unsupported CSS Properties: box-shadow, filter', animation: 'sw-glow' },
    ]),
    animatedNode('Card', [{ failureReason: 'Transform-related property depends on box size' }]),
    animatedNode('Badge', [{ failureReason: 'Custom CSS properties cannot be animated on the compositor: --sw-beam-arc', animation: '' }]),
  ]);
  return lhr;
}

const run = (lhr: unknown) => summarize('http://x/', 'mobile', { lhr } as unknown as RunnerResult);

describe('summarize — main-thread diagnostics', () => {
  it('when blocking time is poor, names the longest tasks (worst first, url vs label, start + duration)', () => {
    const mt = run(poorTbtLhr()).mainThread!;
    expect(mt).toBeDefined();
    expect(mt.longTasks).toEqual([
      { url: 'http://127.0.0.1:54321/_assets/_sw/shader-bg.js', durationMs: 413, startMs: 2310 },
      // Lighthouse's own attribution words are NOT urls — they come back as a label.
      { label: 'Unattributable', durationMs: 230, startMs: 1800 },
      { url: 'http://127.0.0.1:54321/', durationMs: 180, startMs: 950 },
      { label: 'Browser GC', durationMs: 90, startMs: 3000 },
      { url: 'https://cdn.example/x.js', durationMs: 70, startMs: 3100 },
    ]);
    expect(mt.moreLongTasks).toBe(2); // bounded: 7 tasks, 5 shown
  });

  it('names each non-composited animation: element, animation names, animated properties, reasons', () => {
    const mt = run(poorTbtLhr()).mainThread!;
    expect(mt.nonCompositedAnimations).toEqual([
      {
        label: 'Welcome to Acme',
        animations: ['sw-pan', 'sw-glow'],
        properties: ['background-position', 'box-shadow', 'filter'],
        reasons: ['Unsupported CSS Property: background-position', 'Unsupported CSS Properties: box-shadow, filter'],
      },
      { label: 'Card', reasons: ['Transform-related property depends on box size'] },
      {
        label: 'Badge',
        properties: ['--sw-beam-arc'],
        reasons: ['Custom CSS properties cannot be animated on the compositor: --sw-beam-arc'],
      },
    ]);
    expect(mt.moreNonCompositedAnimations).toBeUndefined();
  });

  it('the informative diagnostics never leak into the failing-findings list', () => {
    const ids = run(poorTbtLhr()).findings.map((f) => f.id);
    expect(ids).not.toContain('long-tasks');
    expect(ids).not.toContain('non-composited-animations');
  });

  it('is absent when blocking time AND the performance score are fine (no noise on a healthy page)', () => {
    expect(run(poorTbtLhr({ tbtScore: 0.95, perfScore: 0.92 })).mainThread).toBeUndefined();
  });

  it('a poor performance score alone is enough to include it', () => {
    expect(run(poorTbtLhr({ tbtScore: 0.95, perfScore: 0.3 })).mainThread?.longTasks.length).toBeGreaterThan(0);
  });

  it('is absent when the page is poor but Lighthouse found neither long tasks nor animations', () => {
    const lhr = poorTbtLhr();
    lhr.audits['long-tasks'] = { id: 'long-tasks', title: 'x', score: 1, scoreDisplayMode: 'notApplicable' };
    delete lhr.audits['non-composited-animations'];
    expect(run(lhr).mainThread).toBeUndefined();
  });

  it("bounds an element's reasons/names/properties and the number of elements, and drops junk rows", () => {
    const lhr = poorTbtLhr();
    const manyReasons = Array.from({ length: 9 }, (_v, i) => ({
      failureReason: `Unsupported CSS Properties: p${i}a, p${i}b`,
      animation: `anim-${i}`,
    }));
    lhr.audits['non-composited-animations'] = nonCompositedAudit([
      animatedNode('Big', manyReasons),
      ...Array.from({ length: 7 }, (_v, i) => animatedNode(`El ${i}`, [{ failureReason: 'Effect has unsupported timing parameters' }])),
      { node: { type: 'node', nodeLabel: 'No reasons' }, subItems: { type: 'subitems', items: [] } }, // nothing to say → dropped
      'not-an-object',
    ]);
    lhr.audits['long-tasks'] = longTasksAudit([{ url: 'https://a.test/a.js', duration: 'NaN' }, { startTime: 5, duration: 99 }, null]);
    const mt = run(lhr).mainThread!;
    const big = mt.nonCompositedAnimations[0]!;
    expect(big.reasons).toHaveLength(4);
    expect(big.animations).toHaveLength(4);
    expect(big.properties).toHaveLength(8);
    expect(mt.nonCompositedAnimations).toHaveLength(5);
    expect(mt.moreNonCompositedAnimations).toBe(3);
    // A task with no duration is not a task; one with no url at all is still a (labelled) task.
    expect(mt.longTasks).toEqual([{ label: 'Unattributed', durationMs: 99, startMs: 5 }]);
    expect(mt.moreLongTasks).toBeUndefined();
  });

  it('a nameless animated element still reports its reasons; a non-string reason is ignored', () => {
    const lhr = poorTbtLhr();
    lhr.audits['non-composited-animations'] = nonCompositedAudit([
      { node: { type: 'node' }, subItems: { type: 'subitems', items: [{ failureReason: 'Filter-related property may move pixels' }, { failureReason: 42 }] } },
    ]);
    expect(run(lhr).mainThread!.nonCompositedAnimations).toEqual([{ reasons: ['Filter-related property may move pixels'] }]);
  });
});

describe('summarize — `list` details (forced-reflow-insight)', () => {
  const carousel = { type: 'source-location', url: 'http://127.0.0.1:54321/_assets/_sw/carousel.js', urlProvider: 'network', line: 40, column: 2 };
  function reflowLhr(): MutableLhr {
    const lhr = fakeLhr() as unknown as MutableLhr;
    lhr.categories.performance!.auditRefs.push({ id: 'forced-reflow-insight' });
    lhr.audits['forced-reflow-insight'] = {
      id: 'forced-reflow-insight',
      title: 'Forced reflow',
      score: 0,
      scoreDisplayMode: 'metricSavings',
      details: {
        type: 'list',
        items: [
          // Top time-consuming function call.
          {
            type: 'table',
            headings: [
              { key: 'source', valueType: 'source-location', label: 'Top function call' },
              { key: 'reflowTime', valueType: 'ms', label: 'Total reflow time' },
            ],
            items: [{ source: carousel, reflowTime: 61.5 }],
          },
          // Bottom-up: the same location again, an unattributed bucket, and a smaller one.
          {
            type: 'table',
            headings: [
              { key: 'source', valueType: 'source-location', label: 'Source' },
              { key: 'reflowTime', valueType: 'ms', label: 'Total reflow time' },
            ],
            items: [
              { source: carousel, reflowTime: 61.5 },
              { source: { type: 'text', value: 'Unattributed' }, reflowTime: 12 },
              // Two nameless rows are two rows — only a named place is merged.
              { reflowTime: 3 },
              { reflowTime: 2 },
              { source: { type: 'source-location', url: 'http://127.0.0.1:54321/_assets/app.js', urlProvider: 'network', line: 9, column: 0 }, reflowTime: 30 },
            ],
          },
          { type: 'list-section', title: 'wrapped', value: { type: 'table', headings: [], items: [{ source: { type: 'text', value: 'Wrapped' }, reflowTime: 1 }] } },
          { type: 'node', nodeLabel: 'not a table — ignored' },
        ],
      },
    };
    return lhr;
  }

  it('flattens the sub-tables into one worst-first item list: source location + reflow time', () => {
    const f = run(reflowLhr()).findings.find((x) => x.id === 'forced-reflow-insight')!;
    expect(f.items).toEqual([
      // The top-function row and its bottom-up twin are ONE location — reported once.
      { url: 'http://127.0.0.1:54321/_assets/_sw/carousel.js:41', wastedMs: 61.5 },
      { url: 'http://127.0.0.1:54321/_assets/app.js:10', wastedMs: 30 },
      { label: 'Unattributed', wastedMs: 12 }, // a typed `text` cell is a label
      { wastedMs: 3 },
      { wastedMs: 2 },
      { label: 'Wrapped', wastedMs: 1 }, // a list-section is unwrapped
    ]);
  });

  it('a list with no table inside yields no items (and does not throw)', () => {
    const lhr = reflowLhr();
    (lhr.audits['forced-reflow-insight'] as { details: unknown }).details = { type: 'list', items: [{ type: 'node' }, null] };
    expect(run(lhr).findings.find((x) => x.id === 'forced-reflow-insight')!.items).toBeUndefined();
  });
});

describe('rebaseMainThread', () => {
  const origin = 'http://127.0.0.1:54321';
  it('strips the loopback origin from task urls and scrubs it from every label/reason', () => {
    const out = rebaseMainThread(
      {
        longTasks: [
          { url: 'http://127.0.0.1:54321/_assets/a.js', durationMs: 100 },
          { url: 'http://127.0.0.1:54321', durationMs: 90 },
          { url: 'https://cdn.example/b.js', durationMs: 80 },
          { label: 'see http://127.0.0.1:54321/x', durationMs: 70 },
          // The origin INSIDE a url (a blob: or a redirect parameter) is scrubbed too, not only a prefix.
          { url: 'blob:http://127.0.0.1:54321/9f2c', durationMs: 60 },
          { url: 'https://cdn.example/r?to=http://127.0.0.1:54321/a', durationMs: 50 },
        ],
        nonCompositedAnimations: [
          { label: '<div style="background:url(http://127.0.0.1:54321/i.png)">', reasons: ['r http://127.0.0.1:54321/z'], properties: ['filter'] },
          { label: 'clean', reasons: ['clean'] },
          { reasons: ['nameless http://127.0.0.1:54321/q'] },
        ],
        moreLongTasks: 2,
      },
      origin,
    );
    expect(out!.longTasks).toEqual([
      { url: '/_assets/a.js', durationMs: 100 },
      { url: '/', durationMs: 90 },
      { url: 'https://cdn.example/b.js', durationMs: 80 },
      { label: 'see /x', durationMs: 70 },
      { url: 'blob:/9f2c', durationMs: 60 },
      { url: 'https://cdn.example/r?to=/a', durationMs: 50 },
    ]);
    expect(out!.nonCompositedAnimations[0]).toEqual({ label: '<div style="background:url(/i.png)">', reasons: ['r /z'], properties: ['filter'] });
    expect(out!.nonCompositedAnimations[1]).toEqual({ label: 'clean', reasons: ['clean'] });
    expect(out!.nonCompositedAnimations[2]).toEqual({ reasons: ['nameless /q'] });
    expect(out!.moreLongTasks).toBe(2);
    expect(JSON.stringify(out)).not.toContain('127.0.0.1');
  });

  it('passes undefined through, and is a no-op for an empty origin', () => {
    expect(rebaseMainThread(undefined, origin)).toBeUndefined();
    const mt = { longTasks: [{ url: 'http://127.0.0.1:54321/a', durationMs: 1 }], nonCompositedAnimations: [] };
    expect(rebaseMainThread(mt, '')).toEqual(mt);
  });
});

// ---- failure plumbing ----------------------------------------------------------------------------

describe('abortable', () => {
  it('passes the work through untouched when there is no signal', async () => {
    await expect(abortable(Promise.resolve(7), undefined, () => {})).resolves.toBe(7);
  });

  it('settles with the work when it finishes first, and a later abort does nothing', async () => {
    const ac = new AbortController();
    const onAbort = vi.fn();
    await expect(abortable(Promise.resolve('done'), ac.signal, onAbort)).resolves.toBe('done');
    ac.abort();
    expect(onAbort).not.toHaveBeenCalled();
  });

  it('passes a work failure through', async () => {
    const ac = new AbortController();
    await expect(abortable(Promise.reject(new Error('lighthouse blew up')), ac.signal, () => {})).rejects.toThrow('lighthouse blew up');
  });

  it('on abort: runs the teardown (kill Chrome) once and rejects at once with the abort reason', async () => {
    const ac = new AbortController();
    const onAbort = vi.fn();
    let failWork!: (e: Error) => void;
    const work = new Promise<string>((_r, rej) => (failWork = rej));
    const p = abortable(work, ac.signal, onAbort);
    ac.abort(new Error('client went away'));
    await expect(p).rejects.toThrow('client went away');
    expect(onAbort).toHaveBeenCalledTimes(1);
    // The work then dies BECAUSE Chrome was killed — that late rejection must not surface as unhandled.
    failWork(new Error('Protocol error: Target closed'));
    await new Promise((r) => setTimeout(r, 0));
  });

  it('an already-aborted signal tears down and rejects without waiting on the work', async () => {
    const ac = new AbortController();
    ac.abort(new Error('gone'));
    const onAbort = vi.fn();
    await expect(abortable(new Promise(() => {}), ac.signal, onAbort)).rejects.toThrow('gone');
    expect(onAbort).toHaveBeenCalledTimes(1);
  });
});

describe('Lighthouse failures → PagespeedRunError', () => {
  it('a result with a fatal runtimeError becomes a typed error carrying its code + message', () => {
    const err = lighthouseRuntimeError({
      lhr: { runtimeError: { code: 'NO_FCP', message: 'The page did not paint any content.', errorStack: 'at secret/path.js:1' } },
    } as unknown as RunnerResult);
    expect(err).toBeInstanceOf(PagespeedRunError);
    expect(err!.code).toBe('NO_FCP');
    expect(err!.message).toBe('The page did not paint any content.');
    expect(err!.message).not.toContain('secret'); // the stack is never carried
  });

  it('a usable result is not an error; a missing result is', () => {
    expect(lighthouseRuntimeError({ lhr: fakeLhr() } as unknown as RunnerResult)).toBeNull();
    expect(lighthouseRuntimeError(undefined)!.code).toBe('NO_RESULT');
  });

  it('a runtimeError without a message still says which code failed', () => {
    const err = lighthouseRuntimeError({ lhr: { runtimeError: { code: 'PAGE_HUNG' } } } as unknown as RunnerResult)!;
    expect(err.code).toBe('PAGE_HUNG');
    expect(err.message).toMatch(/PAGE_HUNG/);
  });

  it('a thrown LighthouseError keeps its code and friendly message (string or ICU form)', () => {
    const plain = toPagespeedRunError(
      Object.assign(new Error('PROTOCOL_TIMEOUT'), {
        code: 'PROTOCOL_TIMEOUT',
        friendlyMessage: 'Waiting for DevTools protocol response has exceeded the allotted time.',
      }),
    );
    expect(plain.code).toBe('PROTOCOL_TIMEOUT');
    expect(plain.message).toMatch(/allotted time/);
    const icu = toPagespeedRunError(
      Object.assign(new Error('PAGE_HUNG'), {
        code: 'PAGE_HUNG',
        friendlyMessage: { i18nId: 'x', formattedDefault: 'Lighthouse was unable to reliably load the URL because the page stopped responding.' },
      }),
    );
    expect(icu.code).toBe('PAGE_HUNG');
    expect(icu.message).toMatch(/stopped responding/);
  });

  it('ANY other thrown error gets a FIXED sentence — its own text names internals and never reaches the client', () => {
    // A Chrome crash and a Node fs error, verbatim: a debug port, a temp path, a Node error code.
    const crashes = [
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:41873'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error("ENOENT: no such file or directory, open '/tmp/lighthouse.Xa9/trace.json'"), { code: 'ENOENT' }),
      new Error('Protocol error (Page.navigate): Target closed'),
      'weird',
    ];
    for (const crash of crashes) {
      const err = toPagespeedRunError(crash, 'http://127.0.0.1:54321');
      expect(err.code).toBe('LIGHTHOUSE_FAILED');
      expect(err.message).toBe(GENERIC_RUN_FAILURE);
      for (const leak of ['127.0.0.1', '/tmp', 'ECONNREFUSED', 'ENOENT', 'Target closed']) {
        expect(err.message, leak).not.toContain(leak);
      }
      // The detail is kept for the SERVER log, not the response.
      expect(err.cause).toBe(crash);
    }
  });

  it('an existing PagespeedRunError is passed through untouched', () => {
    const existing = new PagespeedRunError('NO_FCP', 'x');
    expect(toPagespeedRunError(existing)).toBe(existing);
  });

  it('bounds the code and the message (both reach the client)', () => {
    const err = toPagespeedRunError(
      Object.assign(new Error('x'), { code: 'lower-case and spaces!'.repeat(10), friendlyMessage: 'y'.repeat(5000) }),
    );
    expect(err.code).toMatch(/^[A-Z0-9_]{1,64}$/);
    expect(err.message.length).toBeLessThanOrEqual(400);
  });
});

describe('what IS passed through is scrubbed of internals', () => {
  const origin = 'http://127.0.0.1:54321';

  it('the served origin leaves a site path; any other loopback host:port is removed', () => {
    const err = toPagespeedRunError(
      Object.assign(new Error('PAGE_HUNG'), {
        code: 'PAGE_HUNG',
        friendlyMessage:
          'Navigating http://127.0.0.1:54321/about/ hung; DevTools at 127.0.0.1:9222, ws://localhost:41000/devtools and [::1]:8080 stopped answering.',
      }),
      origin,
    );
    expect(err.message).toContain('/about/'); // the page the author asked about stays readable
    for (const leak of ['127.0.0.1', '9222', 'localhost', '41000', '[::1]', '8080']) {
      expect(err.message, leak).not.toContain(leak);
    }
  });

  it('absolute filesystem paths (and file: URLs) are removed; a site path inside a URL is not', () => {
    const err = lighthouseRuntimeError(
      {
        lhr: {
          runtimeError: {
            code: 'ERRORED_DOCUMENT_REQUEST',
            message:
              "Could not read /tmp/sw-pagespeed-Ab12/index.html (see file:///home/app/dist/x.js or C:\\Users\\app\\x.js) for http://127.0.0.1:54321/shop/cart/.",
          },
        },
      } as unknown as RunnerResult,
      origin,
    )!;
    expect(err.message).toContain('/shop/cart/');
    for (const leak of ['/tmp', 'sw-pagespeed', 'file:', '/home/app', 'C:\\', 'Users']) {
      expect(err.message, leak).not.toContain(leak);
    }
  });

  it('scrubs BEFORE the length cap, so an origin straddling the cut leaves no fragment', () => {
    // 395 characters, then the loopback origin: a cap first would keep "http://127.0" and the scrub
    // after it would no longer recognise the cut-off origin.
    const filler = 'x'.repeat(395);
    for (const o of [origin, '']) {
      const err = lighthouseRuntimeError(
        { lhr: { runtimeError: { code: 'NO_FCP', message: `${filler} http://127.0.0.1:54321/deep/page/` } } } as unknown as RunnerResult,
        o,
      )!;
      expect(err.message.length).toBeLessThanOrEqual(400);
      expect(err.message).not.toMatch(/127\.0|127\.|:5432/);
    }
  });

  it('scrubRunMessage leaves an ordinary sentence alone', () => {
    expect(scrubRunMessage('The page did not paint any content.', origin)).toBe('The page did not paint any content.');
  });
});

describe('lighthouseFlags', () => {
  it('★ never collects the full-page screenshot — on both devices', () => {
    // MEASURED on a 13,000px page: with it, desktop Chrome peaked at 557-652MB (Lighthouse resizes the
    // emulated viewport to the whole page and rasterises it at 1350px wide); without, 334-371MB. That
    // gap is what OOM-killed a 768MB container on every desktop / both-devices audit. Nothing we report
    // reads that screenshot.
    for (const ff of ['mobile', 'desktop'] as const) expect(lighthouseFlags(ff, 9222).disableFullPageScreenshot, ff).toBe(true);
  });

  it('desktop gets the desktop throttling preset and screen; mobile keeps Lighthouse\'s mobile defaults', () => {
    const desktop = lighthouseFlags('desktop', 9222);
    expect(desktop).toMatchObject({ port: 9222, formFactor: 'desktop', screenEmulation: { mobile: false, width: 1350 } });
    expect(desktop.throttling).toMatchObject({ cpuSlowdownMultiplier: 1 });
    const mobile = lighthouseFlags('mobile', 9222);
    expect(mobile).toMatchObject({ formFactor: 'mobile', screenEmulation: { mobile: true, width: 412 } });
    expect(mobile.throttling).toBeUndefined();
    expect(mobile.onlyCategories).toEqual(['performance', 'accessibility', 'best-practices', 'seo']);
  });
});

describe('PagespeedRunError — retryable, and what a crash means', () => {
  it('marks a BROWSER failure retryable and a PAGE verdict not', () => {
    for (const code of ['TARGET_CRASHED', 'LIGHTHOUSE_FAILED', 'PROTOCOL_TIMEOUT', 'TIMEOUT', 'NO_RESULT']) {
      expect(new PagespeedRunError(code, 'x').retryable, code).toBe(true);
    }
    for (const code of ['NO_FCP', 'PAGE_HUNG', 'NOT_HTML', 'ERRORED_DOCUMENT_REQUEST']) {
      expect(new PagespeedRunError(code, 'x').retryable, code).toBe(false);
    }
  });

  it('a crashed tab says what that almost always is here, and what to do', () => {
    const err = lighthouseRuntimeError({ lhr: { runtimeError: { code: 'TARGET_CRASHED', message: 'Browser tab has unexpectedly crashed.' } } } as unknown as RunnerResult)!;
    expect(err.message).toMatch(/^Browser tab has unexpectedly crashed\. /);
    expect(err.message).toMatch(/memory/);
    expect(err.message).toMatch(/one device at a time/);
  });
});

describe('runWithDeadline', () => {
  it('passes a result through, and the run sees a signal that is not aborted', async () => {
    const outer = new AbortController();
    await expect(runWithDeadline(1_000, outer.signal, async (s) => (s.aborted ? 'aborted' : 'ok'))).resolves.toBe('ok');
  });

  it('★ at the deadline it aborts the run and reports a retryable TIMEOUT — not "the client left"', async () => {
    let seen: AbortSignal | undefined;
    const run = (s: AbortSignal) =>
      new Promise<never>((_r, reject) => {
        seen = s;
        s.addEventListener('abort', () => reject(new Error('chrome killed')), { once: true });
      });
    const err = await runWithDeadline(20, new AbortController().signal, run).catch((e: unknown) => e);
    expect(seen!.aborted).toBe(true);
    expect(err).toBeInstanceOf(PagespeedRunError);
    expect((err as PagespeedRunError).code).toBe('TIMEOUT');
    expect((err as PagespeedRunError).retryable).toBe(true);
    expect((err as Error).message).toMatch(/did not finish auditing this page within 0s/);
  });

  it('the CALLER leaving is passed through as it is (the route answers nobody)', async () => {
    const outer = new AbortController();
    const p = runWithDeadline(60_000, outer.signal, (s) => new Promise((_r, reject) => s.addEventListener('abort', () => reject(s.reason as Error), { once: true })));
    outer.abort(new Error('client gone'));
    await expect(p).rejects.toThrow('client gone');
  });

  it('a run that fails on its own is not dressed up as a timeout', async () => {
    await expect(runWithDeadline(60_000, new AbortController().signal, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});

describe('runLighthouseIsolated — Lighthouse in its own heap', () => {
  // The worker imports this stand-in instead of the real module; `mode` picks what it does.
  const fake = new URL('./fixtures/fake-lighthouse.mjs', import.meta.url).href;
  const flags = (mode: string) => ({ mode, formFactor: 'mobile' }) as unknown as Parameters<typeof runLighthouseIsolated>[1];

  it('returns the result Lighthouse produced in the worker', async () => {
    const r = await runLighthouseIsolated('http://127.0.0.1:1/', flags('result'), { moduleUrl: fake });
    expect(r?.lhr).toMatchObject({ requestedUrl: 'http://127.0.0.1:1/', formFactor: 'mobile', categories: { seo: { score: 1 } } });
  });

  it('Lighthouse\'s console output is drained and dropped — it never reaches the server log', async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      const r = await runLighthouseIsolated('http://x/', flags('chatty'), { moduleUrl: fake });
      expect(r?.lhr).toMatchObject({ chatty: true });
    } finally {
      spy.mockRestore();
    }
    expect(writes.join('')).not.toContain('lighthouse chatter');
  });

  it('no result is passed on as none (the caller reports NO_RESULT)', async () => {
    expect(await runLighthouseIsolated('http://x/', flags('empty'), { moduleUrl: fake })).toBeUndefined();
  });

  it('a Lighthouse error keeps its code and friendly sentence across the thread boundary', async () => {
    const err = await runLighthouseIsolated('http://x/', flags('lighthouse-error'), { moduleUrl: fake }).catch((e: unknown) => e);
    const run = toRunError(err);
    expect(run.code).toBe('NO_FCP');
    expect(run.message).toBe('The page did not paint any content.');
  });

  it('any other failure stays generic (its text names internals)', async () => {
    const err = await runLighthouseIsolated('http://x/', flags('crash'), { moduleUrl: fake }).catch((e: unknown) => e);
    expect(toRunError(err).code).toBe('LIGHTHOUSE_FAILED');
  });

  it('★ a run that outgrows its heap fails ALONE — the server keeps running and says what happened', async () => {
    // THE BUG: Lighthouse ran in the API's own heap (+100-240MB per run, measured), and the shared
    // instance died with "JavaScript heap out of memory" mid-audit — taking every request with it.
    const err = await runLighthouseIsolated('http://x/', flags('heap'), { moduleUrl: fake, heapMb: 32 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PagespeedRunError);
    expect((err as PagespeedRunError).code).toBe('OUT_OF_MEMORY');
    expect((err as PagespeedRunError).retryable).toBe(false);
    expect((err as Error).message).toMatch(/32MB/);
    expect((err as Error).message).toMatch(/server is unaffected/);
  }, 30_000);

  it('an abort stops the worker and runs the teardown (kill Chrome) at once', async () => {
    const ac = new AbortController();
    const onAbort = vi.fn();
    const p = runLighthouseIsolated('http://x/', flags('hang'), { moduleUrl: fake, signal: ac.signal, onAbort });
    setTimeout(() => ac.abort(new Error('client gone')), 50);
    await expect(p).rejects.toThrow('client gone');
    expect(onAbort).toHaveBeenCalledOnce();
  });
});
