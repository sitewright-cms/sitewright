import { describe, it, expect } from 'vitest';
import type { PageNode } from '@sitewright/schema';
import {
  ANIMATION_CSS,
  ANIMATION_JS,
  ANIMATION_EFFECTS,
  usesAnimations,
  treeUsesAnimations,
} from '../src/animations.js';

describe('animation stylesheet', () => {
  it('gates ALL motion behind prefers-reduced-motion: no-preference', () => {
    expect(ANIMATION_CSS.startsWith('@media (prefers-reduced-motion: no-preference){')).toBe(true);
    expect(ANIMATION_CSS.trimEnd().endsWith('}')).toBe(true);
  });

  it('hides content ONLY via the runtime-added .aos-init class (PE: no-JS renders visible)', () => {
    // Every opacity:0 rule must be gated on .aos-init — never a bare [data-aos]
    // selector, which would hide content when the runtime doesn't run.
    for (const line of ANIMATION_CSS.split('\n')) {
      if (line.includes('opacity:0')) expect(line).toContain('.aos-init');
    }
    expect(ANIMATION_CSS).not.toMatch(/\[data-aos\]\s*\{/); // ungated base selector
  });

  it('defines an initial transform for every directional effect (plain fade is the base rule)', () => {
    for (const effect of ANIMATION_EFFECTS) {
      if (effect === 'fade') continue; // base rule, no dedicated transform
      expect(ANIMATION_CSS).toContain(`[data-aos="${effect}"].aos-init{transform:`);
    }
  });

  it('reveals via .aos-animate as the LAST rule (wins the order tie at equal specificity)', () => {
    const reveal = ANIMATION_CSS.indexOf('[data-aos].aos-animate');
    expect(reveal).toBeGreaterThan(-1);
    expect(ANIMATION_CSS).toContain('opacity:1;pointer-events:auto;transform:none');
    // No effect rule after the reveal rule.
    expect(ANIMATION_CSS.slice(reveal)).not.toContain('.aos-init{');
  });

  it('suspends pointer-events while hidden (invisible content must not be clickable)', () => {
    expect(ANIMATION_CSS).toContain('pointer-events:none');
  });

  it('cannot break out of a <style> block', () => {
    expect(ANIMATION_CSS.toLowerCase()).not.toContain('</style');
  });
});

describe('animation runtime', () => {
  it('bails out without IntersectionObserver and under prefers-reduced-motion', () => {
    expect(ANIMATION_JS).toContain("'IntersectionObserver' in window");
    expect(ANIMATION_JS).toContain('(prefers-reduced-motion: reduce)');
  });

  it('speaks the real AOS class protocol (aos-init / aos-animate)', () => {
    expect(ANIMATION_JS).toContain("classList.add('aos-init')");
    expect(ANIMATION_JS).toContain("classList.add('aos-animate')");
  });

  it('clamps delay/duration and resolves easing through a fixed allowlist (no style injection)', () => {
    expect(ANIMATION_JS).toContain('Math.max(0,Math.min(v,5000))');
    expect(ANIMATION_JS).toContain('parseInt');
    expect(ANIMATION_JS).toContain('isNaN(v)?0'); // non-numeric attribute → no inline style at all
    // Easing values resolve through a NULL-PROTOTYPE map, so a hostile key
    // ('constructor', 'toString') misses instead of resolving to an inherited
    // member; the attribute string itself is never assigned to a style property.
    expect(ANIMATION_JS).toContain('var EASINGS=Object.create(null)');
    expect(ANIMATION_JS).not.toMatch(/style\.transitionTimingFunction=el\.getAttribute/);
  });

  it('replays only when data-aos-once="false"; unobserves otherwise (AOS default)', () => {
    expect(ANIMATION_JS).toContain("getAttribute('data-aos-once')!=='false'");
    expect(ANIMATION_JS).toContain('io.unobserve(el)');
  });

  it('cannot break out of a <script> block', () => {
    expect(ANIMATION_JS.toLowerCase()).not.toContain('</script');
  });
});

describe('animation detection', () => {
  it('detects data-aos in an authored HTML/template string', () => {
    expect(usesAnimations('<div data-aos="fade-up">x</div>')).toBe(true);
    expect(usesAnimations('<div class="card">plain</div>')).toBe(false);
    expect(usesAnimations('')).toBe(false);
    expect(usesAnimations(undefined)).toBe(false);
    expect(usesAnimations(null)).toBe(false);
  });

  it('detects data-aos in a string prop anywhere in a block tree (the raw Html embed)', () => {
    const animated: PageNode = {
      id: 'r',
      type: 'Section',
      children: [
        { id: 'h', type: 'Heading', props: { text: 'Hi' } },
        {
          id: 'wrap',
          type: 'Section',
          children: [{ id: 'e', type: 'Html', props: { html: '<div data-aos="zoom-in">Z</div>' } }],
        },
      ],
    };
    expect(treeUsesAnimations(animated)).toBe(true);
  });

  it('ignores trees without data-aos and non-string props', () => {
    const plain: PageNode = {
      id: 'r',
      type: 'Section',
      props: { count: 3, enabled: true },
      children: [{ id: 'h', type: 'Heading', props: { text: 'Hello' } }],
    };
    expect(treeUsesAnimations(plain)).toBe(false);
  });
});
