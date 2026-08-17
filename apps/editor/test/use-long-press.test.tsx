import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { LONG_PRESS_MS, LONG_PRESS_SLOP_PX, useLongPress } from '../src/lib/use-long-press';

// Long-press is the touch equivalent of right-click. Its whole difficulty is telling a deliberate
// hold apart from the START OF A SCROLL — on a list, every scroll begins as a finger resting on a row.
// Fire too eagerly and the menu pops open every time someone flicks the list.

function Target({ onLongPress }: { onLongPress: (x: number, y: number) => void }) {
  const handlers = useLongPress(onLongPress);
  return (
    <div data-testid="row" {...handlers}>
      row
    </div>
  );
}

const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });

let fired: Array<[number, number]>;
beforeEach(() => {
  vi.useFakeTimers();
  fired = [];
});
afterEach(() => {
  vi.useRealTimers();
});

const row = () => screen.getByTestId('row');
const press = (x = 100, y = 200) => fireEvent.touchStart(row(), touch(x, y));
const moveTo = (x: number, y: number) => fireEvent.touchMove(row(), touch(x, y));
const release = () => fireEvent.touchEnd(row(), touch(0, 0));
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('useLongPress', () => {
  beforeEach(() => {
    render(<Target onLongPress={(x, y) => fired.push([x, y])} />);
  });

  it('fires after the hold threshold, reporting where the finger was', () => {
    press(140, 260);
    wait(LONG_PRESS_MS + 10);
    expect(fired).toEqual([[140, 260]]);
  });

  it('does NOT fire before the threshold', () => {
    press();
    wait(LONG_PRESS_MS - 50);
    expect(fired).toEqual([]);
  });

  it('★ is cancelled by a scroll — a finger that MOVES was never a long press', () => {
    press(100, 200);
    wait(LONG_PRESS_MS - 100);
    moveTo(100, 200 + LONG_PRESS_SLOP_PX + 5); // the list starts scrolling under the finger
    wait(500);
    expect(fired, 'a scroll must not open the menu').toEqual([]);
  });

  it('tolerates a small wobble — a steady finger is never perfectly still', () => {
    press(100, 200);
    moveTo(100 + Math.floor(LONG_PRESS_SLOP_PX / 2), 200 + 1);
    wait(LONG_PRESS_MS + 10);
    expect(fired).toHaveLength(1);
  });

  it('is cancelled by lifting the finger early (that is a tap)', () => {
    press();
    wait(LONG_PRESS_MS - 100);
    release();
    wait(500);
    expect(fired).toEqual([]);
  });

  it('does not fire twice for one hold, and rearms for the next', () => {
    press();
    wait(LONG_PRESS_MS + 200);
    release();
    expect(fired).toHaveLength(1);

    press(10, 20);
    wait(LONG_PRESS_MS + 10);
    expect(fired).toHaveLength(2);
  });

  it('ignores a multi-touch gesture (that is a pinch/zoom, not a press)', () => {
    fireEvent.touchStart(row(), { touches: [{ clientX: 1, clientY: 2 }, { clientX: 50, clientY: 60 }] });
    wait(LONG_PRESS_MS + 10);
    expect(fired).toEqual([]);
  });
});
