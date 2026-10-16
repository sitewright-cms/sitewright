import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { setWebsiteData } = vi.hoisted(() => ({ setWebsiteData: vi.fn() }));
vi.mock('../src/api', () => ({ api: { setWebsiteData: (...a: unknown[]) => setWebsiteData(...a) } }));

import { useWebsiteDataQueue } from '../src/lib/website-data-queue';

/**
 * The one website.data write path behind BOTH editors (page and chrome slot). The store is site-wide
 * and the preview renders the SAVED value, so three things have to hold: writes land in the order they
 * were made, a re-render waits until the queue has drained, and the `</>` view can still see a value
 * that has left the queue but is not on screen yet.
 */
describe('useWebsiteDataQueue', () => {
  /** Writes not yet let land, oldest first. */
  let inFlight: Array<{ path: string; value: string; land: () => void; fail: (e: Error) => void }>;
  const onError = vi.fn();
  const onDrained = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    inFlight = [];
    onError.mockReset();
    onDrained.mockReset();
    setWebsiteData.mockReset();
    setWebsiteData.mockImplementation(
      (_p: string, path: string, value: string) =>
        new Promise<void>((resolve, reject) => inFlight.push({ path, value, land: resolve, fail: reject })),
    );
  });
  afterEach(() => vi.useRealTimers());

  const mount = () => renderHook(() => useWebsiteDataQueue({ projectId: 'p', onError, onDrained }));
  const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
  const landNext = () => act(async () => inFlight.shift()!.land());
  const sent = () => inFlight.map((w) => `${w.path}=${w.value}`);

  it('coalesces typing per leaf and saves it after the pause — re-rendering nothing unless asked', async () => {
    const { result } = mount();
    act(() => {
      result.current.queue('note', 'H');
      result.current.queue('note', 'Hello');
    });
    await tick(599);
    expect(setWebsiteData).not.toHaveBeenCalled();
    await tick(1);
    expect(sent()).toEqual(['note=Hello']);
    await landNext();
    expect(onDrained).not.toHaveBeenCalled(); // typing is already on screen
  });

  it('★ one write at a time, in order: a later flush waits for the one in flight', async () => {
    const { result } = mount();
    act(() => result.current.queue('about', 'First'));
    await tick(600);
    act(() => result.current.queue('about', 'Second'));
    await tick(600);
    expect(sent()).toEqual(['about=First']); // the newer value cannot overtake the older one

    await landNext();
    expect(sent()).toEqual(['about=Second']);
  });

  it('★ re-renders ONCE, after the whole queue has drained — not once per flush', async () => {
    const { result } = mount();
    act(() => result.current.queue('note', 'typed', { rerender: true }));
    await tick(600);
    act(() => result.current.commit([['logo', '/new.webp']])); // saved NOW, behind the typed write
    await tick(0);
    expect(sent()).toEqual(['note=typed']);

    await landNext();
    expect(onDrained).not.toHaveBeenCalled(); // the logo is still queued behind it
    await landNext();
    expect(onDrained).toHaveBeenCalledTimes(1);
  });

  it('commit pulls pending typing along, so the re-render shows it too', async () => {
    const { result } = mount();
    act(() => {
      result.current.queue('note', 'typed');
      result.current.commit([['logo', '/new.webp']]);
    });
    await tick(0);
    expect(sent()).toEqual(['note=typed']);
    await landNext();
    expect(sent()).toEqual(['logo=/new.webp']);
  });

  it('a failed write is reported, forgotten, and re-renders nothing', async () => {
    const { result } = mount();
    act(() => result.current.commit([['logo', '/new.webp']]));
    await tick(0);
    expect(result.current.latest('logo')).toBe('/new.webp');
    await act(async () => inFlight.shift()!.fail(new Error('offline')));
    expect(onError).toHaveBeenCalledWith('Website data not saved: offline');
    expect(result.current.latest('logo')).toBeUndefined(); // the store, and the render, still hold the old one
    expect(onDrained).not.toHaveBeenCalled();
  });

  it('latest(): the queued value first, then the one sent — until a render that reflects it is on screen', async () => {
    const { result } = mount();
    act(() => result.current.queue('about', 'Queued'));
    expect(result.current.latest('about')).toBe('Queued');
    await tick(600);
    expect(result.current.latest('about')).toBe('Queued'); // in flight: still ours, not yet rendered

    const before = result.current.landedMark(); // a render that started BEFORE it landed…
    await landNext();
    act(() => result.current.rendered(before));
    expect(result.current.latest('about')).toBe('Queued'); // …does not show it

    const after = result.current.landedMark(); // one that started after it landed does
    act(() => result.current.rendered(after));
    expect(result.current.latest('about')).toBeUndefined();
  });

  it('on unmount, still writes what was queued — behind the write in flight, and with no callbacks', async () => {
    const { result, unmount } = mount();
    act(() => result.current.queue('about', 'Draft', { rerender: true }));
    await tick(600);
    act(() => result.current.queue('about', 'Final', { rerender: true }));
    unmount();
    await tick(0);
    expect(sent()).toEqual(['about=Draft']);
    await landNext();
    expect(sent()).toEqual(['about=Final']);
    await landNext();
    expect(onDrained).not.toHaveBeenCalled();
  });
});
