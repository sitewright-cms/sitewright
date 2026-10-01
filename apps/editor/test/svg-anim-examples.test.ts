import { describe, it, expect } from 'vitest';
import { SVG_ANIM_EFFECTS, SVG_ANIM_LIMITS } from '@sitewright/blocks';
import { SVG_ANIM_EXAMPLES } from '../src/views/library/svg-anim-examples';
import { parseSvg } from '../src/views/library/svg-studio-helpers';

/** Every example, parsed the same way the Studio parses an import. */
const parsed = SVG_ANIM_EXAMPLES.map((ex) => {
  const svg = parseSvg(ex.svg);
  if (!svg) throw new Error(`${ex.id} does not parse`);
  return { ex, svg };
});

describe('SVG_ANIM_EXAMPLES', () => {
  it('ships several examples with unique ids and names', () => {
    expect(SVG_ANIM_EXAMPLES.length).toBeGreaterThanOrEqual(4);
    expect(new Set(SVG_ANIM_EXAMPLES.map((e) => e.id)).size).toBe(SVG_ANIM_EXAMPLES.length);
    expect(new Set(SVG_ANIM_EXAMPLES.map((e) => e.name)).size).toBe(SVG_ANIM_EXAMPLES.length);
    for (const e of SVG_ANIM_EXAMPLES) expect(e.uses.length).toBeGreaterThan(2);
  });

  it.each(parsed)('$ex.id survives the Studio importer and has a viewBox', ({ svg }) => {
    // parseSvg is the sanitizer the Studio runs on every import — an example that cannot pass it
    // would arrive stripped, which is exactly the kind of thing that only shows up at runtime.
    expect(svg.getAttribute('viewBox')).toMatch(/^[\d.\s-]+$/);
  });

  it.each(parsed)('$ex.id is a COMPOSITION, not a one-shape snippet', ({ svg }) => {
    // The point of replacing the old snippets: each of these has to show a dozen elements sharing
    // one timeline, which is the thing a copy-paste directive could never demonstrate.
    expect(svg.querySelectorAll('[data-sw-svg]').length).toBeGreaterThanOrEqual(6);
  });

  it.each(parsed)('$ex.id staggers from a scene on an inner <g>, never the root', ({ svg }) => {
    // ★ The scene MUST be on an inner <g>. The engine finds scenes with querySelectorAll, which does
    // not match the subtree root itself — so a scene authored on the root <svg> is silently skipped
    // when the engine is handed that <svg> as its root (the inlined-<img> path).
    expect(svg.hasAttribute('data-sw-svg-scene')).toBe(false);
    const scenes = svg.querySelectorAll('g[data-sw-svg-scene]');
    expect(scenes.length).toBe(1);
    const scene = scenes[0]!;
    const step = Number(scene.getAttribute('data-sw-svg-stagger'));
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThanOrEqual(SVG_ANIM_LIMITS.stagger.max);
    // Replay + click live on the SCENE, not the root: a global root unit would find every element
    // already claimed by the scene and animate nothing.
    expect(scene.getAttribute('data-sw-once')).toBe('false');
    // The literal string, not mere presence: the engine reads it as `getAttribute(…) === 'true'`.
    expect(scene.getAttribute('data-sw-svg-click')).toBe('true');
    const loop = Number(scene.getAttribute('data-sw-svg-loop'));
    expect(loop).toBeGreaterThan(0);
  });

  it.each(parsed)('$ex.id only uses effects the engine implements', ({ svg }) => {
    const effects = [...svg.querySelectorAll('[data-sw-svg]')].map((el) => el.getAttribute('data-sw-svg'));
    expect(effects.length).toBeGreaterThan(0);
    for (const e of effects) expect(SVG_ANIM_EFFECTS).toContain(e);
  });

  it.each(parsed)('$ex.id keeps every duration and delay inside the engine limits', ({ svg }) => {
    for (const el of svg.querySelectorAll('[data-sw-svg]')) {
      for (const [attr, lim] of [
        ['data-sw-duration', SVG_ANIM_LIMITS.duration],
        ['data-sw-delay', SVG_ANIM_LIMITS.delay],
      ] as const) {
        const raw = el.getAttribute(attr);
        if (raw === null) continue;
        const ms = Number(raw);
        expect(Number.isFinite(ms)).toBe(true);
        expect(ms).toBeGreaterThanOrEqual(lim.min);
        expect(ms).toBeLessThanOrEqual(lim.max);
      }
    }
  });

  it.each(parsed)('$ex.id carries the data each effect needs to do anything', ({ svg }) => {
    for (const el of svg.querySelectorAll('[data-sw-svg]')) {
      const effect = el.getAttribute('data-sw-svg');
      // `draw` needs a strokable geometry element — on a plain <g> or <text> it silently degrades
      // to a fade, which is the single easiest way to author a dead example.
      if (effect === 'draw') {
        expect(['path', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'rect']).toContain(el.tagName.toLowerCase());
        expect(el.getAttribute('stroke')).toBeTruthy();
      }
      // `along-path` without a path attribute animates nothing at all.
      if (effect === 'along-path') expect(el.getAttribute('data-sw-svg-path')).toBeTruthy();
    }
  });

  it.each(parsed)('$ex.id carries no script, event handler or external reference', ({ ex, svg }) => {
    expect(svg.querySelector('script')).toBeNull();
    expect(ex.svg).not.toMatch(/\son[a-z]+=/i);
    expect(ex.svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
});
