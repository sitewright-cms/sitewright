import { describe, expect, it } from 'vitest';
import { captureImageBlocks, captureLabel, captureSummary } from '../src/preview-captures.js';
import type { PreviewCapture } from '../src/client.js';

/** How segmented captures are described to the model: what each image covers, and the call for the rest. */

const desk = (index: number, top: number, bottom: number): PreviewCapture => ({
  viewport: 'fullhd',
  kind: 'page',
  base64: `D${index}`,
  mimeType: 'image/jpeg',
  width: 960,
  height: 1354,
  scale: 0.5,
  segments: [{ index, top, bottom }],
  segmentCount: 4,
  totalHeight: 9450,
});

const phone: PreviewCapture = {
  viewport: 'mobile',
  kind: 'page',
  base64: 'M',
  mimeType: 'image/jpeg',
  width: 828,
  height: 1568,
  scale: 0.5,
  segments: [
    { index: 1, top: 0, bottom: 3136 },
    { index: 2, top: 3136, bottom: 6272 },
    { index: 3, top: 6272, bottom: 9408 },
    { index: 4, top: 9408, bottom: 11800 },
  ],
  segmentCount: 4,
  totalHeight: 11800,
};

describe('captureSummary', () => {
  it('★ says what the desktop images cover, at what scale, and EXACTLY how to get the rest', () => {
    const [desktop, mobile] = captureSummary([desk(1, 0, 2708), desk(2, 2708, 5416), phone]);
    expect(desktop).toBe(
      'fullhd (1920px wide) — page 9,450px tall, at 50% scale: segments 1–2 of 4, y 0–5,416. More below: call again with segment:3 and viewports:["fullhd"].',
    );
    // Columns are SAID — otherwise a four-column image reads as one very wide page.
    expect(mobile).toBe(
      'mobile (390px wide) — page 11,800px tall, at 50% scale: segments 1–4 of 4, y 0–11,800; shown SIDE BY SIDE as columns — read left to right, the left column is the top. The whole page.',
    );
  });

  it('with one viewport the hint does not tell the caller to narrow the viewports', () => {
    expect(captureSummary([desk(1, 0, 2708), desk(2, 2708, 5416)])[0]).toMatch(/More below: call again with segment:3\.$/);
  });

  it('the last segments of a page end without a "more" hint, and a page past the limit says so', () => {
    const tail = { ...desk(4, 8124, 12000), segmentCount: 4, totalHeight: 12000, truncated: true };
    const [line] = captureSummary([tail]);
    expect(line).not.toMatch(/More below/);
    expect(line).not.toMatch(/whole page/); // it is not — segments 1–3 are elsewhere
    expect(line).toMatch(/runs on past the 12,000px capture limit/);
  });

  it('an element names its selector and how many it matched', () => {
    const el: PreviewCapture = { ...desk(1, 3200, 4100), kind: 'element', scale: 1, width: 1200, height: 900, segmentCount: 1, totalHeight: 900, selector: 'section.pricing', matches: 3 };
    expect(captureSummary([el])[0]).toBe('fullhd — element "section.pricing" (the first of 3 matches), 900px tall, at 100% scale: segment 1 of 1, y 3,200–4,100. The whole element.');
    expect(captureSummary([{ ...el, matches: 1 }])[0]).not.toMatch(/matches/);
  });

  it('appends each note under its viewport', () => {
    expect(captureSummary([], [{ viewport: 'mobile', message: 'no element matches ".x" at this width.' }])).toEqual(['mobile: no element matches ".x" at this width.']);
  });
});

describe('captureLabel / captureImageBlocks', () => {
  it('labels every image with its place on the page, then the image', () => {
    expect(captureLabel(desk(2, 2708, 5416))).toBe('— fullhd · segment 2 of 4 (y 2,708–5,416) —');
    expect(captureLabel(phone)).toBe('— mobile · segments 1–4 of 4 (y 0–11,800, as columns left to right) —');
    expect(captureImageBlocks([desk(1, 0, 2708)])).toEqual([
      { type: 'text', text: '— fullhd · segment 1 of 4 (y 0–2,708) —' },
      { type: 'image', data: 'D1', mimeType: 'image/jpeg' },
    ]);
  });
});
