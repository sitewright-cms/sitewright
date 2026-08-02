import { describe, it, expect } from 'vitest';
import { diffClips, clipSignature, describeClips, type ClipFinding } from '../src/render/clip-diff.js';
import { behaviouralChecks } from '../src/render/clone-audit.js';
import type { BehaviourFacts } from '../src/render/clone-audit.js';

const clip = (over: Partial<ClipFinding> = {}): ClipFinding => ({
  el: 'img.card__media',
  clippedBy: 'div.card',
  box: '400x300',
  visible: '400x180',
  lost: '40%',
  tag: 'img',
  axis: 'y',
  ...over,
});

describe('clipSignature', () => {
  it('pairs on the design decision (tag + axis), not the selector', () => {
    // The whole point of a native port is that the markup differs. `img.card__media` in the source and
    // `img.sw-tile-img` in the clone are the SAME decision: this design cuts images vertically.
    expect(clipSignature(clip({ el: 'img.card__media' }))).toBe(clipSignature(clip({ el: 'img.sw-tile-img' })));
  });

  it('separates different axes and different elements', () => {
    expect(clipSignature(clip({ axis: 'x' }))).not.toBe(clipSignature(clip({ axis: 'y' })));
    expect(clipSignature(clip({ tag: 'h2' }))).not.toBe(clipSignature(clip({ tag: 'img' })));
  });

  it('falls back to the label when a cached result predates tag/axis', () => {
    const legacy: ClipFinding = { el: 'IMG.hero', clippedBy: 'div', box: '1x1', visible: '1x1', lost: '20%' };
    expect(clipSignature(legacy)).toBe('img|?');
  });
});

describe('diffClips', () => {
  it('subtracts clips the original makes too', () => {
    // This is the case that caused the damage: the source deliberately crops its card images, the clone
    // faithfully reproduces it, and the old check called that a defect.
    const d = diffClips([clip()], [clip({ el: 'img.original-thing' })]);
    expect(d.novel).toEqual([]);
    expect(d.matchedOriginal).toBe(1);
    expect(d.compared).toBe(true);
  });

  it('keeps a clip the original does NOT make', () => {
    const d = diffClips([clip({ tag: 'h2', el: 'h2.title' })], [clip({ tag: 'img' })]);
    expect(d.novel.map((c) => c.el)).toEqual(['h2.title']);
    expect(d.matchedOriginal).toBe(0);
  });

  it('an original that clips NOTHING makes every clone clip novel', () => {
    const d = diffClips([clip()], []);
    expect(d.novel.length).toBe(1);
    expect(d.compared).toBe(true); // an empty source result is still a real comparison
  });

  // The distinction that keeps the check honest: "the original clips nothing" and "we could not look at
  // the original" produce identical `novel` sets but must NOT produce the same verdict.
  it('no original at all is reported as NOT compared', () => {
    for (const missing of [null, undefined]) {
      const d = diffClips([clip()], missing);
      expect(d.compared).toBe(false);
      expect(d.novel.length).toBe(1);
    }
  });

  it('handles an empty clone side', () => {
    expect(diffClips([], [clip()]).novel).toEqual([]);
    expect(diffClips(undefined, [clip()]).novel).toEqual([]);
  });
});

describe('behaviouralChecks — the clipping check', () => {
  const facts = (over: Partial<BehaviourFacts>): BehaviourFacts => ({
    carousels: 0, carouselsEnhanced: 0, dialogs: 0,
    headingFont: 'X', bodyFont: 'X', headingFontLoaded: true, bodyFontLoaded: true,
    navExpected: 0, navReachableMobile: 0, hasModalTrigger: false,
    ...over,
  });
  const clipCheck = (b: BehaviourFacts) => behaviouralChecks(b).find((c) => c.id === 'not-clipped')!;

  it('GATES once the original has been probed', () => {
    const c = clipCheck(facts({ clipped: [clip({ tag: 'h2' })], originalClipped: [] }));
    expect(c.advisory).toBeFalsy(); // a real gate again
    expect(c.pass).toBe(false);
    expect(c.detail).toContain('the ORIGINAL does not clip these');
  });

  it('stays ADVISORY when there was no original to compare against', () => {
    // Regression guard for the behaviour that caused four fidelity regressions: without the original,
    // this must never force the agent to "fix" an ambiguous clip.
    const c = clipCheck(facts({ clipped: [clip()], originalClipped: null }));
    expect(c.advisory).toBe(true);
    expect(c.detail).toContain('ADVISORY');
  });

  it('passes when every clip matches the original, and says how many it ignored', () => {
    const c = clipCheck(facts({ clipped: [clip(), clip()], originalClipped: [clip()] }));
    expect(c.pass).toBe(true);
    expect(c.advisory).toBeFalsy();
    expect(c.detail).toContain('2 matched the original');
  });

  it('reports matched-and-ignored alongside a genuine finding', () => {
    const c = clipCheck(facts({ clipped: [clip(), clip({ tag: 'h2' })], originalClipped: [clip()] }));
    expect(c.pass).toBe(false);
    expect(c.detail).toContain('1 other clips DO match the original');
  });
});

describe('describeClips', () => {
  it('names the element, the loss and the clipper', () => {
    expect(describeClips([clip()])).toBe('img.card__media cut 40% by div.card (400x300 -> 400x180)');
  });
});
