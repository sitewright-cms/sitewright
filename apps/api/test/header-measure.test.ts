import { describe, it, expect } from 'vitest';
import { headerReport, headerTokenCss, HEADER_MEASURE_WIDTHS, type HeaderSample } from '../src/render/header-measure.js';

const sample = (width: number, bar: number | null, token: number | null, over: Partial<HeaderSample> = {}): HeaderSample => ({
  width,
  position: 'fixed',
  bar,
  token,
  spacerPad: null,
  ...over,
});

describe('headerTokenCss', () => {
  it('declares the first width unconditionally and one min-width query per CHANGE, values exact', () => {
    const css = headerTokenCss([sample(390, 66.8, 72), sample(640, 66.8, 72), sample(768, 81.6, 72), sample(1024, 102.8, 76), sample(1280, 102.8, 76)]);
    expect(css).toBe(
      ':root{--sw-header-h:66.8px}\n@media (min-width:768px){:root{--sw-header-h:81.6px}}\n@media (min-width:1024px){:root{--sw-header-h:102.8px}}',
    );
  });

  it('ignores rows where the header is not fixed or not measured', () => {
    expect(headerTokenCss([sample(390, null, 72, { position: 'static' }), sample(1024, 90, 76)])).toBe(':root{--sw-header-h:90px}');
    expect(headerTokenCss([sample(390, null, null, { position: null })])).toBeNull();
  });
});

describe('headerReport', () => {
  it('flags a two-row header the default token is far too short for, and gives the fix', () => {
    const rows = HEADER_MEASURE_WIDTHS.map((w) => sample(w, w < 1024 ? 96 : 150, w < 1024 ? 72 : 85.5));
    const report = headerReport(rows);
    expect(report.rows.every((r) => r.verdict === 'too-small')).toBe(true);
    expect(report.rows[0]!.delta).toBe(-24);
    expect(report.css).toBe(':root{--sw-header-h:96px}\n@media (min-width:1024px){:root{--sw-header-h:150px}}');
    expect(report.advice.join(' ')).toMatch(/SHORTER than the bar at 390px.*patch_critical_css/s);
  });

  it('says nothing needs changing when the token matches within half a pixel', () => {
    const report = headerReport([sample(390, 72.2, 72), sample(1024, 76, 76)]);
    expect(report.css).toBeNull();
    expect(report.rows.map((r) => r.verdict)).toEqual(['ok', 'ok']);
    expect(report.advice[0]).toMatch(/matches the bar/);
  });

  it('reports an over-declared token as too large (a strip under the bar)', () => {
    const report = headerReport([sample(390, 64, 72)]);
    expect(report.rows[0]).toMatchObject({ verdict: 'too-large', delta: 8 });
    expect(report.advice.join(' ')).toMatch(/TALLER than the bar/);
  });

  it('a header that scrolls with the page needs no token', () => {
    const report = headerReport([sample(390, null, 72, { position: 'static' }), sample(1024, null, 76, { position: 'sticky' })]);
    expect(report.css).toBeNull();
    expect(report.rows.map((r) => r.verdict)).toEqual(['not-fixed', 'not-fixed']);
    expect(report.advice[0]).toMatch(/not fixed/);
  });

  it('never says "nothing to change" while a fixed width could not be read', () => {
    const report = headerReport([sample(390, 72, 72), sample(1536, null, null)]);
    expect(report.rows.map((r) => r.verdict)).toEqual(['ok', 'unmeasured']);
    expect(report.css).toBeNull();
    expect(report.advice.join(' ')).toMatch(/could not be measured at 1536px/);
    expect(report.advice.join(' ')).not.toMatch(/nothing to change/);
  });

  it('a height that goes up and back down gets a query per change (the later one wins)', () => {
    expect(headerTokenCss([sample(390, 96, 72), sample(768, 150, 72), sample(1280, 96, 76)])).toBe(
      ':root{--sw-header-h:96px}\n@media (min-width:768px){:root{--sw-header-h:150px}}\n@media (min-width:1280px){:root{--sw-header-h:96px}}',
    );
  });

  it('says so when nothing could be measured', () => {
    expect(headerReport([]).advice[0]).toMatch(/could not be measured/);
    expect(headerReport([sample(390, null, null, { position: null })]).rows[0]!.verdict).toBe('unmeasured');
  });

  it('notices a header fixed at only some widths', () => {
    const report = headerReport([sample(390, null, 72, { position: 'static' }), sample(1024, 120, 76)]);
    expect(report.css).toBe(':root{--sw-header-h:120px}');
    expect(report.advice.join(' ')).toMatch(/fixed at some widths only/);
  });

  it('catches a .sw-top-padding that a padding utility silently defeats — but not a deliberate 0', () => {
    const defeated = headerReport([sample(1024, 102.8, 102.8, { spacerPad: 16 })]);
    expect(defeated.advice.join(' ')).toMatch(/\.sw-top-padding computes 16px at 1024px/);
    const optOut = headerReport([sample(1024, 102.8, 102.8, { spacerPad: 0 })]);
    expect(optOut.advice.join(' ')).not.toMatch(/sw-top-padding computes/);
  });
});
