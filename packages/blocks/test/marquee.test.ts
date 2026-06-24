import { describe, expect, it } from 'vitest';
import { MARQUEE_CSS, MARQUEE_MARKER, usesMarquee } from '../src/marquee.js';

describe('marquee (CSS-only logo marquee)', () => {
  it('detects the data-sw-marquee marker (and ignores nullish/absent)', () => {
    expect(usesMarquee('<div data-sw-marquee><div class="sw-marquee-track"></div></div>')).toBe(true);
    expect(usesMarquee('<div class="hero"></div>')).toBe(false);
    expect(usesMarquee('')).toBe(false);
    expect(usesMarquee(null)).toBe(false);
    expect(usesMarquee(undefined)).toBe(false);
    expect(MARQUEE_MARKER).toBe('data-sw-marquee');
  });

  it('ships the keyframe, the track animation, a uniform logo height, and a reduced-motion fallback', () => {
    expect(MARQUEE_CSS).toContain('@keyframes sw-marquee');
    expect(MARQUEE_CSS).toContain('translateX(-50%)'); // wraps after one full set (items rendered twice)
    expect(MARQUEE_CSS).toContain('.sw-marquee-track{');
    expect(MARQUEE_CSS).toContain('animation:sw-marquee');
    expect(MARQUEE_CSS).toContain('.sw-marquee-item img{height:var(--sw-marquee-height'); // height-locked logos
    expect(MARQUEE_CSS).toContain('prefers-reduced-motion');
    expect(MARQUEE_CSS).toContain('animation-play-state:paused'); // pauses on hover
  });

  it('exposes the speed presets used by the widget data-speed select', () => {
    expect(MARQUEE_CSS).toContain('[data-speed="Slow"]');
    expect(MARQUEE_CSS).toContain('[data-speed="Fast"]');
  });
});
