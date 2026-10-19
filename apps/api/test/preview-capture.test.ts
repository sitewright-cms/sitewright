import { describe, expect, it, vi } from 'vitest';
import { SCREENSHOT_VIEWPORTS } from '@sitewright/schema';
import { imageSize, renderTrustedSvgToPng } from '@sitewright/image-pipeline';
import { captureLegacyShot, capturePreviewViewport, withTimeout, type CaptureDriver } from '../src/render/preview-capture.js';
import type { CaptureRegion } from '../src/render/capture-plan.js';
import { COLUMN_GUTTER } from '../src/render/capture-plan.js';

/**
 * The capture orchestration against a FAKE page: the driver answers the document height / element box
 * and "grabs" a solid JPEG of exactly the size a real clip at that scale would produce. What is pinned
 * is which clips are taken, how they are assembled, and what the caller is told when there is nothing
 * to take. The real browser half is exercised in capture-layout.test.ts. (The fake's images are PNG —
 * only their dimensions matter here.)
 */

const vp = SCREENSHOT_VIEWPORTS;

function fakeDriver(opts: {
  height?: number;
  element?: { box: CaptureRegion | null; matches: number } | 'invalid';
}): CaptureDriver & { grab: ReturnType<typeof vi.fn> } {
  return {
    documentHeight: async () => opts.height ?? 1000,
    element: async () => opts.element ?? { box: null, matches: 0 },
    grab: vi.fn(async (clip: CaptureRegion, scale: number) => {
      const [w, h] = [Math.round(clip.width * scale), Math.round(clip.height * scale)];
      return renderTrustedSvgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#ccc"/></svg>`, w, h);
    }),
  };
}

const decode = async (base64: string) => imageSize(Buffer.from(base64, 'base64'));

describe('capturePreviewViewport — the page', () => {
  it('★ a long desktop page: two READABLE segment images from the top, each one bounded clip', async () => {
    const d = fakeDriver({ height: 9450 });
    const { captures, notes } = await capturePreviewViewport(d, 'fullhd', vp.fullhd, { segment: 1 }, 0.5);
    expect(notes).toEqual([]);
    expect(captures.map((c) => [c.kind, c.width, c.segments.map((s) => s.index)])).toEqual([
      ['page', 960, [1]],
      ['page', 960, [2]],
    ]);
    expect(d.grab.mock.calls).toEqual([
      [{ left: 0, top: 0, width: 1920, height: 2708 }, 0.5],
      [{ left: 0, top: 2708, width: 1920, height: 2708 }, 0.5],
    ]);
    expect(captures[0]).toMatchObject({ viewport: 'fullhd', segmentCount: 4, totalHeight: 9450, scale: 0.5, mimeType: 'image/jpeg' });
    // The reported size IS the image's size.
    expect(await decode(captures[0]!.base64)).toEqual({ width: captures[0]!.width, height: captures[0]!.height });
  });

  it('a long phone page comes back as ONE image of side-by-side columns', async () => {
    const d = fakeDriver({ height: 11800 });
    const { captures } = await capturePreviewViewport(d, 'mobile', vp.mobile, { segment: 1 }, 0.5);
    expect(captures).toHaveLength(1);
    expect(captures[0]!.segments.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    expect(captures[0]!.width).toBe(4 * 195 + 3 * COLUMN_GUTTER);
    expect(d.grab).toHaveBeenCalledTimes(4);
    expect(await decode(captures[0]!.base64)).toEqual({ width: captures[0]!.width, height: 1568 });
  });

  it('a page shorter than the screen still shows the whole screen, as the full-page capture did', async () => {
    const d = fakeDriver({ height: 400 });
    const { captures } = await capturePreviewViewport(d, 'fullhd', vp.fullhd, { segment: 1 }, 0.5);
    expect(captures[0]!.totalHeight).toBe(1080);
    expect(captures[0]!.height).toBe(540);
  });

  it('flags a page taller than the capture limit', async () => {
    const { captures } = await capturePreviewViewport(fakeDriver({ height: 50_000 }), 'fullhd', vp.fullhd, { segment: 1 }, 0.5);
    expect(captures[0]).toMatchObject({ truncated: true, totalHeight: vp.fullhd.capHeight });
  });

  it('a segment past the end is SAID, with how many there are — and nothing is captured', async () => {
    const d = fakeDriver({ height: 3000 });
    const { captures, notes } = await capturePreviewViewport(d, 'fullhd', vp.fullhd, { segment: 4 }, 0.5);
    expect(captures).toEqual([]);
    expect(notes).toEqual([{ viewport: 'fullhd', message: 'there is no segment 4: the page is 3,000px tall here — 2 segments of 2,708px.' }]);
    expect(d.grab).not.toHaveBeenCalled();
  });
});

describe('capturePreviewViewport — one element', () => {
  it('captures the first match at full resolution, in page coordinates, and says how many matched', async () => {
    const d = fakeDriver({ element: { box: { left: 360, top: 3200, width: 1200, height: 900 }, matches: 3 } });
    const { captures, notes } = await capturePreviewViewport(d, 'fullhd', vp.fullhd, { segment: 1, selector: 'section.pricing' }, 0.5);
    expect(notes).toEqual([]);
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ kind: 'element', selector: 'section.pricing', matches: 3, scale: 1, width: 1200, height: 900, totalHeight: 900 });
    expect(captures[0]!.segments).toEqual([{ index: 1, top: 3200, bottom: 4100 }]);
    expect(d.grab).toHaveBeenCalledWith({ left: 360, top: 3200, width: 1200, height: 900 }, 1);
  });

  it('a full-width element is capped at ELEMENT_MAX_WIDTH, and is clipped to the viewport', async () => {
    const d = fakeDriver({ element: { box: { left: -40, top: 0, width: 2000, height: 600 }, matches: 1 } });
    const { captures } = await capturePreviewViewport(d, 'fullhd', vp.fullhd, { segment: 1, selector: 'header' }, 0.5);
    expect(d.grab).toHaveBeenCalledWith({ left: 0, top: 0, width: 1920, height: 600 }, 1280 / 1920);
    expect(captures[0]!.width).toBe(1280);
  });

  it.each([
    ['invalid' as const, '"a[" is not a valid CSS selector.'],
    [{ box: null, matches: 0 }, 'no element matches "a[" at this width.'],
    [{ box: null, matches: 2 }, '"a[" matches 2 elements, but the first has no visible box here (hidden, or zero-sized).'],
    [{ box: null, matches: 1 }, '"a[" matches 1 element, but the first has no visible box here (hidden, or zero-sized).'],
    [{ box: { left: 2400, top: 10, width: 300, height: 300 }, matches: 1 }, 'the first element matching "a[" lies outside the 1920px viewport.'],
  ])('nothing to capture (%j) is a note, not a missing image', async (element, message) => {
    const d = fakeDriver({ element });
    const { captures, notes } = await capturePreviewViewport(d, 'fullhd', vp.fullhd, { segment: 1, selector: 'a[' }, 0.5);
    expect(captures).toEqual([]);
    expect(notes).toEqual([{ viewport: 'fullhd', message }]);
  });

  it('pages through a tall element like a page', async () => {
    const d = fakeDriver({ element: { box: { left: 0, top: 500, width: 960, height: 5000 }, matches: 1 } });
    const { notes } = await capturePreviewViewport(d, 'fullhd', vp.fullhd, { segment: 9, selector: 'main' }, 0.5);
    expect(notes[0]!.message).toBe('there is no segment 9: the element "main" is 5,000px tall here — 4 segments of 1,354px.');
  });
});

