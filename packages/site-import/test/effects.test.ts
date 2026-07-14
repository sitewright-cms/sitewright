import { describe, expect, it } from 'vitest';
import { detectImportedEffects, mapAosAnimation } from '../src/transform/effects.js';

describe('detectImportedEffects', () => {
  it('maps a preloader overlay to preloaderEffect (type inferred from markers)', () => {
    expect(detectImportedEffects({ cssText: '.preloader{position:fixed}', pageHtml: '<div class="preloader"></div>' }).preloaderEffect).toBe('spinner');
    expect(detectImportedEffects({ cssText: '', pageHtml: '<div class="loading-overlay"><div class="loading-bar"></div></div>' }).preloaderEffect).toBe('bars');
    expect(detectImportedEffects({ cssText: '', pageHtml: '<div class="page-loader"><span class="dot"></span><span class="dot"></span></div>' }).preloaderEffect).toBe('dots');
  });

  it('does NOT invent a preloader from a stray utility class', () => {
    expect(detectImportedEffects({ cssText: '.btn.loader{}', pageHtml: '<span class="loader"></span>' }).preloaderEffect).toBeUndefined();
  });

  it('trusts the transform preloaderRemoved signal even when the markup is already gone', () => {
    expect(detectImportedEffects({ cssText: '', pageHtml: '', preloaderRemoved: true }).preloaderEffect).toBe('spinner');
  });

  it('maps Materialize waves-effect / ripple to a native buttonEffect', () => {
    expect(detectImportedEffects({ cssText: '', pageHtml: '<a class="btn waves-effect">x</a>' }).buttonEffect).toBe('fill-center');
    expect(detectImportedEffects({ cssText: '.mdc-ripple-surface{}', pageHtml: '' }).buttonEffect).toBe('fill-center');
    expect(detectImportedEffects({ cssText: '', pageHtml: '<a class="btn">x</a>' }).buttonEffect).toBeUndefined();
  });

  it('maps a scroll-shrink header to stickyHeader:shrink, a plain fixed header to pinned', () => {
    expect(detectImportedEffects({ cssText: '', scripts: 'if(scrollY>50)nav.classList.add("navbar-shrink")', pageHtml: '' }).stickyHeader).toBe('shrink');
    expect(detectImportedEffects({ cssText: '#main-nav{position:fixed;top:0}', pageHtml: '' }).stickyHeader).toBe('pinned');
    expect(detectImportedEffects({ cssText: '', pageHtml: '<nav class="navbar navbar-fixed-top">x</nav>' }).stickyHeader).toBe('pinned');
    // a static header → nothing invented
    expect(detectImportedEffects({ cssText: '.navbar{background:#fff}', pageHtml: '<nav class="navbar">x</nav>' }).stickyHeader).toBeUndefined();
  });

  it('returns an empty object when there is no signal', () => {
    expect(detectImportedEffects({ cssText: 'body{color:#000}', pageHtml: '<p>hi</p>' })).toEqual({});
  });
});

describe('mapAosAnimation', () => {
  it('maps a direct AOS effect + duration/delay to the sw primitives', () => {
    expect(mapAosAnimation({ 'data-aos': 'fade-up', 'data-aos-duration': '800', 'data-aos-delay': '200' })).toEqual({ animation: 'fade-up', duration: '800', delay: '200' });
  });

  it('collapses a compound AOS direction to the primary sw effect', () => {
    expect(mapAosAnimation({ 'data-aos': 'fade-up-right' })).toEqual({ animation: 'fade-up' });
    expect(mapAosAnimation({ 'data-aos': 'zoom-in-up' })).toEqual({ animation: 'zoom-in' });
  });

  it('falls back to base fade for an unknown effect, clamps out-of-range timing', () => {
    expect(mapAosAnimation({ 'data-aos': 'sparkle-explode' })).toEqual({ animation: 'fade' });
    expect(mapAosAnimation({ 'data-aos': 'fade', 'data-aos-duration': '99999' })).toEqual({ animation: 'fade', duration: '4000' });
  });

  it('returns null when there is no data-aos attribute', () => {
    expect(mapAosAnimation({ class: 'x' })).toBeNull();
  });
});
