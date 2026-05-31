import { describe, it, expect, vi } from 'vitest';
import { ProjectEventBus, type ContentChange } from '../src/events/bus.js';

const change: ContentChange = { kind: 'page', entityId: 'home', op: 'put' };

describe('ProjectEventBus', () => {
  it('delivers a project’s changes only to that project’s subscribers', () => {
    const bus = new ProjectEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe('proj-a', a);
    bus.subscribe('proj-b', b);
    bus.emit('proj-a', change);
    expect(a).toHaveBeenCalledWith(change);
    expect(b).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe and cleans up the project bucket', () => {
    const bus = new ProjectEventBus();
    const fn = vi.fn();
    const off = bus.subscribe('p', fn);
    expect(bus.subscriberCount('p')).toBe(1);
    off();
    expect(bus.subscriberCount('p')).toBe(0);
    bus.emit('p', change);
    expect(fn).not.toHaveBeenCalled();
  });

  it('emit with no subscribers is a no-op', () => {
    const bus = new ProjectEventBus();
    expect(() => bus.emit('nobody', change)).not.toThrow();
  });

  it('isolates a throwing subscriber from the others', () => {
    const bus = new ProjectEventBus();
    const boom = vi.fn(() => {
      throw new Error('listener blew up');
    });
    const ok = vi.fn();
    bus.subscribe('p', boom);
    bus.subscribe('p', ok);
    expect(() => bus.emit('p', change)).not.toThrow();
    expect(ok).toHaveBeenCalledWith(change);
  });

  it('tolerates a subscriber that unsubscribes during emit', () => {
    const bus = new ProjectEventBus();
    const seen: string[] = [];
    const off1 = bus.subscribe('p', () => {
      seen.push('one');
      off1(); // remove self mid-emit
    });
    bus.subscribe('p', () => seen.push('two'));
    bus.emit('p', change);
    expect(seen).toEqual(['one', 'two']);
    expect(bus.subscriberCount('p')).toBe(1);
  });
});
