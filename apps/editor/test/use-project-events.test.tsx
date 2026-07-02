import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProjectEvents, type ContentChange } from '../src/lib/use-project-events';

/** A controllable EventSource: one instance per `new`, capturing 'content' listeners + close calls. */
function stubEventSource() {
  const instances: Array<{ listeners: Array<(e: { data: string }) => void>; closed: boolean }> = [];
  class CtrlEventSource {
    inst = { listeners: [] as Array<(e: { data: string }) => void>, closed: false };
    constructor() {
      instances.push(this.inst);
    }
    addEventListener(_type: string, cb: (e: { data: string }) => void) {
      this.inst.listeners.push(cb);
    }
    close() {
      this.inst.closed = true;
    }
  }
  vi.stubGlobal('EventSource', CtrlEventSource);
  return {
    instances,
    fire: (payload: object) => instances.forEach((i) => i.listeners.forEach((cb) => cb({ data: JSON.stringify(payload) }))),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('useProjectEvents', () => {
  it('shares ONE EventSource per project and dispatches parsed changes to every subscriber', () => {
    const es = stubEventSource();
    const a: ContentChange[] = [];
    const b: ContentChange[] = [];
    const h1 = renderHook(() => useProjectEvents('p1', (c) => a.push(c)));
    const h2 = renderHook(() => useProjectEvents('p1', (c) => b.push(c)));
    // Both subscribers on the SAME project → a single shared connection.
    expect(es.instances).toHaveLength(1);

    es.fire({ kind: 'media', entityId: 'm1', op: 'put', actor: 'agent' });
    expect(a).toEqual([{ kind: 'media', entityId: 'm1', op: 'put', actor: 'agent' }]);
    expect(b).toHaveLength(1);

    // The connection stays open while any subscriber remains, and closes when the last unmounts.
    h1.unmount();
    expect(es.instances[0]!.closed).toBe(false);
    h2.unmount();
    expect(es.instances[0]!.closed).toBe(true);
  });

  it('uses the latest onChange without re-subscribing', () => {
    const es = stubEventSource();
    let seen = 0;
    const { rerender } = renderHook(({ n }: { n: number }) => useProjectEvents('p2', () => (seen = n)), { initialProps: { n: 1 } });
    rerender({ n: 2 });
    expect(es.instances).toHaveLength(1); // no re-subscribe on prop change
    es.fire({ kind: 'page', entityId: 'home', op: 'put' });
    expect(seen).toBe(2); // the latest callback ran
  });
});
