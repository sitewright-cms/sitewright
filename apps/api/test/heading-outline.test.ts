import { describe, it, expect } from 'vitest';
import { extractHeadings, analyzeHeadingOutline } from '../src/render/heading-outline.js';

/** Pure parse + analysis of a page's h1–h6 structure for the SEO audit. */

describe('extractHeadings', () => {
  it('reads h1–h6 in document order, stripping inner tags and collapsing whitespace', () => {
    const html = `
      <h1>Welcome <span class="accent">home</span></h1>
      <h2>  Our   services </h2>
      <h3><a href="/x">Design</a></h3>
    `;
    expect(extractHeadings(html)).toEqual([
      { level: 1, text: 'Welcome home' },
      { level: 2, text: 'Our services' },
      { level: 3, text: 'Design' },
    ]);
  });

  it('decodes named + numeric HTML entities', () => {
    const html = '<h1>Tom &amp; Jerry&rsquo;s caf&#233; &#x2014; open</h1>';
    expect(extractHeadings(html)[0]?.text).toBe('Tom & Jerry’s café — open');
  });

  it('ignores headings inside script / style / template / svg / comments', () => {
    const html = `
      <style>h1 { color: red } .x::before { content: "<h2>fake</h2>" }</style>
      <script>const s = "<h3>nope</h3>";</script>
      <template><h4>template heading</h4></template>
      <svg><text><h5>svg</h5></text></svg>
      <!-- <h6>commented</h6> -->
      <h1>Real title</h1>
    `;
    expect(extractHeadings(html)).toEqual([{ level: 1, text: 'Real title' }]);
  });

  it('keeps an empty heading (as empty text) rather than dropping it', () => {
    expect(extractHeadings('<h2></h2><h2>Next</h2>')).toEqual([
      { level: 2, text: '' },
      { level: 2, text: 'Next' },
    ]);
  });

  it('parses well past the display cap so the truncation remainder stays accurate', () => {
    const many = Array.from({ length: 200 }, (_v, i) => `<h2>Item ${i}</h2>`).join('');
    expect(extractHeadings(many)).toHaveLength(200); // below the SCAN_CAP (500) → all kept
  });

  it('hard-caps a pathological page at the scan limit', () => {
    const absurd = Array.from({ length: 600 }, (_v, i) => `<h3>H${i}</h3>`).join('');
    expect(extractHeadings(absurd)).toHaveLength(500); // SCAN_CAP memory guard
  });

  // The linear scan replaces a lazy-quantifier+backreference regex that was O(n²) on unclosed tags — a
  // ~250 KB unclosed-heading page took ~2 s with the old regex and would freeze the event loop.
  it('parses pathological UNCLOSED-heading input in linear time (ReDoS guard)', () => {
    const evil = '<h1>x'.repeat(50_000); // ~250 KB, no closing tags at all
    const t0 = performance.now();
    const out = extractHeadings(evil);
    expect(performance.now() - t0).toBeLessThan(1000); // linear → milliseconds; O(n²) would be seconds
    expect(out.length).toBeGreaterThanOrEqual(1); // the first unclosed <h1> absorbs the (capped) remainder
  });

  it('does not hang on an unclosed skip-region tag', () => {
    const evil = '<script>' + 'a<h2>x</h2>'.repeat(50_000); // unclosed <script> — everything inside is ignored
    const t0 = performance.now();
    const out = extractHeadings(evil);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(out).toEqual([]); // all headings are inside the (never-closed) script region
  });

  it('reads a heading with attributes and a self-closing heading', () => {
    expect(extractHeadings('<h1 class="lead" data-x="y">Hello</h1><h2/>')).toEqual([
      { level: 1, text: 'Hello' },
      { level: 2, text: '' },
    ]);
  });
});

describe('analyzeHeadingOutline', () => {
  it('flags a page with no headings', () => {
    const out = analyzeHeadingOutline([]);
    expect(out.headings).toEqual([]);
    expect(out.issues[0]).toMatch(/no headings/i);
  });

  it('accepts a well-formed outline with no issues', () => {
    const out = analyzeHeadingOutline([
      { level: 1, text: 'Title' },
      { level: 2, text: 'Section' },
      { level: 3, text: 'Sub' },
      { level: 2, text: 'Another section' },
    ]);
    expect(out.issues).toEqual([]);
    expect(out.headings.every((h) => !h.issue)).toBe(true);
  });

  it('flags a missing H1', () => {
    const out = analyzeHeadingOutline([{ level: 2, text: 'Section' }]);
    expect(out.issues.some((i) => /No H1/i.test(i))).toBe(true);
    // First heading isn't an H1 either.
    expect(out.issues.some((i) => /first heading is an H2/i.test(i))).toBe(true);
  });

  it('flags multiple H1s', () => {
    const out = analyzeHeadingOutline([
      { level: 1, text: 'One' },
      { level: 1, text: 'Two' },
    ]);
    expect(out.issues.some((i) => /2 H1 headings/i.test(i))).toBe(true);
  });

  it('flags a skipped heading level on the offending node', () => {
    const out = analyzeHeadingOutline([
      { level: 1, text: 'Title' },
      { level: 2, text: 'Section' },
      { level: 4, text: 'Too deep' },
    ]);
    const jumped = out.headings.find((h) => h.text === 'Too deep');
    expect(jumped?.issue).toMatch(/Skips from H2 to H4/i);
    // A later decrease back to H3 is fine — not flagged.
  });

  it('flags an empty heading on the node', () => {
    const out = analyzeHeadingOutline([
      { level: 1, text: 'Title' },
      { level: 2, text: '' },
    ]);
    expect(out.headings[1]?.issue).toMatch(/empty heading/i);
  });

  it('caps the rendered headings and reports the truncated remainder', () => {
    const raw = Array.from({ length: 65 }, (_v, i) => ({ level: 2, text: `H ${i}` }));
    const out = analyzeHeadingOutline([{ level: 1, text: 'Title' }, ...raw]);
    expect(out.headings).toHaveLength(60);
    expect(out.truncated).toBe(6); // 66 total − 60
  });

  it('reports an accurate truncation remainder end-to-end (extract → analyze)', () => {
    const html = Array.from({ length: 90 }, (_v, i) => (i === 0 ? '<h1>Title</h1>' : `<h2>Section ${i}</h2>`)).join('');
    const out = analyzeHeadingOutline(extractHeadings(html));
    expect(out.headings).toHaveLength(60);
    expect(out.truncated).toBe(30); // 90 parsed − 60 displayed, NOT capped at 1
  });

  it('does not mutate the input nodes', () => {
    const input = [{ level: 2, text: 'x' }];
    analyzeHeadingOutline(input);
    expect(input[0]).toEqual({ level: 2, text: 'x' }); // no `issue` written back
  });
});
