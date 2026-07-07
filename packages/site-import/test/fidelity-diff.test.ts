import { describe, expect, it } from 'vitest';
// The gate's pure diff logic is a plain .mjs so the browser CLI and this test share ONE implementation.
import { firstFamily, stripWs, weightNum, skewDeg, lsPx, radiusPx, hasShadow, matchAndDiff, scorePage, type StyleEl } from '../tools/style-diff.mjs';

const el = (o: Partial<StyleEl> = {}): StyleEl => ({
  role: 'text', tag: 'p', text: 'x', font: 'text-font, sans-serif', size: '16px', weight: '400',
  color: 'rgb(0,0,0)', bg: 'rgba(0, 0, 0, 0)', bgImage: 'none', shadow: 'none', transform: 'none', radius: '0px', ...o,
});

describe('firstFamily / stripWs', () => {
  it('takes the first, unquoted, lowercased family', () => {
    expect(firstFamily('"Primary-Font", Arial, sans-serif')).toBe('primary-font');
    expect(firstFamily('')).toBe('');
  });
  it('stripWs makes gradients comparable regardless of spacing', () => {
    expect(stripWs('linear-gradient( #a , #b )')).toBe('linear-gradient(#a,#b)');
  });
});

describe('numeric style parsers (skew / weight / letter-spacing / radius / shadow)', () => {
  it('weightNum maps keywords + numbers', () => {
    expect(weightNum('normal')).toBe(400);
    expect(weightNum('bold')).toBe(700);
    expect(weightNum('700')).toBe(700);
    expect(weightNum(600)).toBe(600);
    expect(weightNum(undefined)).toBe(400);
  });
  it('skewDeg reads skewX degrees from a transform matrix', () => {
    expect(skewDeg('none')).toBe(0);
    expect(skewDeg('matrix(1, 0, -0.466308, 1, 0, 0)')).toBe(-25);
    expect(skewDeg('matrix(1, 0, 0.267949, 1, 0, 0)')).toBe(15);
    expect(skewDeg(undefined)).toBe(0);
    // pure skewX is immune to scale (a and c scale together); a pure ROTATION reads as -angle — a genuine
    // transform difference the gate SHOULD flag, just labelled `skew:` (documented degradation).
    expect(skewDeg('matrix(2, 0, -0.932616, 2, 0, 0)')).toBe(-25); // scale(2) · skewX(-25°) → still -25°
    expect(skewDeg('matrix(0.984808, 0.173648, -0.173648, 0.984808, 0, 0)')).toBe(-10); // rotate(10°) → -10°
  });
  it('lsPx resolves normal/px/em against font-size', () => {
    expect(lsPx('normal', '16px')).toBe(0);
    expect(lsPx('1px', '14px')).toBe(1);
    expect(lsPx('0.1em', '20px')).toBeCloseTo(2);
    expect(lsPx(undefined, undefined)).toBe(0);
  });
  it('radiusPx takes the first radius value in px', () => {
    expect(radiusPx('none')).toBe(0);
    expect(radiusPx('5px')).toBe(5);
    expect(radiusPx('5px 5px 0px 0px')).toBe(5);
  });
  it('hasShadow detects presence', () => {
    expect(hasShadow('none')).toBe(false);
    expect(hasShadow('')).toBe(false);
    expect(hasShadow('rgba(0,0,0,.16) 0px 2px 1px 0px')).toBe(true);
  });
});

