// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach } from 'vitest';
import { SVG_ANIM_CSS, SVG_ANIM_JS } from '../src/svg-anim.js';
import { SVG_ANIM_MORPH_JS } from '../src/svg-anim-morph.js';

// The REAL shipped stylesheet + runtimes, in a DOM, as a published page runs them. jsdom applies the
// sheet's `prefers-reduced-motion: no-preference` block (it has no matchMedia, so both runtimes run too),
// which is exactly the motion-OK visitor the first-paint hide is for.
//
// Why this exists: the first-paint hide covered EVERY [data-sw-svg] element until the core runtime adds
// .sw-svg-shown — but the core runtime deliberately skips data-sw-svg="morph" (the separate morph runtime
// owns it) and the morph runtime never reveals anything. So a morph shape stayed invisible, tweening
// unseen, until the ~9 s CSS failsafe, while a morph is meant to show its start shape and change it.
const STAR = 'M50 5 L61 39 L97 39 L68 61 L79 95 L50 74 L21 95 L32 61 L3 39 L39 39 Z';
const CIRCLE = 'M50 5 A45 45 0 1 1 49.9 5 Z';

const opacity = (id: string): string => getComputedStyle(document.getElementById(id)!).opacity;
const run = (js: string): void => {
  // Indirect eval of our own trusted build-output constant, in the global scope.
  (0, eval)(js);
};

describe('SVG animation — first-paint hide vs the effects that reveal (jsdom)', () => {
  beforeEach(() => {
    document.head.innerHTML = `<style>${SVG_ANIM_CSS}</style>`;
    document.body.innerHTML =
      '<svg viewBox="0 0 100 100">' +
      `<path id="morph" data-sw-svg="morph" data-sw-svg-to="${CIRCLE}" d="${STAR}"/>` +
      `<path id="morph-load" data-sw-svg="morph" data-sw-svg-trigger="load" data-sw-svg-to="${CIRCLE}" d="${STAR}"/>` +
      `<path id="morph-no-target" data-sw-svg="morph" d="${STAR}"/>` +
      '<circle id="fade" data-sw-svg="fade" cx="50" cy="50" r="40"/>' +
      '<path id="draw" data-sw-svg="draw" d="M10 50 L90 50"/>' +
      '<circle id="along" data-sw-svg="along-path" data-sw-svg-path="M10 10 L90 90" r="6"/>' +
      '<rect id="zoom" data-sw-svg="zoom-in" width="10" height="10"/>' +
      '<rect id="exit" data-sw-svg="fade" data-sw-svg-dir="out" width="10" height="10"/>' +
      '</svg>' +
      `<svg viewBox="0 0 200 100"><g data-sw-svg-scene data-sw-svg-stagger="80"><circle id="scene-a" data-sw-svg="zoom-in" r="9"/><path id="scene-morph" data-sw-svg="morph" data-sw-svg-to="M130 20 L190 20 L190 80 Z" d="M160 20 L190 80 L130 80 Z"/></g></svg>`;
  });

  it('a morph shape is VISIBLE from first paint (its authored d is the start shape)', () => {
    for (const id of ['morph', 'morph-load', 'morph-no-target', 'scene-morph']) expect(opacity(id), id).toBe('1');
  });

  it('…and stays visible once both runtimes have run (nothing later hides it)', () => {
    run(SVG_ANIM_JS);
    run(SVG_ANIM_MORPH_JS);
    for (const id of ['morph', 'morph-load', 'morph-no-target', 'scene-morph']) expect(opacity(id), id).toBe('1');
  });

  it('every OTHER entrance effect is still hidden from first paint until the runtime reveals it', () => {
    for (const id of ['fade', 'draw', 'along', 'zoom', 'scene-a']) expect(opacity(id), id).toBe('0');
    // An exit (out) element starts visible, as before.
    expect(opacity('exit')).toBe('1');
    // Revealed by the class the core runtime adds when it plays them.
    document.getElementById('fade')!.classList.add('sw-svg-shown');
    expect(opacity('fade')).toBe('1');
  });
});
