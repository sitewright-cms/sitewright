import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __resetUnsavedWork,
  hasUnsavedWork,
  registerUnsavedWork,
  unsavedLabels,
} from '../src/lib/unsaved-work';

/**
 * The point of the registry is that LEAVING the page is guarded — a reload, a tab close, a
 * back-navigation. Every editor already refused to close on unsaved work; none of them stopped the page
 * going away underneath it, which is what made the library's "Reload the editor" button a hazard.
 */
describe('unsaved-work guard', () => {
  let add: ReturnType<typeof vi.spyOn>;
  let remove: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetUnsavedWork();
    add = vi.spyOn(window, 'addEventListener');
    remove = vi.spyOn(window, 'removeEventListener');
  });
  afterEach(() => {
    add.mockRestore();
    remove.mockRestore();
    __resetUnsavedWork();
  });

  const beforeUnloadCalls = (spy: ReturnType<typeof vi.spyOn>): number =>
    spy.mock.calls.filter((c: unknown[]) => c[0] === 'beforeunload').length;

  it('arms the guard for the first dirty surface only', () => {
    const releaseA = registerUnsavedWork('A');
    const releaseB = registerUnsavedWork('B');
    // One listener covers every surface — arming per surface would prompt once per editor.
    expect(beforeUnloadCalls(add)).toBe(1);
    expect(hasUnsavedWork()).toBe(true);
    releaseA();
    releaseB();
  });

  it('disarms only once the LAST dirty surface releases', () => {
    const releaseA = registerUnsavedWork('A');
    const releaseB = registerUnsavedWork('B');
    releaseA();
    expect(beforeUnloadCalls(remove)).toBe(0); // B is still dirty — leaving must still be guarded
    expect(hasUnsavedWork()).toBe(true);
    releaseB();
    expect(beforeUnloadCalls(remove)).toBe(1);
    expect(hasUnsavedWork()).toBe(false);
  });

  it('keeps two instances of the same editor apart', () => {
    // Keyed by identity, not by label: closing one entry editor must not unguard the other.
    const first = registerUnsavedWork('Dataset entry');
    const second = registerUnsavedWork('Dataset entry');
    first();
    expect(hasUnsavedWork()).toBe(true);
    second();
    expect(hasUnsavedWork()).toBe(false);
  });

  it('names each dirty surface once, so a caller can say what is at stake', () => {
    const a = registerUnsavedWork('Page editor');
    const b = registerUnsavedWork('Page editor');
    const c = registerUnsavedWork('HTML source');
    expect(unsavedLabels().sort()).toEqual(['HTML source', 'Page editor']);
    a(); b(); c();
  });

  it('prevents the default on beforeunload while dirty', () => {
    const release = registerUnsavedWork('Page editor');
    const handler = add.mock.calls.find((c: unknown[]) => c[0] === 'beforeunload')?.[1] as (e: Event) => void;
    const event = new Event('beforeunload', { cancelable: true });
    handler(event);
    expect(event.defaultPrevented).toBe(true);
    release();
  });
});