describe('matchAndDiff', () => {
  it('flags a font-family mismatch on matched text (the "wrong display font" bug)', () => {
    const orig = [el({ role: 'button', text: 'GET A QUOTE', font: 'primary-font' })];
    const clone = [el({ role: 'button', text: 'get a quote', font: 'text-font' })]; // case-insensitive match
    const r = matchAndDiff(orig, clone);
    expect(r.matched).toBe(1);
    expect(r.diffs[0]!.props).toContain('font:primary-font→text-font');
  });

  it('flags a MISSING gradient and a DIFF gradient on buttons/headings', () => {
    const miss = matchAndDiff([el({ role: 'button', text: 'A', bgImage: 'linear-gradient(#028bc0,#000)' })], [el({ role: 'button', text: 'A', bgImage: 'none' })]);
    expect(miss.diffs[0]!.props).toContain('gradient:MISSING');
    const diff = matchAndDiff([el({ role: 'button', text: 'A', bgImage: 'linear-gradient(#028bc0,#000)' })], [el({ role: 'button', text: 'A', bgImage: 'linear-gradient(#111,#222)' })]);
    expect(diff.diffs[0]!.props).toContain('gradient:DIFF');
  });

  it('flags a missing skew transform + missing shadow on a button', () => {
    const r = matchAndDiff(
      [el({ role: 'button', text: 'B', transform: 'matrix(1,0,-0.2,1,0,0)', shadow: 'rgba(0,0,0,.3) 0px 4px 8px' })],
      [el({ role: 'button', text: 'B', transform: 'none', shadow: 'none' })],
    );
    expect(r.diffs[0]!.props).toEqual(expect.arrayContaining(['transform:MISSING(skew?)', 'shadow:MISSING']));
  });

  it('flags a heading size mismatch only when it exceeds 1.2x', () => {
    expect(matchAndDiff([el({ role: 'heading', text: 'H', size: '48px' })], [el({ role: 'heading', text: 'H', size: '20px' })]).diffs[0]!.props.some((p) => p.startsWith('size:'))).toBe(true);
    expect(matchAndDiff([el({ role: 'heading', text: 'H', size: '48px' })], [el({ role: 'heading', text: 'H', size: '44px' })]).diffs).toHaveLength(0);
  });

  it('records unmatched originals (content missing/renamed in the clone)', () => {
    const r = matchAndDiff([el({ text: 'kept' }), el({ role: 'button', text: 'REQUEST QUOTE' })], [el({ text: 'kept' })]);
    expect(r.matched).toBe(1);
    expect(r.unmatched).toHaveLength(1);
    expect(r.unmatched[0]!.text).toBe('REQUEST QUOTE');
  });

  it('matches greedily 1:1 (two identical texts consume two clone candidates)', () => {
    const r = matchAndDiff([el({ text: 'dup' }), el({ text: 'dup' })], [el({ text: 'dup' })]);
    expect(r.matched).toBe(1);
    expect(r.unmatched).toHaveLength(1);
  });
});

describe('scorePage', () => {
  it('PASSES a clean page and FAILS on font/coverage/gradient breaches', () => {
    const clean = scorePage({ matched: 20, origCount: 20, diffs: [], unmatched: [] });
    expect(clean.pass).toBe(true);
    expect(clean.coverage).toBe(1);

    const fontFail = scorePage({ matched: 20, origCount: 20, diffs: [{ role: 'button', text: 'x', props: ['font:a→b'] }], unmatched: [] });
    expect(fontFail.fontMiss).toBe(1);
    expect(fontFail.pass).toBe(false); // maxFontMiss defaults to 0

    const covFail = scorePage({ matched: 10, origCount: 20, diffs: [], unmatched: new Array(10).fill(el({})) });
    expect(covFail.coverage).toBe(0.5);
    expect(covFail.pass).toBe(false);
  });

  it('honours custom thresholds', () => {
    const r = scorePage({ matched: 20, origCount: 20, diffs: [{ role: 'button', text: 'x', props: ['font:a→b'] }], unmatched: [] }, { maxFontMiss: 2 });
    expect(r.pass).toBe(true);
  });

  it('fails on the broad SCORE threshold even when no single category breaches (general drift)', () => {
    // 3 non-font/gradient divergences over 20 matched = 0.15 > default maxScore 0.12 → FAIL.
    const diffs = Array.from({ length: 3 }, () => ({ role: 'button', text: 'x', props: ['fill:a→b'] }));
    const r = scorePage({ matched: 20, origCount: 20, diffs, unmatched: [] });
    expect(r.fontMiss).toBe(0);
    expect(r.gradFail).toBe(0);
    expect(r.score).toBeCloseTo(0.15);
    expect(r.pass).toBe(false);
  });
});
