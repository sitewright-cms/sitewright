import { describe, it, expect } from 'vitest';
import {
  SVG_ANIM_CSS,
  SVG_ANIM_JS,
  SVG_ANIM_NOSCRIPT,
  SVG_ANIM_EFFECTS,
  SVG_ANIM_LIMITS,
  usesSvgAnim,
} from '../src/svg-anim.js';
import { SW_DURATION_DEFAULT } from '../src/timing.js';

describe('SVG animation stylesheet', () => {
  it('hides from FIRST PAINT until revealed (no FOUC), only inside prefers-reduced-motion:no-preference', () => {
    // Hidden until the runtime adds .sw-svg-shown; OUT (exit) elements start visible; reduced-motion never
    // hides (rule sits inside the no-preference media query).
    expect(SVG_ANIM_CSS).toContain('@media (prefers-reduced-motion: no-preference){');
    expect(SVG_ANIM_CSS).toContain('[data-sw-svg]:not([data-sw-svg-dir="out"]):not(.sw-svg-shown){opacity:0}');
    // No UNGATED hide of the base selector (must live inside the no-preference media query).
    expect(SVG_ANIM_CSS).not.toMatch(/\[data-sw-svg\]\s*\{[^}]*opacity:0/);
  });

  it('is PE-first: an un-armed element (JS off / runtime failed) self-reveals via a failsafe', () => {
    expect(SVG_ANIM_CSS).toContain('[data-sw-svg]:not(.sw-svg-armed):not(.sw-svg-shown):not([data-sw-svg-dir="out"]){animation:sw-svg-failsafe');
    expect(SVG_ANIM_CSS).toContain('@keyframes sw-svg-failsafe{to{opacity:1}}');
  });

  it('sets transform-box:fill-box so % translate + transform-origin resolve per-element (viewBox-safe)', () => {
    expect(SVG_ANIM_CSS).toContain('transform-box:fill-box');
  });

  it('cannot break out of a <style> block', () => {
    expect(SVG_ANIM_CSS.toLowerCase()).not.toContain('</style');
  });
});

