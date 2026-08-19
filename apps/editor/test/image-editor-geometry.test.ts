import { describe, it, expect } from 'vitest';
import {
  addTurn,
  clampRect,
  fitScale,
  rectFromPoints,
  resizeRect,
  rotateRect,
  roundRect,
  turnedSize,
  type Rect,
} from '../src/views/library/image-editor-geometry';

/**
 * The Image Editor's geometry. Every case here is one an author would only notice by SAVING the
 * wrong pixels — a selection that drifts when the picture is turned, a box that escapes its image at
 * an edge, a corner drag that inverts the rectangle. None of it shows up in a screenshot.
 */

const size = { width: 400, height: 300 };

describe('turnedSize / addTurn', () => {
  it('a quarter-turn transposes the presented size; a half-turn does not', () => {
    expect(turnedSize(size, 90)).toEqual({ width: 300, height: 400 });
    expect(turnedSize(size, 270)).toEqual({ width: 300, height: 400 });
    expect(turnedSize(size, 180)).toEqual({ width: 400, height: 300 });
    expect(turnedSize(size, 0)).toEqual({ width: 400, height: 300 });
  });

  it('turns wrap in both directions', () => {
    expect(addTurn(270, 90)).toBe(0);
    expect(addTurn(0, -90)).toBe(270);
    expect(addTurn(90, -90)).toBe(0);
  });
});

describe('rotateRect — the selection follows the PICTURE, not the screen', () => {
  it('four quarter-turns return the box exactly where it started', () => {
    // The drift test: a rounding slip of one pixel per turn is invisible once but ruins a crop that
    // was nudged into place and then rotated.
    const start: Rect = { x: 30, y: 20, w: 120, h: 60 };
    let rect = start;
    let s = size;
    for (let i = 0; i < 4; i += 1) {
      rect = rotateRect(rect, s, 90);
      s = turnedSize(s, 90);
    }
    expect(rect).toEqual(start);
  });

  it('a box in the TOP-LEFT lands in the TOP-RIGHT after a clockwise quarter-turn', () => {
    const rect = rotateRect({ x: 0, y: 0, w: 100, h: 50 }, size, 90);
    const turned = turnedSize(size, 90); // 300×400
    expect(rect).toEqual({ x: 250, y: 0, w: 50, h: 100 });
    // …and is still inside the turned image.
    expect(rect.x + rect.w).toBeLessThanOrEqual(turned.width);
    expect(rect.y + rect.h).toBeLessThanOrEqual(turned.height);
  });

  it('anticlockwise is the exact inverse of clockwise', () => {
    const start: Rect = { x: 12, y: 34, w: 56, h: 78 };
    const cw = rotateRect(start, size, 90);
    expect(rotateRect(cw, turnedSize(size, 90), -90)).toEqual(start);
  });
});

describe('clampRect', () => {
  it('slides a box back inside instead of shrinking it at the edge', () => {
    expect(clampRect({ x: 390, y: 10, w: 100, h: 50 }, size)).toEqual({ x: 300, y: 10, w: 100, h: 50 });
    expect(clampRect({ x: -50, y: -50, w: 100, h: 50 }, size)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });

  it('collapses a box larger than the image to the image, and never to nothing', () => {
    expect(clampRect({ x: 0, y: 0, w: 9999, h: 9999 }, size)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    const tiny = clampRect({ x: 0, y: 0, w: 0, h: 0 }, size);
    expect(tiny.w).toBeGreaterThan(0);
    expect(tiny.h).toBeGreaterThan(0);
  });
});

describe('rectFromPoints / resizeRect', () => {
  it('a drag in ANY direction yields a positive rect', () => {
    expect(rectFromPoints(100, 100, 40, 30)).toEqual({ x: 40, y: 30, w: 60, h: 70 });
    expect(rectFromPoints(40, 30, 100, 100)).toEqual({ x: 40, y: 30, w: 60, h: 70 });
  });

  it('★ a corner dragged PAST its opposite flips the box instead of inverting it', () => {
    // Without normalisation this produces a negative width, which paints as nothing and saves as a
    // 400 from the endpoint — an error the author cannot connect to what they did.
    const out = resizeRect({ x: 100, y: 100, w: 50, h: 50 }, 'nw', 120, 120, size);
    expect(out.w).toBeGreaterThan(0);
    expect(out.h).toBeGreaterThan(0);
    expect(out).toEqual({ x: 150, y: 150, w: 70, h: 70 });
  });

  it('resizing stays inside the image', () => {
    const out = resizeRect({ x: 300, y: 200, w: 90, h: 90 }, 'se', 500, 500, size);
    expect(out.x + out.w).toBeLessThanOrEqual(size.width);
    expect(out.y + out.h).toBeLessThanOrEqual(size.height);
  });

  it('move keeps the box the same SIZE when it hits an edge', () => {
    const out = resizeRect({ x: 350, y: 10, w: 40, h: 40 }, 'move', 200, 0, size);
    expect(out).toEqual({ x: 360, y: 10, w: 40, h: 40 });
  });
});

describe('roundRect', () => {
  it('rounds to whole pixels without losing or gaining a row at the far edge', () => {
    // The endpoint rejects fractions; rounding origin and extent independently is how a crop ends up
    // one pixel outside the image.
    expect(roundRect({ x: 10.4, y: 10.6, w: 20.3, h: 20.3 })).toEqual({ x: 10, y: 11, w: 21, h: 20 });
    const r = roundRect({ x: 0.5, y: 0.5, w: 399.5, h: 299.5 });
    expect(r.x + r.w).toBe(400);
    expect(r.y + r.h).toBe(300);
  });
});

describe('fitScale', () => {
  it('fits the long side and never enlarges past 1:1', () => {
    expect(fitScale({ width: 800, height: 600 }, { width: 400, height: 400 })).toBe(0.5);
    expect(fitScale({ width: 100, height: 100 }, { width: 400, height: 400 })).toBe(1);
  });

  it('survives a zero-sized image without dividing by it', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 400, height: 400 })).toBe(1);
  });
});
