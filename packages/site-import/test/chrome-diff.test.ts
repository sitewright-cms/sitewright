import { describe, expect, it } from 'vitest';
import { matchChrome, scoreChrome, type ChromeEl } from '../tools/chrome-diff.mjs';

const el = (o: Partial<ChromeEl> = {}): ChromeEl => ({
  role: 'button', tag: 'a', text: '', region: 'header', x: 0, y: 10, w: 100, h: 40,
  font: 'secondary-font', size: '14px', weight: '700', color: 'rgb(2,139,192)',
  bg: 'rgba(0, 0, 0, 0)', bgImage: 'none', shadow: 'none', transform: 'none', radius: '4px', ...o,
});

describe('matchChrome', () => {
  it('matches text elements by text and text-less ones (logo/icons) by left-to-right order within a region', () => {
    const orig = [el({ tag: 'img', text: '', x: 11 }), el({ text: 'Web Design', x: 641 }), el({ tag: 'img', text: '', x: 1700, role: 'button' })];
    const clone = [el({ tag: 'img', text: '', x: 16 }), el({ text: 'Web Design', x: 705 }), el({ tag: 'img', text: '', x: 1690, role: 'button' })];
    const { pairs, unmatched } = matchChrome(orig, clone);
    expect(pairs).toHaveLength(3);
    expect(unmatched).toHaveLength(0);
    // the text pair links the two "Web Design"; the two text-less imgs pair by order
    expect(pairs.find((p) => p.o.text === 'Web Design')?.c.x).toBe(705);
  });

  it('reports an original chrome element with no clone counterpart as unmatched', () => {
    const { unmatched } = matchChrome([el({ text: 'REQUEST QUOTE', x: 1678 }), el({ text: 'Contact', x: 1600 })], [el({ text: 'REQUEST QUOTE', x: 1684 })]);
    expect(unmatched.map((u) => u.text)).toContain('Contact');
  });

  it('keeps header and footer matching separate', () => {
    const orig = [el({ text: 'A', region: 'header' }), el({ text: 'A', region: 'footer' })];
    const clone = [el({ text: 'A', region: 'footer' }), el({ text: 'A', region: 'header' })];
    const { pairs } = matchChrome(orig, clone);
    expect(pairs).toHaveLength(2);
    for (const p of pairs) expect(p.o.region).toBe(p.c.region);
  });
});

describe('scoreChrome', () => {
  it('FAILS on an x-position breach (the full-width/container bug)', () => {
    // logo boxed in the container vs the original full-width bar: x 11 vs 392
    const match = matchChrome([el({ tag: 'img', x: 11 })], [el({ tag: 'img', x: 392 })]);
    const r = scoreChrome(match);
    expect(r.posOff).toBe(1);
    expect(r.pass).toBe(false);
    expect(r.diffs[0]!.props[0]).toMatch(/^x:11→392/);
  });

  it('FAILS on a size breach (>1.25x)', () => {
    const r = scoreChrome(matchChrome([el({ tag: 'img', x: 11, w: 220, h: 70 })], [el({ tag: 'img', x: 20, w: 120, h: 40 })]));
    expect(r.sizeOff).toBeGreaterThanOrEqual(1);
    expect(r.pass).toBe(false);
  });

  it('FAILS on a font mismatch on a matched nav label', () => {
    const r = scoreChrome(matchChrome([el({ text: 'Web Design', x: 641, font: 'secondary-font' })], [el({ text: 'Web Design', x: 650, font: 'primary-font' })]));
    expect(r.styleOff).toBe(1);
    expect(r.pass).toBe(false);
    expect(r.diffs[0]!.props).toContain('font:secondary-font→primary-font');
  });

  it('flags a missing gradient on a button/tab', () => {
    const r = scoreChrome(matchChrome([el({ text: 'Quote', role: 'button', bgImage: 'linear-gradient(#3fb8e8,#028bc0)' })], [el({ text: 'Quote', role: 'button', bgImage: 'none' })]));
    expect(r.diffs[0]!.props).toContain('gradient:MISSING');
    expect(r.pass).toBe(false);
  });

  it('flags hover:MISSING when the original tab lights up on hover but the clone stays flat', () => {
    const o = el({ text: 'Web Design', role: 'button', bgImage: 'linear-gradient(#fbfbfc,#c9cdd3)', hover: { bg: 'rgba(0, 0, 0, 0)', bgImage: 'linear-gradient(#3fb8e8,#028bc0)', color: 'rgb(255,255,255)' } });
    const cFlat = el({ text: 'Web Design', role: 'button', bgImage: 'linear-gradient(#fbfbfc,#c9cdd3)', hover: { bg: 'rgba(0, 0, 0, 0)', bgImage: 'linear-gradient(#fbfbfc,#c9cdd3)', color: 'rgb(2,139,192)' } });
    expect(scoreChrome(matchChrome([o], [cFlat])).diffs[0]!.props).toContain('hover:MISSING?');
    // clone that DOES change on hover → no hover flag
    const cHover = el({ text: 'Web Design', role: 'button', bgImage: 'linear-gradient(#fbfbfc,#c9cdd3)', hover: { bg: 'rgba(0, 0, 0, 0)', bgImage: 'linear-gradient(#3fb8e8,#028bc0)', color: 'rgb(255,255,255)' } });
    expect(scoreChrome(matchChrome([o], [cHover])).diffs.some((d) => d.props.includes('hover:MISSING?'))).toBe(false);
  });

  it('PASSES when position, size, font and gradient all align', () => {
    const orig = [el({ tag: 'img', x: 11, w: 220, h: 70 }), el({ text: 'Web Design', x: 641, w: 167, h: 43 })];
    const clone = [el({ tag: 'img', x: 16, w: 221, h: 70 }), el({ text: 'Web Design', x: 655, w: 175, h: 45 })];
    const r = scoreChrome(matchChrome(orig, clone));
    expect(r.posOff).toBe(0);
    expect(r.sizeOff).toBe(0);
    expect(r.styleOff).toBe(0);
    expect(r.pass).toBe(true);
  });
});