describe('SVG animation runtime', () => {
  it('bails entirely under prefers-reduced-motion (never hides, never animates)', () => {
    expect(SVG_ANIM_JS).toContain('(prefers-reduced-motion: reduce)');
    // The reduced-motion return precedes ANY arming/reveal, so content stays visible + nothing runs.
    const idxBail = SVG_ANIM_JS.indexOf('(prefers-reduced-motion: reduce)');
    const idxArm = SVG_ANIM_JS.indexOf("classList.add('sw-svg-armed')");
    expect(idxBail).toBeGreaterThan(-1);
    expect(idxArm).toBeGreaterThan(idxBail);
  });

  it('starts the reveal only when the page is READY (preloader clear / load) via swWhenReady', () => {
    expect(SVG_ANIM_JS).toContain('function swWhenReady('); // embedded shared gate
    expect(SVG_ANIM_JS).toContain("addEventListener('sw:ready'");
    expect(SVG_ANIM_JS).toContain('swWhenReady(function(){'); // trigger phase is gated
  });

  it('drives the draw effect with getTotalLength + stroke-dashoffset', () => {
    expect(SVG_ANIM_JS).toContain('getTotalLength');
    expect(SVG_ANIM_JS).toContain('strokeDashoffset');
    expect(SVG_ANIM_JS).toContain('strokeDasharray');
  });

  it('animates via the Web Animations API, not a scroll/rAF loop', () => {
    expect(SVG_ANIM_JS).toContain('.animate(');
  });

  it('allowlists the effect keyword (unknown → fade) — never trusts the raw attribute', () => {
    expect(SVG_ANIM_JS).toContain("return 'fade'");
    // The effect list is serialized into the runtime for the membership check.
    expect(SVG_ANIM_JS).toContain(JSON.stringify(SVG_ANIM_EFFECTS));
  });

  it('clamps duration to SVG_ANIM_LIMITS and reads timing via the shared swMs helper', () => {
    expect(SVG_ANIM_JS).toContain(`var DMIN=${SVG_ANIM_LIMITS.duration.min},DMAX=${SVG_ANIM_LIMITS.duration.max}`);
    expect(SVG_ANIM_JS).toContain(`swMs(el,'data-sw-duration',${SW_DURATION_DEFAULT})`); // shared default (450)
    expect(SVG_ANIM_JS).toContain('function swMs('); // embedded from timing.ts
  });

  it('gates view-triggered units behind one IntersectionObserver (off-screen SVGs do no work)', () => {
    expect(SVG_ANIM_JS).toContain("'IntersectionObserver' in window");
    expect(SVG_ANIM_JS).toContain('io.observe(u.root)');
  });

  it('orchestrates scenes with a clamped stagger step and honours data-sw-once for replay', () => {
    expect(SVG_ANIM_JS).toContain("swMs(s,'data-sw-svg-stagger',0)");
    expect(SVG_ANIM_JS).toContain(`if(step>${SVG_ANIM_LIMITS.stagger.max})step=${SVG_ANIM_LIMITS.stagger.max}`); // stagger clamped to the advertised limit
    expect(SVG_ANIM_JS).toContain("getAttribute('data-sw-once')!=='false'");
    expect(SVG_ANIM_JS).toContain('resetUnit'); // replay path re-hides members
  });

  it('a scene also honours the whole-SVG click + loop directives (like a global root)', () => {
    expect(SVG_ANIM_JS).toContain("replay:!once(s),click:boolAttr(s,'data-sw-svg-click'),loopMs:loopMsOf(s)");
  });

  it('a standalone (non-scene) element uses its OWN data-sw-svg-trigger (no dead scene-attr check)', () => {
    expect(SVG_ANIM_JS).toContain('trigger:trig,members:buildMembers(el,0)');
    expect(SVG_ANIM_JS).not.toContain("root:el,trigger:el.getAttribute('data-sw-svg-scene-trigger')");
  });

  it('blur: short fade (opacity done by 20%) with the defocus spanning the full duration', () => {
    // 3-keyframe form: opacity reaches 1 at offset 0.2 while filter blur(40px)→blur(0px) spans 0..1.
    expect(SVG_ANIM_JS).toContain("{opacity:0,filter:'blur(40px)',offset:0},{opacity:1,offset:0.2},{filter:'blur(0px)',offset:1}");
    // the old 2-frame form (opacity + blur BOTH over the full duration) is gone
    expect(SVG_ANIM_JS).not.toContain("f.filter='blur(40px)';t.filter='blur(0px)'");
  });

  it('OUT (exit) reversal flips explicit keyframe offsets so a multi-stop effect (blur) reverses correctly', () => {
    expect(SVG_ANIM_JS).toContain('rc.offset=1-rf.offset');
  });

  it('draw on a non-strokable container expands to one draw member per drawable descendant (not a group fade)', () => {
    expect(SVG_ANIM_JS).toContain('function drawMembers(el,extraDelay)');
    expect(SVG_ANIM_JS).toContain("el.querySelectorAll('path,line,polyline,polygon,circle,ellipse,rect')");
    // only a DRAW on a container with no outline of its own expands; descendants inherit its settings + draw
    expect(SVG_ANIM_JS).toContain("effectOf(el)==='draw'&&svgLen(el)===0");
    expect(SVG_ANIM_JS).toContain("effect:'draw'");
    // a descendant that carries its OWN directive animates as itself (skipped by the expansion)
    expect(SVG_ANIM_JS).toContain("if(k.getAttribute('data-sw-svg'))return;");
    // container revealed on play AFTER members set their hidden from-frame → no flash of the finished art…
    expect(SVG_ANIM_JS).toContain('function unitContainers(u)');
    expect(SVG_ANIM_JS).toContain("s.c.classList.add('sw-svg-shown')");
    // …and the reveal is DEFERRED by the member delay (stagger / data-sw-delay) so it doesn't show early
    expect(SVG_ANIM_JS).toContain('s.c.__swRevealT=setTimeout(');
  });

  it('validates data-sw-svg-origin against an allowlist pattern (no style injection)', () => {
    expect(SVG_ANIM_JS).toMatch(/\/\^\[a-z- \]\{1,20\}\$\//);
  });

  it('cannot break out of a <script> block', () => {
    expect(SVG_ANIM_JS.toLowerCase()).not.toContain('</script');
  });
});

describe('SVG animation global (whole-SVG) settings', () => {
  it('CSS adds responsive (fill parent), click cursor, and a reduced-motion-safe ripple', () => {
    expect(SVG_ANIM_CSS).toContain('svg[data-sw-svg-responsive]{width:100%;height:auto;max-width:100%}');
    expect(SVG_ANIM_CSS).toContain('svg[data-sw-svg-click],[data-sw-svg-scene][data-sw-svg-click]{cursor:pointer}');
    expect(SVG_ANIM_CSS).toContain('@keyframes sw-svg-ripple');
    // ripple only animates when motion is allowed
    expect(SVG_ANIM_CSS).toContain('@media (prefers-reduced-motion: no-preference){.sw-svg-ripple{animation:sw-svg-ripple');
    expect(SVG_ANIM_CSS).toContain('@media (prefers-reduced-motion: reduce){.sw-svg-ripple{display:none}}');
  });

  it('treats a root <svg> with any global directive as ONE coordinated unit', () => {
    expect(SVG_ANIM_JS).toContain('function hasGlobal(svg)');
    expect(SVG_ANIM_JS).toContain("svg.hasAttribute('data-sw-svg-trigger')");
    expect(SVG_ANIM_JS).toContain("svg.hasAttribute('data-sw-svg-replay')");
    expect(SVG_ANIM_JS).toContain("svg.hasAttribute('data-sw-svg-click')");
    expect(SVG_ANIM_JS).toContain("svg.hasAttribute('data-sw-svg-loop')");
    // the unit carries replay/click/loop pulled from the root svg
    expect(SVG_ANIM_JS).toContain("replay:boolAttr(svg,'data-sw-svg-replay'),click:boolAttr(svg,'data-sw-svg-click'),loopMs:loopMsOf(svg)");
  });

  it('finds the subtree ROOT svg too (so an inlined <img data-sw-svg> svg gets its global settings), root first', () => {
    expect(SVG_ANIM_JS).toContain('function svgRoots(root)');
    expect(SVG_ANIM_JS).toContain("String(root.tagName).toLowerCase()==='svg'");
    expect(SVG_ANIM_JS).toContain('list.unshift(root)'); // outer/inlined root wins over any nested <svg>
  });

  it('back-compat: a SELF-animated root <svg> (data-sw-svg on the svg) is NOT a global container', () => {
    // Else it would double-process (standalone element + global unit) and override its own per-element trigger.
    expect(SVG_ANIM_JS).toContain("function hasGlobal(svg){if(svg.hasAttribute('data-sw-svg'))return false");
  });

  it('the auto-repeat loop self-clears when its root leaves the document (no timer leak)', () => {
    expect(SVG_ANIM_JS).toContain('if(!document.contains(u.root)){u.timer=null;return;}');
  });

  it('click-to-replay resets the loop countdown + ripple, without breaking the IO first-entry guard', () => {
    expect(SVG_ANIM_JS).toContain('function swRipple(');
    // shown → triggerUnit (re-arms the loop); pre-view click → replayUnit only (must NOT set u.shown, else
    // the IntersectionObserver's `if(!u.shown)` first-entry branch would be skipped for view-trigger units).
    expect(SVG_ANIM_JS).toContain("if(u.shown){triggerUnit(u,false);}else{replayUnit(u);}swRipple(e,u.root);");
  });

  it('auto-repeat loop is a self-rescheduling timeout re-armed by EVERY trigger (not a fixed interval)', () => {
    expect(SVG_ANIM_JS).toContain('var LOOP_MIN=500,LOOP_MAX=600000');
    expect(SVG_ANIM_JS).toContain('function loopMsOf(el)');
    expect(SVG_ANIM_JS).toContain('function armLoop(u)');
    expect(SVG_ANIM_JS).toContain('function triggerUnit(u,first)'); // load / click / scroll-in all re-sync the loop
    expect(SVG_ANIM_JS).not.toContain('setInterval('); // the old fixed interval is gone
    // the period is clamped so it is NEVER shorter than the full timeline (a short loop can't cut a slow draw)
    expect(SVG_ANIM_JS).toContain('Math.max(u.loopMs,u.totalMs+250)');
    expect(SVG_ANIM_JS).toContain("if(m.effect==='draw')d+=Math.max(140,m.dur*0.28)"); // totalMs includes the draw's fill tail
  });

  it('re-arms scroll replay on a FULL exit (ratio 0) so it fires from ANY scroll direction', () => {
    // play on meaningful visibility, re-arm (reset) only when fully out — direction-agnostic.
    expect(SVG_ANIM_JS).toContain('entry.intersectionRatio>=0.15');
    expect(SVG_ANIM_JS).toContain('entry.intersectionRatio===0');
    expect(SVG_ANIM_JS).toContain('threshold:[0,0.15]');
    // the old single-threshold bottom-margin observer is gone
    expect(SVG_ANIM_JS).not.toContain("{threshold:0.15,rootMargin:'0px 0px -10% 0px'}");
  });
});

describe('SVG animation detection + surface', () => {
  it('detects the data-sw-svg marker in authored HTML', () => {
    expect(usesSvgAnim('<svg><path data-sw-svg="draw"/></svg>')).toBe(true);
    expect(usesSvgAnim('<svg data-sw-svg-scene><path data-sw-svg="fade"/></svg>')).toBe(true);
    expect(usesSvgAnim('<div class="card">plain</div>')).toBe(false);
    expect(usesSvgAnim('')).toBe(false);
    expect(usesSvgAnim(undefined)).toBe(false);
    expect(usesSvgAnim(null)).toBe(false);
  });

  it('the marker does NOT collide with the entrance engine (data-sw-animation)', () => {
    // Critical: data-sw-svg must not be a substring of data-sw-animation (it isn't), else the
    // SVG runtime would ship on every entrance page.
    expect('data-sw-animation'.includes('data-sw-svg')).toBe(false);
  });

  it('exposes a stable, allowlisted effect vocabulary incl. draw, scale/expand, reveals, along-path + morph', () => {
    for (const e of ['draw', 'fade-up', 'flip-x', 'scale-tl', 'scale-c', 'expand-x', 'expand-b', 'along-path', 'reveal-right', 'reveal-iris', 'morph']) {
      expect(SVG_ANIM_EFFECTS).toContain(e);
    }
    expect(new Set(SVG_ANIM_EFFECTS).size).toBe(SVG_ANIM_EFFECTS.length); // no dupes
  });

  it('draw-then-fill: hides the fill during the draw, then reveals it (not shown throughout)', () => {
    expect(SVG_ANIM_JS).toContain('function svgDraw('); // draw setup path
    expect(SVG_ANIM_JS).toContain("fillOpacity='0'"); // fill hidden while drawing
    expect(SVG_ANIM_JS).toContain('function svgFillReveal('); // reveal AFTER the stroke draws
    expect(SVG_ANIM_JS).toContain('Math.max(140,m.dur*0.28)'); // snappy fill-in (was 0.4 / floor 200)
    expect(SVG_ANIM_JS).toContain('data-sw-svg-draw-color'); // author stroke color/width
    expect(SVG_ANIM_JS).toContain('data-sw-svg-draw-width');
  });

  it('the temp-stroke fade-out is stored + cancelled so a LOOP/replay draw stroke is not held invisible', () => {
    // A fire-and-forget fill:'both' stroke-opacity fade would linger holding stroke-opacity:0 → the next
    // loop/click/scroll draw runs but the LINE is invisible. It must be stored (m.strokeAnim) + cancelled.
    expect(SVG_ANIM_JS).toContain('m.strokeAnim=m.el.animate([{strokeOpacity:1},{strokeOpacity:0}]');
    expect(SVG_ANIM_JS).toContain('if(m.strokeAnim){try{m.strokeAnim.cancel();}catch(e){}m.strokeAnim=null;}'); // cleared on finish + on replay
  });

  it('supports an OUT (exit) direction: starts visible (excluded from the hide), plays natural→hidden', () => {
    expect(SVG_ANIM_JS).toContain("data-sw-svg-dir')==='out'");
    expect(SVG_ANIM_JS).toContain('if(m.io===');
    // OUT elements are excluded from the first-paint hide in CSS (they start visible).
    expect(SVG_ANIM_CSS).toContain(':not([data-sw-svg-dir="out"]):not(.sw-svg-shown){opacity:0}');
  });

  it('drives reveals via clip-path and along-path via CSS offset-path, with validated path data', () => {
    expect(SVG_ANIM_JS).toContain('SVG_REVEAL');
    expect(SVG_ANIM_JS).toContain('clipPath');
    expect(SVG_ANIM_JS).toContain('offsetPath');
    expect(SVG_ANIM_JS).toContain('offsetDistance');
    // author path-data is grammar-validated before it reaches CSS.
    expect(SVG_ANIM_JS).toMatch(/MmLlHhVvCcSsQqTtAaZz/);
  });

  it('leaves morph to the separate morph runtime (the core skips data-sw-svg="morph")', () => {
    expect(SVG_ANIM_JS).toContain('isMorph');
    expect(SVG_ANIM_JS).toContain("getAttribute('data-sw-svg')==='morph'");
  });

  it('inlines a SAME-ORIGIN <img data-sw-svg src> and animates it (excludes imgs from the effect set)', () => {
    expect(SVG_ANIM_JS).toContain('function runSvgAnim(root)'); // reusable per-subtree runner
    expect(SVG_ANIM_JS).toContain("img[data-sw-svg]");
    expect(SVG_ANIM_JS).toContain('function isImg('); // imgs are inline targets, never effect elements
    expect(SVG_ANIM_JS).toContain('u.origin!==location.origin'); // SAME-ORIGIN ONLY (XSS guard)
    expect(SVG_ANIM_JS).toContain("dispatchEvent(new CustomEvent('sw-svg-inlined'"); // notify morph runtime
    expect(SVG_ANIM_JS).toContain('function stripUnsafe('); // strip script/foreignObject/on*
  });

  it('shows an <img data-sw-svg> immediately (static fallback) — it is never armed by a unit', () => {
    // The first-paint hide matches <img data-sw-svg>; since imgs are excluded from units they would stay
    // hidden (cross-origin / failed fetch / no-fetch). inlineImgs marks them armed+shown up front, BEFORE
    // the fetch-availability early return, so they stay visible either way.
    expect(SVG_ANIM_JS).toContain("img.classList.add('sw-svg-armed');img.classList.add('sw-svg-shown')");
    const idxArm = SVG_ANIM_JS.indexOf("img.classList.add('sw-svg-shown')");
    const idxFetchGuard = SVG_ANIM_JS.indexOf("if(!('fetch' in window))return");
    expect(idxArm).toBeGreaterThan(-1);
    expect(idxArm).toBeLessThan(idxFetchGuard);
  });

  it('exports a no-JS un-hide override (for the build to emit inside <noscript>)', () => {
    expect(SVG_ANIM_NOSCRIPT).toBe('[data-sw-svg]{opacity:1!important;animation:none!important}');
    expect(SVG_ANIM_NOSCRIPT.toLowerCase()).not.toContain('</style');
  });
});
