import { describe, expect, it } from 'vitest';
// Import the canonical TS source directly (the CLI's .mjs shim re-exports this from dist) so coverage sees it.
import { matchChrome, scoreChrome, scoreChromeMeta, median, isVisibleBg, hasFill, type ChromeEl } from '../src/fidelity/gate.js';

// skewX(θ) computes to matrix(1,0,tanθ,1,0,0); these are the phoenix nav's real vs my old guessed angle.
const SKEW25 = 'matrix(1, 0, -0.466308, 1, 0, 0)'; // -25°
const SKEW15 = 'matrix(1, 0, -0.267949, 1, 0, 0)'; // -15°

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

  // The axes the old gate was BLIND to — each was a real, user-flagged nav defect that passed silently.
  it('FAILS on a skew-angle mismatch (25° original vs a 15° re-author)', () => {
    const r = scoreChrome(matchChrome([el({ text: 'Web Design', transform: SKEW25 })], [el({ text: 'Web Design', transform: SKEW15 })]));
    expect(r.styleOff).toBe(1);
    expect(r.diffs[0]!.props.some((p) => p.startsWith('skew:'))).toBe(true);
    expect(r.pass).toBe(false);
  });

  it('FAILS on a font-weight mismatch (bold vs the original 400)', () => {
    const r = scoreChrome(matchChrome([el({ text: 'Web Design', weight: '400' })], [el({ text: 'Web Design', weight: '700' })]));
    expect(r.diffs[0]!.props).toContain('weight:400→700');
    expect(r.pass).toBe(false);
  });

  it('FAILS on a letter-spacing mismatch (1px tracking vs normal)', () => {
    const r = scoreChrome(matchChrome([el({ text: 'Web Design', ls: '1px' })], [el({ text: 'Web Design', ls: 'normal' })]));
    expect(r.diffs[0]!.props.some((p) => p.startsWith('ls:'))).toBe(true);
    expect(r.pass).toBe(false);
  });

  it('FAILS on a border-radius mismatch (5px vs 0px)', () => {
    const r = scoreChrome(matchChrome([el({ text: 'Web Design', radius: '5px' })], [el({ text: 'Web Design', radius: '0px' })]));
    expect(r.diffs[0]!.props.some((p) => p.startsWith('radius:'))).toBe(true);
    expect(r.pass).toBe(false);
  });

  it('FAILS on a missing box-shadow on a tab', () => {
    const r = scoreChrome(matchChrome([el({ text: 'Tab', role: 'button', shadow: 'rgba(0,0,0,.16) 0px 2px 1px 0px' })], [el({ text: 'Tab', role: 'button', shadow: 'none' })]));
    expect(r.diffs[0]!.props.some((p) => p.startsWith('shadow:'))).toBe(true);
    expect(r.pass).toBe(false);
  });

  it('FAILS on a gradient ADDED where the original is a flat solid (the exact "added gradients" bug)', () => {
    const r = scoreChrome(matchChrome(
      [el({ text: 'Tab', role: 'button', bgImage: 'none', bg: 'rgb(238, 238, 238)' })],
      [el({ text: 'Tab', role: 'button', bgImage: 'linear-gradient(#f5f5f5,#dadada)', bg: 'rgba(0, 0, 0, 0)' })],
    ));
    expect(r.diffs[0]!.props).toContain('gradient:EXTRA(orig-solid)');
    expect(r.pass).toBe(false);
  });

  it('FAILS on a filled NON-button tab whose fill went transparent (the orange HOME tab the gate used to miss)', () => {
    // Both sides are role "text" (a plain <li>/<a>), NOT a button — the old gate only checked fill on buttons.
    const r = scoreChrome(matchChrome(
      [el({ text: 'Home', role: 'text', bg: 'rgb(243, 146, 0)' })], // orange active tab
      [el({ text: 'Home', role: 'text', bg: 'rgba(0, 0, 0, 0)' })], // clone is transparent
    ));
    expect(r.diffs[0]!.props.some((p) => p.startsWith('fill:'))).toBe(true);
    expect(r.pass).toBe(false);
  });

  it('does NOT flag two transparent non-button links (no meaningful fill on either side)', () => {
    const r = scoreChrome(matchChrome([el({ text: 'About', role: 'text' })], [el({ text: 'About', role: 'text' })]));
    expect(r.diffs).toHaveLength(0);
    expect(r.pass).toBe(true);
  });

  it('FAILS when a non-button CLONE gains a fill the original lacks (inverse direction)', () => {
    const r = scoreChrome(matchChrome(
      [el({ text: 'Home', role: 'text', bg: 'rgba(0, 0, 0, 0)' })],
      [el({ text: 'Home', role: 'text', bg: 'rgb(243, 146, 0)' })],
    ));
    expect(r.diffs[0]!.props.some((p) => p.startsWith('fill:'))).toBe(true);
    expect(r.pass).toBe(false);
  });

  it('FAILS when a non-button CLONE adds a gradient where the original is flat', () => {
    const r = scoreChrome(matchChrome(
      [el({ text: 'Services', role: 'text', bgImage: 'none', bg: 'rgba(0, 0, 0, 0)' })],
      [el({ text: 'Services', role: 'text', bgImage: 'linear-gradient(#fff,#aaa)' })],
    ));
    expect(r.diffs[0]!.props).toContain('gradient:EXTRA(orig-solid)');
    expect(r.pass).toBe(false);
  });

  it('TOLERATES a uniform horizontal shift of the whole bar (responsive re-centre) — no pos diffs', () => {
    // 4 items each shifted +60px (a wider container / centred nav). A uniform shift is fidelity-preserving.
    const orig = ['A', 'B', 'C', 'D'].map((t, i) => el({ text: t, x: 100 + i * 200 }));
    const clone = ['A', 'B', 'C', 'D'].map((t, i) => el({ text: t, x: 160 + i * 200 }));
    const r = scoreChrome(matchChrome(orig, clone));
    expect(r.posOff).toBe(0);
    expect(r.pass).toBe(true);
  });

  it('still FAILS a single element that moves RELATIVE to a uniformly-shifted bar', () => {
    const orig = ['A', 'B', 'C', 'D'].map((t, i) => el({ text: t, x: 100 + i * 200 }));
    // A,B,D shift +60; C is teleported far past that — a genuine misplacement, not the bar shift.
    const clone = [el({ text: 'A', x: 160 }), el({ text: 'B', x: 360 }), el({ text: 'C', x: 900 }), el({ text: 'D', x: 760 })];
    const r = scoreChrome(matchChrome(orig, clone));
    expect(r.posOff).toBeGreaterThan(0);
    expect(r.diffs.some((d) => d.label === 'C' && d.props.some((p) => p.startsWith('x:')))).toBe(true);
    expect(r.pass).toBe(false);
  });
});

