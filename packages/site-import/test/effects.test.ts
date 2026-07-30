import { describe, expect, it } from 'vitest';
import { detectImportedEffects, mapAosAnimation } from '../src/transform/effects.js';

describe('detectImportedEffects', () => {
  it('maps a preloader overlay to preloaderEffect (type inferred from markers)', () => {
    expect(detectImportedEffects({ cssText: '.preloader{position:fixed}', pageHtml: '<div class="preloader"></div>' }).preloaderEffect).toBe('spinner');
    expect(detectImportedEffects({ cssText: '', pageHtml: '<div class="loading-overlay"><div class="loading-bar"></div></div>' }).preloaderEffect).toBe('bars');
    expect(detectImportedEffects({ cssText: '', pageHtml: '<div class="page-loader"><span class="dot"></span><span class="dot"></span></div>' }).preloaderEffect).toBe('dots');
  });

  // Measured against the real business.na source: a spinning RING that imported as `bars`, because the
  // old classifier searched the whole site (css + scripts + every page's markup) for the word "bar".
  it('classifies a spinning RING as a spinner even when the page says "bar" elsewhere', () => {
    const cssText = [
      '.loader{border:1.1em solid rgba(255,255,255,.2);border-left:1.1em solid #fff;border-radius:50%;animation:load8 1.1s infinite linear}',
      '@keyframes load8{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}',
      '.navbar .bar{height:2px}', // an unrelated rule that used to decide the answer
    ].join('\n');
    const pageHtml = '<div class="preloader"><div class="loader"></div></div><div class="menu-bar">bars</div>';
    expect(detectImportedEffects({ cssText, pageHtml }).preloaderEffect).toBe('spinner');
  });

  it('only reads the LOADER\'s own rules and markup, not the rest of the site', () => {
    // The word "bar"/"dot" outside the loader's subtree must not classify it.
    const far = '<div class="preloader"><div class="loader"></div></div>' + '<p>x</p>'.repeat(200) + '<div class="progress-bar"></div>';
    expect(detectImportedEffects({ cssText: '.preloader{position:fixed}', pageHtml: far }).preloaderEffect).toBe('spinner');
    // …but a bar INSIDE the loader still wins.
    expect(
      detectImportedEffects({ cssText: '.preloader{position:fixed}', pageHtml: '<div class="preloader"><span class="progress-bar"></span></div>' }).preloaderEffect,
    ).toBe('bars');
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
