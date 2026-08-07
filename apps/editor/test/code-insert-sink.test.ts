import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasCodeInsertSink,
  insertIntoCode,
  registerCodeInsertSink,
  resetCodeInsertSink,
  subscribeCodeInsertSink,
} from '../src/lib/code-insert-sink';

afterEach(() => resetCodeInsertSink());

describe('code insert sink', () => {
  it('reports no target until an editor registers', () => {
    expect(hasCodeInsertSink()).toBe(false);
    expect(insertIntoCode('text-sm')).toBe(false);
  });

  it('routes an insertion to the registered editor', () => {
    const insert = vi.fn();
    registerCodeInsertSink(insert);
    expect(hasCodeInsertSink()).toBe(true);
    expect(insertIntoCode('text-sm')).toBe(true);
    expect(insert).toHaveBeenCalledWith('text-sm');
  });

  it('clears the target on unregister', () => {
    const unregister = registerCodeInsertSink(vi.fn());
    unregister();
    expect(hasCodeInsertSink()).toBe(false);
  });

  it('survives a remount whose cleanup runs AFTER the new registration', () => {
    // React can run (new effect → old cleanup) in that order. If unregister cleared unconditionally,
    // the live editor would be left with no sink and the Insert button would go dead for good.
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerCodeInsertSink(first);
    registerCodeInsertSink(second);
    unregisterFirst();

    expect(hasCodeInsertSink()).toBe(true);
    insertIntoCode('p-4');
    expect(second).toHaveBeenCalledWith('p-4');
    expect(first).not.toHaveBeenCalled();
  });

  it('notifies subscribers when a target appears and disappears', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeCodeInsertSink(onChange);
    const unregister = registerCodeInsertSink(vi.fn());
    expect(onChange).toHaveBeenCalledTimes(1);
    unregister();
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
    registerCodeInsertSink(vi.fn());
    expect(onChange).toHaveBeenCalledTimes(2); // no longer listening
  });
});
