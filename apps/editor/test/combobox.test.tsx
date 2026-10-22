import { afterEach, describe, expect, it } from 'vitest';
import { placeList } from '../src/views/ui/combobox';

/** Where a picker's list goes, for a field at `rect` in a 1024×768 window (jsdom's). */
function fieldAt(rect: { left: number; top: number; width: number; height?: number }): HTMLElement {
  const el = document.createElement('button');
  const height = rect.height ?? 36;
  el.getBoundingClientRect = () =>
    ({ ...rect, height, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + height, toJSON: () => ({}) }) as DOMRect;
  return el;
}

const realWidth = window.innerWidth;
afterEach(() => Object.defineProperty(window, 'innerWidth', { value: realWidth, configurable: true }));

describe('placeList', () => {
  it('opens under a field with room below, as wide as the field', () => {
    expect(placeList(fieldAt({ left: 100, top: 100, width: 400 }))).toEqual({ left: 100, top: 136, width: 400, maxHeight: 320, above: false });
  });

  it('widens the list of a narrow field, and keeps it inside the window', () => {
    const p = placeList(fieldAt({ left: 900, top: 100, width: 120 }));
    expect(p.width).toBe(256);
    expect(p.left).toBe(1024 - 256 - 8);
  });

  it('opens above a field near the bottom of the window', () => {
    const p = placeList(fieldAt({ left: 10, top: 700, width: 300 }));
    expect(p).toMatchObject({ above: true, top: 700, maxHeight: 320 });
  });

  it('is never wider than the window', () => {
    Object.defineProperty(window, 'innerWidth', { value: 240, configurable: true });
    expect(placeList(fieldAt({ left: 50, top: 100, width: 100 }))).toMatchObject({ left: 8, width: 224 });
  });
});
