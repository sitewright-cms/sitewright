import { describe, it, expect } from 'vitest';
import { SW_READY_EVENT, SW_READY_CORE, SW_TIMING_CORE } from '../src/timing.js';

describe('shared timing / ready gate', () => {
  it('defines swMs (parse+clamp) — embeddable, parses as a function body', () => {
    expect(SW_TIMING_CORE).toContain('function swMs(');
    expect(() => new Function(SW_TIMING_CORE)).not.toThrow();
  });

  it('SW_READY_EVENT is the documented sw:ready signal', () => {
    expect(SW_READY_EVENT).toBe('sw:ready');
  });

  it('swWhenReady waits for the preloader when present, else runs immediately, with a failsafe', () => {
    expect(SW_READY_CORE).toContain('function swWhenReady(');
    // only waits when a preloader is still loading; otherwise runs cb now
    expect(SW_READY_CORE).toContain("querySelector('[data-sw-preloader]')");
    expect(SW_READY_CORE).toContain("contains('loading')");
    expect(SW_READY_CORE).toContain(`addEventListener('${SW_READY_EVENT}'`);
    expect(SW_READY_CORE).toContain('setTimeout(fire,9000)'); // failsafe — never strand animations
    expect(SW_READY_CORE).toContain('}else{cb();}'); // no active preloader → immediate
    expect(() => new Function(SW_READY_CORE)).not.toThrow();
  });
});