describe('captureLegacyShot — the image older clients get', () => {
  it('one whole-page image inside the 2,000px ceiling, dimensions reported in CSS px as before', async () => {
    const d = fakeDriver({ height: 9000 });
    const shot = await captureLegacyShot(d, vp.fullhd, 0.5);
    expect(shot).toMatchObject({ width: 1920, height: 9000, mimeType: 'image/jpeg' });
    const [clip, scale] = d.grab.mock.calls[0]!;
    expect(clip).toEqual({ left: 0, top: 0, width: 1920, height: 9000 });
    expect(Math.round(9000 * (scale as number))).toBe(2000);
  });

  it('caps at the viewport capture limit and never shrinks a short page below the screen', async () => {
    expect((await captureLegacyShot(fakeDriver({ height: 99_999 }), vp.mobile, 0.5)).height).toBe(vp.mobile.capHeight);
    expect((await captureLegacyShot(fakeDriver({ height: 10 }), vp.mobile, 0.5)).height).toBe(vp.mobile.height);
  });
});

describe('withTimeout', () => {
  it('passes a result through, and clears its timer', async () => {
    await expect(withTimeout(Promise.resolve(7), 1_000, 'x')).resolves.toBe(7);
  });

  it('★ rejects a call that never settles — a raw CDP capture has no timeout of its own', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'the capture')).rejects.toThrow('the capture did not finish within 0s');
  });

  it('swallows the abandoned call\'s LATE rejection (closing the page rejects it with nobody listening)', async () => {
    let fail!: (e: Error) => void;
    const late = new Promise<never>((_r, reject) => (fail = reject));
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(withTimeout(late, 10, 'x')).rejects.toThrow(/did not finish/);
      fail(new Error('Target page, context or browser has been closed'));
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