describe('gate helpers', () => {
  it('median handles empty, odd, and even lists', () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2); // sorted 1,2,3
    expect(median([4, 1, 3, 2])).toBe(2.5); // sorted 1,2,3,4 → (2+3)/2
    expect(median([60, 60, 400, 60])).toBe(60); // outlier-robust
  });

  it('isVisibleBg reads the ALPHA channel — zero-alpha of ANY colour + both notations are invisible', () => {
    expect(isVisibleBg('rgba(0, 0, 0, 0)')).toBe(false);
    expect(isVisibleBg('transparent')).toBe(false);
    expect(isVisibleBg('')).toBe(false);
    expect(isVisibleBg(undefined)).toBe(false);
    expect(isVisibleBg('rgba(255, 0, 0, 0)')).toBe(false); // red at alpha 0 → still invisible (non-zero RGB)
    expect(isVisibleBg('rgb(0 0 0 / 0)')).toBe(false); // CSS Color 4 slash notation, alpha 0
    expect(isVisibleBg('rgb(30 120 200 / 0.5)')).toBe(true); // CSS Color 4, alpha 0.5
    expect(isVisibleBg('rgb(243, 146, 0)')).toBe(true); // opaque 3-component
    expect(isVisibleBg('rgba(10, 20, 30, 1)')).toBe(true);
  });

  it('hasFill is true for a gradient image or a visible bg colour', () => {
    expect(hasFill({ bgImage: 'linear-gradient(#fff,#000)', bg: 'rgba(0, 0, 0, 0)' })).toBe(true);
    expect(hasFill({ bgImage: 'none', bg: 'rgb(238, 238, 238)' })).toBe(true);
    expect(hasFill({ bgImage: 'none', bg: 'rgba(0, 0, 0, 0)' })).toBe(false);
    expect(hasFill({})).toBe(false);
  });
});

describe('scoreChromeMeta', () => {
  it('flags a non-pinned header (original fixed, clone static)', () => {
    const r = scoreChromeMeta({ position: 'fixed', ripple: 5, modalTriggers: 1 }, { position: 'static', ripple: 5, modalTriggers: 1 });
    expect(r.diffs.some((d) => d.startsWith('header-position:'))).toBe(true);
    expect(r.pass).toBe(false);
  });

  it('flags missing ripple and missing nav modals', () => {
    const r = scoreChromeMeta({ position: 'fixed', ripple: 157, modalTriggers: 3 }, { position: 'fixed', ripple: 0, modalTriggers: 0 });
    expect(r.diffs.some((d) => d.startsWith('ripple:MISSING'))).toBe(true);
    expect(r.diffs.some((d) => d.startsWith('modals:MISSING'))).toBe(true);
    expect(r.metaOff).toBe(2);
    expect(r.pass).toBe(false);
  });

  it('PASSES when the clone is pinned and has ripple + modals (extra is fine)', () => {
    const r = scoreChromeMeta({ position: 'fixed', ripple: 157, modalTriggers: 3 }, { position: 'sticky', ripple: 12, modalTriggers: 3 });
    expect(r.pass).toBe(true);
    expect(r.metaOff).toBe(0);
  });
});
