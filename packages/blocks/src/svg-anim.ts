// SVG animation engine: a first-party runtime for animating INDIVIDUAL SVG sub-elements (paths,
// groups, shapes, text) — the complement to the entrance engine (`data-sw-animation`, which reveals
// a whole DOM box) and the parallax engine (scroll-linked drift). Its reason to exist is the effects
// those can't express: stroke DRAW-ON, per-element staggered SCENES, and (later phases) mask reveals,
// motion along a path, and shape MORPH.
//
//   data-sw-svg="draw"                    the effect (see SVG_ANIM_EFFECTS)
//   data-sw-svg-trigger="view|load"       when it plays (default: view — on scroll-in)
//   data-sw-svg-draw-dir="normal|reverse" draw direction (draw effect only)
//   data-sw-svg-fill="true"               fade the fill in AFTER the stroke draws (draw effect only)
//   data-sw-svg-origin="center|top|…"     transform pivot for scale/zoom/flip (default center)
//
// SCENES — a container orchestrates its descendants with a stagger:
//   data-sw-svg-scene                     an orchestration root
//   data-sw-svg-stagger="80"              ms between successive children (DOM order)
//   data-sw-svg-scene-trigger="view|load" trigger for the whole scene (children inherit)
//
// TIMING is the SHARED vocabulary (timing.ts), identical to the entrance engine:
//   data-sw-duration (default 400) · data-sw-delay · data-sw-easing · data-sw-once
//
// Authored as plain attributes in code-first sources, snippets, inline SVGs, or {{sw-icon}} output.
// Tenants supply DATA only (effect keyword allowlisted, numerics clamped); never JavaScript.
//
// Invariants (shared with parallax.ts / animations.ts):
// - PE-first: the hidden pre-play state is gated on the runtime-added `.sw-svg-init` class, so no JS /
//   no IntersectionObserver / reduced motion → every element renders at its natural, fully-visible
//   state (a fully-drawn path, an untransformed shape). Content is NEVER hidden without JS.
// - Accessibility: ALL motion is JS-applied and the runtime BAILS entirely under
//   prefers-reduced-motion: reduce (nothing is hidden, nothing animates).
// - Performance: effects run on the Web Animations API (compositor-friendly transform/opacity/filter);
//   view-triggered units are gated by one IntersectionObserver, so off-screen SVGs do no work.
// - First-party, audited, static code only.
import { SW_TIMING_ATTRS, SW_DURATION_DEFAULT, SW_TIMING_CORE } from './timing.js';

/** Clamp ranges shared by the runtime, the editor builder, and tests. */
export const SVG_ANIM_LIMITS = {
  /** per-element / scene-inherited animation length (ms). */
  duration: { min: 0, max: 20000 },
  /** start delay + per-child scene stagger step (ms). */
  delay: { min: 0, max: 20000 },
  stagger: { min: 0, max: 5000 },
} as const;

/** The effect keywords. Unknown/blank → a plain opacity `fade` (never broken). `morph` (Phase 4) needs
 *  the separate svg-anim-morph runtime; every other effect runs in the core runtime here. */
export const SVG_ANIM_EFFECTS: readonly string[] = [
  'draw',
  'fade',
  'fade-up',
  'fade-down',
  'fade-left',
  'fade-right',
  'zoom-in',
  'zoom-out',
  'flip-x',
  'flip-y',
  'blur',
  // Scale from a named origin (Enliven'em "scale*"): grows from that anchor.
  'scale-c', 'scale-t', 'scale-b', 'scale-l', 'scale-r', 'scale-tl', 'scale-tr', 'scale-bl', 'scale-br',
  // Expand along one axis from 0 (Enliven'em "expand*").
  'expand-x', 'expand-y', 'expand-t', 'expand-b', 'expand-l', 'expand-r',
  // Motion path (CSS offset-path): travels along data-sw-svg-path, optionally rotating to face it.
  'along-path',
  // Mask / clip reveals (CSS clip-path): a wipe or iris that uncovers the element in place.
  'reveal-right',
  'reveal-left',
  'reveal-down',
  'reveal-up',
  'reveal-iris',
  // SVG path MORPH (Phase 4 — svg-anim-morph runtime): tween the `d` toward data-sw-svg-to.
  'morph',
];

/** A permissive-but-safe SVG path-data grammar (commands + numbers + separators). Used to validate
 *  author-supplied `data-sw-svg-path` / `data-sw-svg-to` so only a real path string reaches CSS/`d`.
 *  The `-` is intentionally the LAST char in the class (a literal hyphen) — keep it last so it can never
 *  form an unintended range. No quote / paren / semicolon / backslash is admitted, so a validated value
 *  cannot break out of `offsetPath: path('…')` or an attribute. (Same grammar mirrored in the runtimes.) */
export const SVG_PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\s+-]{1,4000}$/;

// --- CSS --------------------------------------------------------------------
// Structural only — the MOTION is JS-applied via WAAPI, so it never sits in the sheet. `transform-box:
// fill-box` makes CSS transform percentages + `transform-origin` resolve against each element's OWN
// bounding box (viewBox-scale-independent). The hidden state is gated on `.sw-svg-init` (runtime-added)
// so a no-JS / reduced-motion visitor sees the natural, fully-visible artwork.
export const SVG_ANIM_CSS = [
  '[data-sw-svg]{transform-box:fill-box;transform-origin:center}',
  '@media (prefers-reduced-motion: no-preference){[data-sw-svg].sw-svg-init{opacity:0}}',
].join('');

// --- shared runtime core ----------------------------------------------------
// Embedded verbatim in BOTH the production runtime and the builder-preview runtime so the two can
// never drift: timing parse (swMs), the easing allowlist (swEase — CSS keywords + spring curves),
// the per-effect keyframe builder (svgFrames), stroke length (svgLen), and the play/reset helpers.
const SVG_ANIM_CORE = `
  ${SW_TIMING_CORE}
  var SVG_EASE=Object.create(null);
  SVG_EASE['linear']='linear';SVG_EASE['ease']='ease';SVG_EASE['ease-in']='ease-in';
  SVG_EASE['ease-out']='ease-out';SVG_EASE['ease-in-out']='ease-in-out';
  SVG_EASE['back']='cubic-bezier(0.34,1.56,0.64,1)';
  SVG_EASE['bounce']='linear(0,0.012,0.05,0.113,0.2,0.313,0.45,0.612,0.8,0.65,0.522,0.412,0.325,0.262,0.225,0.212,0.225,0.288,0.375,0.487,0.625,0.788,0.975,0.887,0.837,0.825,0.85,0.912,1)';
  SVG_EASE['elastic']='linear(0,0.218,0.427,0.616,0.774,0.892,0.966,1,1.002,0.994,0.986,0.984,0.988,0.995,1.001,1.003,1.002,1.001,1)';
  function swEase(el){return SVG_EASE[el.getAttribute('${SW_TIMING_ATTRS.easing}')||'']||'ease-out';}
  // A shape's outline length for the draw effect; 0 when the element isn't strokable (falls back to fade).
  function svgLen(el){try{var l=el.getTotalLength?el.getTotalLength():0;return (l&&isFinite(l))?l:0;}catch(e){return 0;}}
  var SVG_TF=Object.create(null);
  SVG_TF['fade-up']='translate(0,18%)';SVG_TF['fade-down']='translate(0,-18%)';
  SVG_TF['fade-left']='translate(18%,0)';SVG_TF['fade-right']='translate(-18%,0)';
  SVG_TF['zoom-in']='scale(0.6)';SVG_TF['zoom-out']='scale(1.18)';
  SVG_TF['flip-x']='perspective(600px) rotateX(90deg)';SVG_TF['flip-y']='perspective(600px) rotateY(90deg)';
  // Scale from a named origin (all scale(0.6)); value = transform-origin.
  var SVG_SCALE=Object.create(null);
  SVG_SCALE['scale-c']='center';SVG_SCALE['scale-t']='center top';SVG_SCALE['scale-b']='center bottom';
  SVG_SCALE['scale-l']='left center';SVG_SCALE['scale-r']='right center';
  SVG_SCALE['scale-tl']='left top';SVG_SCALE['scale-tr']='right top';SVG_SCALE['scale-bl']='left bottom';SVG_SCALE['scale-br']='right bottom';
  // Expand along one axis from 0; value = [from-transform, transform-origin].
  var SVG_EXPAND=Object.create(null);
  SVG_EXPAND['expand-x']=['scaleX(0)','center'];SVG_EXPAND['expand-y']=['scaleY(0)','center'];
  SVG_EXPAND['expand-l']=['scaleX(0)','left center'];SVG_EXPAND['expand-r']=['scaleX(0)','right center'];
  SVG_EXPAND['expand-t']=['scaleY(0)','center top'];SVG_EXPAND['expand-b']=['scaleY(0)','center bottom'];
  // Clip-path reveals: [from (clipped) → to (full)]. inset order is top right bottom left.
  var SVG_REVEAL=Object.create(null);
  SVG_REVEAL['reveal-right']=['inset(0 100% 0 0)','inset(0px)'];
  SVG_REVEAL['reveal-left']=['inset(0 0 0 100%)','inset(0px)'];
  SVG_REVEAL['reveal-down']=['inset(0 0 100% 0)','inset(0px)'];
  SVG_REVEAL['reveal-up']=['inset(100% 0 0 0)','inset(0px)'];
  SVG_REVEAL['reveal-iris']=['circle(0%)','circle(75%)'];
  // DRAW setup — hide the fill + apply an outline stroke for a FILLED shape (draw-then-fill: the fill is
  // revealed only AFTER the outline finishes drawing), then return the stroke-dash keyframes. A pure
  // line-art shape (no fill) just draws its own stroke.
  function svgDraw(m){
    var len=m.len;if(!(len>0))return [{opacity:0},{opacity:1}]; // non-strokable → graceful fade
    m.el.style.strokeDasharray=len+'px';
    var cs=window.getComputedStyle(m.el);
    var noFill=(!cs.fill||cs.fill==='none'||cs.fill==='transparent'||cs.fill.indexOf('rgba(0, 0, 0, 0)')>-1);
    if(m.fill||!noFill){
      m.drawFill=true;m.el.style.fillOpacity='0';
      var hasStroke=(cs.stroke&&cs.stroke!=='none'&&cs.stroke.indexOf('rgba(0, 0, 0, 0)')<0);
      var col=m.el.getAttribute('data-sw-svg-draw-color');
      if(col&&/^[#a-zA-Z0-9(). ,%-]{1,40}$/.test(col)){m.el.style.stroke=col;m.tempStroke=!hasStroke;}
      else if(!hasStroke){m.el.style.stroke='currentColor';m.tempStroke=true;}
      var w=m.el.getAttribute('data-sw-svg-draw-width');
      if(w&&/^[0-9.]{1,6}$/.test(w))m.el.style.strokeWidth=w;else if(!hasStroke)m.el.style.strokeWidth='2';
    }
    var a=(m.dir==='reverse'?-len:len);
    return [{strokeDashoffset:a+'px'},{strokeDashoffset:'0px'}];
  }
  // Build the entrance [from,to] WAAPI keyframes for one member (in-direction). svgPlay reverses them for
  // an OUT (exit) direction. Effects set any needed inline base (dash / offset-path / transform-origin).
  function svgFrames(m){
    if(m.effect==='draw')return svgDraw(m);
    if(m.effect.indexOf('reveal-')===0){var rv=SVG_REVEAL[m.effect];if(rv)return [{clipPath:rv[0]},{clipPath:rv[1]}];return [{opacity:0},{opacity:1}];}
    if(m.effect==='along-path'){if(m.path){m.el.style.offsetPath="path('"+m.path+"')";m.el.style.offsetRotate=(m.rotate==='0')?'0deg':'auto';return [{offsetDistance:'0%'},{offsetDistance:'100%'}];}return [{opacity:0},{opacity:1}];}
    if(SVG_SCALE[m.effect]!==undefined){m.el.style.transformOrigin=SVG_SCALE[m.effect];return [{opacity:0,transform:'scale(0.6)'},{opacity:1,transform:'none'}];}
    if(SVG_EXPAND[m.effect]!==undefined){var ex=SVG_EXPAND[m.effect];m.el.style.transformOrigin=ex[1];return [{opacity:0,transform:ex[0]},{opacity:1,transform:'none'}];}
    var f={opacity:0},t={opacity:1};
    if(m.effect==='blur'){f.filter='blur(6px)';t.filter='blur(0px)';}
    var tf=SVG_TF[m.effect];
    if(tf){f.transform=tf;
      // Flips interpolate to their OWN identity (perspective + rotate 0); translate/scale tween to 'none'.
      t.transform=(m.effect==='flip-x')?'perspective(600px) rotateX(0deg)':(m.effect==='flip-y')?'perspective(600px) rotateY(0deg)':'none';}
    return [f,t];
  }
  // Clear any inline styles WAAPI/effects left behind so the element rests at its authored natural state.
  function svgClear(el){el.style.transform='';el.style.opacity='';el.style.filter='';el.style.strokeDasharray='';el.style.strokeDashoffset='';el.style.strokeOpacity='';el.style.fillOpacity='';el.style.clipPath='';el.style.offsetPath='';el.style.offsetDistance='';el.style.offsetRotate='';}
  // draw-then-fill finish: fade the fill in; fade + remove a TEMP outline stroke (one we added).
  function svgFillReveal(m){
    m.el.style.fillOpacity='0';var dur2=Math.max(200,m.dur*0.4);
    try{var fa=m.el.animate([{fillOpacity:0},{fillOpacity:1}],{duration:dur2,fill:'both'});m.fillAnim=fa;
      fa.onfinish=function(){try{fa.cancel();}catch(e){}m.el.style.fillOpacity='';m.el.style.strokeDasharray='';m.el.style.strokeDashoffset='';if(m.tempStroke){m.el.style.stroke='';m.el.style.strokeWidth='';m.el.style.strokeOpacity='';}};}
    catch(e){m.el.style.fillOpacity='';}
    if(m.tempStroke){try{m.el.animate([{strokeOpacity:1},{strokeOpacity:0}],{duration:dur2,fill:'both'});}catch(e){}}
  }
  function svgPlay(m){
    if(m.playing)return;m.playing=true;
    if(m.origin)m.el.style.transformOrigin=m.origin;
    m.el.classList.remove('sw-svg-init');
    var frames;try{frames=svgFrames(m);}catch(e){svgClear(m.el);return;}
    if(m.io==='out')frames=[frames[1],frames[0]]; // exit: play natural → hidden
    var opts={duration:m.dur,delay:m.delay,fill:'both'};
    try{opts.easing=swEase(m.el);}catch(e){}
    var anim;try{anim=m.el.animate(frames,opts);}catch(e){svgClear(m.el);return;}
    m.anim=anim;
    anim.onfinish=function(){
      // along-path + OUT rest at their END state (path end / hidden) — keep the WAAPI fill:'both' hold.
      if(m.effect==='along-path'||m.io==='out')return;
      try{anim.cancel();}catch(e){}
      if(m.effect==='draw'&&m.drawFill){ // keep the fill hidden, then reveal it (no flash)
        m.el.style.transform='';m.el.style.opacity='';m.el.style.filter='';svgFillReveal(m);
      }else{svgClear(m.el);}
    };
  }
  // Re-hide a member for replay (data-sw-once="false"): cancel, reset, re-arm the init class (IN only —
  // an OUT element starts visible, so it is not init-hidden).
  function svgReset(m){if(!m.playing)return;m.playing=false;if(m.anim){try{m.anim.cancel();}catch(e){}}if(m.fillAnim){try{m.fillAnim.cancel();}catch(e){}}svgClear(m.el);if(m.io!=='out')m.el.classList.add('sw-svg-init');}
`;

export const SVG_ANIM_JS = `(function(){
  'use strict';
  var els=document.querySelectorAll('[data-sw-svg]');
  if(els.length===0)return;
  // Reduced motion / no matchMedia support with the query present → show everything at its natural
  // state and do nothing (never hide, never animate).
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  ${SVG_ANIM_CORE}
  var DMIN=${SVG_ANIM_LIMITS.duration.min},DMAX=${SVG_ANIM_LIMITS.duration.max};
  var EFFECTS=${JSON.stringify(SVG_ANIM_EFFECTS)};
  function effectOf(el){var e=el.getAttribute('data-sw-svg')||'';for(var i=0;i<EFFECTS.length;i++){if(EFFECTS[i]===e)return e;}return 'fade';}
  function member(el,extraDelay){
    var dur=swMs(el,'${SW_TIMING_ATTRS.duration}',${SW_DURATION_DEFAULT});if(dur<DMIN)dur=DMIN;if(dur>DMAX)dur=DMAX;
    var effect=effectOf(el);
    var m={el:el,effect:effect,dur:dur,delay:swMs(el,'${SW_TIMING_ATTRS.delay}',0)+extraDelay,playing:false};
    if(effect==='draw'){m.len=svgLen(el);m.dir=(el.getAttribute('data-sw-svg-draw-dir')==='reverse')?'reverse':'normal';m.fill=el.getAttribute('data-sw-svg-fill')==='true';}
    if(effect==='along-path'){var p=el.getAttribute('data-sw-svg-path');if(p&&/^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\\s+-]{1,4000}$/.test(p)){m.path=p;m.rotate=el.getAttribute('data-sw-svg-rotate');}}
    var o=el.getAttribute('data-sw-svg-origin');if(o&&/^[a-z- ]{1,20}$/.test(o))m.origin=o;
    m.io=el.getAttribute('data-sw-svg-dir')==='out'?'out':'in';
    return m;
  }
  // A UNIT = one trigger source (a scene root, or a standalone element) + its ordered members.
  // morph is owned by the SEPARATE svg-anim-morph runtime — this core runtime never touches it.
  function isMorph(el){return el.getAttribute('data-sw-svg')==='morph';}
  var scenes=document.querySelectorAll('[data-sw-svg-scene]');
  var claimed=[];Array.prototype.forEach.call(scenes,function(s){var kids=s.querySelectorAll('[data-sw-svg]');Array.prototype.forEach.call(kids,function(k){claimed.push(k);});});
  function isClaimed(el){for(var i=0;i<claimed.length;i++){if(claimed[i]===el)return true;}return false;}
  var units=[];
  Array.prototype.forEach.call(scenes,function(s){
    var step=swMs(s,'data-sw-svg-stagger',0);if(step>${SVG_ANIM_LIMITS.stagger.max})step=${SVG_ANIM_LIMITS.stagger.max};
    var trig=(s.getAttribute('data-sw-svg-scene-trigger')==='load')?'load':'view';
    var kids=s.querySelectorAll('[data-sw-svg]');var members=[];
    Array.prototype.forEach.call(kids,function(k,i){if(!isMorph(k))members.push(member(k,step*i));});
    if(members.length)units.push({root:s,trigger:trig,members:members});
  });
  Array.prototype.forEach.call(els,function(el){
    if(isClaimed(el)||isMorph(el))return;
    var trig=(el.getAttribute('data-sw-svg-trigger')==='load')?'load':'view';
    units.push({root:el,trigger:trig,members:[member(el,0)]});
  });
  if(units.length===0)return;
  // Arm: hide every member (PE-first init class) before anything triggers.
  units.forEach(function(u){u.members.forEach(function(m){if(m.io!=='out')m.el.classList.add('sw-svg-init');});});
  function playUnit(u){u.members.forEach(svgPlay);}
  function resetUnit(u){u.members.forEach(svgReset);}
  // 'load' units fire now; 'view' units wait for the IntersectionObserver.
  units.forEach(function(u){if(u.trigger==='load')playUnit(u);});
  var viewUnits=units.filter(function(u){return u.trigger==='view';});
  if(viewUnits.length===0)return;
  if(!('IntersectionObserver' in window)){viewUnits.forEach(playUnit);return;} // PE fallback: just play
  var once=function(el){return el.getAttribute('${SW_TIMING_ATTRS.once}')!=='false';};
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      for(var i=0;i<viewUnits.length;i++){
        if(viewUnits[i].root!==entry.target)continue;
        var u=viewUnits[i];
        if(entry.isIntersecting){playUnit(u);if(once(u.root))io.unobserve(u.root);}
        else if(!once(u.root))resetUnit(u);
      }
    });
  },{threshold:0.15,rootMargin:'0px 0px -10% 0px'});
  viewUnits.forEach(function(u){io.observe(u.root);});
})();`;

// --- editor builder preview -------------------------------------------------
// The Library "SVG animation builder" previews the chosen effect + timing on a sample line-art SVG,
// LOOPING it so the (one-shot) entrance reads. Served same-origin under `Content-Security-Policy:
// sandbox allow-scripts` and loaded via the iframe `src` (NOT `srcdoc`) — the editor's own CSP is
// `script-src 'self'`, which a srcdoc iframe inherits and which would block the inline runtime. The
// sandbox CSP gives the doc an opaque, isolated origin where inline script DOES run, with no access to
// the editor session. Only allowlisted effect keywords + clamped numbers reach the markup.

/** One composed animation for the preview (and the emitted copy-paste markup). */
export interface SvgAnimPreviewOpts {
  effect?: string;
  duration?: number;
  delay?: number;
  easing?: string;
  drawDir?: 'normal' | 'reverse';
  fill?: boolean;
  origin?: string;
  /** motion path for along-path (data-sw-svg-path). */
  path?: string;
  /** whether along-path rotates to face the path (default true → 'auto'). */
  rotate?: boolean;
  /** target path for morph (data-sw-svg-to). */
  to?: string;
}

/** A gentle default motion path for the along-path preview (an arc across the sample box). */
export const SVG_DEMO_PATH = 'M10 60 Q 60 -10 110 60';

function clampInt(n: number | undefined, lo: number, hi: number, def: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : def;
  return v < lo ? lo : v > hi ? hi : v;
}

/** The validated `data-sw-svg*` + timing attributes for one composed animation. Effect keyword and
 *  easing are allowlisted; numbers are clamped; origin passes only a keyword charset. Shared by the
 *  preview doc and the editor builder's emitted markup so the two can never diverge. */
export function svgAnimAttrs(opts: SvgAnimPreviewOpts = {}): string {
  const effect = SVG_ANIM_EFFECTS.includes(opts.effect ?? '') ? (opts.effect as string) : 'draw';
  const dur = clampInt(opts.duration, SVG_ANIM_LIMITS.duration.min, SVG_ANIM_LIMITS.duration.max, SW_DURATION_DEFAULT);
  const parts = [`data-sw-svg="${effect}"`, `data-sw-duration="${dur}"`];
  const delay = clampInt(opts.delay, SVG_ANIM_LIMITS.delay.min, SVG_ANIM_LIMITS.delay.max, 0);
  if (delay > 0) parts.push(`data-sw-delay="${delay}"`);
  if (opts.easing && /^[a-z-]{1,16}$/.test(opts.easing) && opts.easing !== 'ease-out') parts.push(`data-sw-easing="${opts.easing}"`);
  if (effect === 'draw' && opts.drawDir === 'reverse') parts.push('data-sw-svg-draw-dir="reverse"');
  if (effect === 'draw' && opts.fill) parts.push('data-sw-svg-fill="true"');
  if (opts.origin && /^[a-z- ]{1,20}$/.test(opts.origin) && opts.origin !== 'center') parts.push(`data-sw-svg-origin="${opts.origin}"`);
  if (effect === 'along-path') {
    const path = opts.path && SVG_PATH_DATA.test(opts.path) ? opts.path : SVG_DEMO_PATH;
    parts.push(`data-sw-svg-path="${path}"`);
    if (opts.rotate === false) parts.push('data-sw-svg-rotate="0"');
  }
  if (effect === 'morph' && opts.to && SVG_PATH_DATA.test(opts.to)) parts.push(`data-sw-svg-to="${opts.to}"`);
  return parts.join(' ');
}

// The preview runtime: LOOPS the effect on the `.sample` element(s) and accepts live postMessage updates
// from the builder (so tweaking a value never reloads the iframe). Same MATH as production (shared
// SVG_ANIM_CORE). Only whitelisted data-sw-* attribute names + a safe value charset are applied.
const SVG_ANIM_PREVIEW_JS = `(function(){
  'use strict';
  ${SVG_ANIM_CORE}
  var EFFECTS=${JSON.stringify(SVG_ANIM_EFFECTS)},DMAX=${SVG_ANIM_LIMITS.duration.max};
  function build(el){
    var e=el.getAttribute('data-sw-svg')||'',ok='fade';for(var i=0;i<EFFECTS.length;i++){if(EFFECTS[i]===e)ok=e;}
    var dur=swMs(el,'${SW_TIMING_ATTRS.duration}',${SW_DURATION_DEFAULT});if(dur>DMAX)dur=DMAX;
    var m={el:el,effect:ok,dur:dur,delay:swMs(el,'${SW_TIMING_ATTRS.delay}',0),playing:false};
    if(ok==='draw'){m.len=svgLen(el);m.dir=el.getAttribute('data-sw-svg-draw-dir')==='reverse'?'reverse':'normal';m.fill=el.getAttribute('data-sw-svg-fill')==='true';}
    if(ok==='along-path'){var p=el.getAttribute('data-sw-svg-path');if(p&&/^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\\s+-]{1,4000}$/.test(p)){m.path=p;m.rotate=el.getAttribute('data-sw-svg-rotate');}}
    var o=el.getAttribute('data-sw-svg-origin');if(o&&/^[a-z- ]{1,20}$/.test(o))m.origin=o;
    m.io=el.getAttribute('data-sw-svg-dir')==='out'?'out':'in';
    return m;
  }
  var els=document.querySelectorAll('.sample');
  if(parent)parent.postMessage({type:'sw-svg-ready'},'*');
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches){var h=document.querySelector('.hint');if(h)h.textContent='Motion is off under your system reduced-motion setting — visitors with it see the final artwork, no animation.';return;}
  var timer=null;
  function run(){var maxD=0;Array.prototype.forEach.call(els,function(el){var m=build(el);if(m.delay+m.dur>maxD)maxD=m.delay+m.dur;svgClear(el);svgPlay(m);});return maxD;}
  function loop(){var d=run();timer=setTimeout(loop,d+1100);}
  loop();
  window.addEventListener('message',function(ev){if(ev.source!==parent)return;var d=ev.data;if(!d||d.type!=='sw-svg'||!(d.entries instanceof Array))return;
    Array.prototype.forEach.call(els,function(el){
      var a=el.attributes,i;for(i=a.length-1;i>=0;i--){var n=a[i].name;if(n.indexOf('data-sw-svg')===0||n==='data-sw-duration'||n==='data-sw-delay'||n==='data-sw-easing')el.removeAttribute(n);}
      for(i=0;i<d.entries.length;i++){var k=''+d.entries[i][0],v=''+d.entries[i][1];
        // Path attributes carry SVG path-data (longer, its own grammar); everything else is a short enum/number.
        var okVal=(k==='data-sw-svg-path'||k==='data-sw-svg-to')?/^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\\s+-]{1,4000}$/.test(v):/^[a-z0-9 .,%_-]{0,40}$/i.test(v);
        if(/^data-sw-(svg[a-z-]*|duration|delay|easing)$/.test(k)&&okVal)el.setAttribute(k,v);}
    });
    if(timer){clearTimeout(timer);}loop();
  });
})();`;

/** Build the SVG-builder preview document (see note above). A line-art heart is the sample so the DRAW
 *  effect reads clearly and every transform/blur effect looks good on it. */
export function svgAnimPreviewDoc(opts: SvgAnimPreviewOpts = {}): string {
  const attrs = svgAnimAttrs(opts);
  // A single line-art path (drawable) + a small filled dot, both animated, on a neutral demo surface.
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>` +
    `html,body{margin:0;height:100%}body{display:grid;place-items:center;font-family:system-ui,sans-serif;` +
    `background:radial-gradient(circle at 50% 30%,#fbfbfe,#eef0f7);color:#1a1a23}` +
    `.stage{display:grid;place-items:center;gap:14px;text-align:center}` +
    `.hint{position:fixed;top:0;left:0;right:0;text-align:center;font-size:12px;font-weight:600;padding:8px 10px;` +
    `background:rgba(255,255,255,.86);backdrop-filter:blur(4px);border-bottom:1px solid rgba(0,0,0,.08)}` +
    `svg{width:180px;height:180px;overflow:visible}.sample.stroke{fill:none;stroke:#4f46e5;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}` +
    `.sample.dot{fill:#0ea5e9}` +
    SVG_ANIM_CSS +
    `</style></head><body>` +
    `<div class="hint">↻ Looping preview — this is how the effect plays once on your page</div>` +
    `<div class="stage"><svg viewBox="0 0 120 120">` +
    `<path class="sample stroke" ${attrs} d="M60 96 C18 66 22 28 44 28 C55 28 60 38 60 46 C60 38 65 28 76 28 C98 28 102 66 60 96 Z"/>` +
    `<circle class="sample dot" ${attrs} cx="60" cy="14" r="6"/>` +
    `</svg></div>` +
    `<script>${SVG_ANIM_PREVIEW_JS}</script></body></html>`
  );
}

// Detection is a literal substring match: every attribute in the family contains `data-sw-svg`, so one
// marker gates the whole engine. A `data-sw-svg` written via a Handlebars variable won't be detected
// (don't do that); a prose mention over-ships a couple KB — benign either way.
const SVG_ANIM_MARKER = 'data-sw-svg';

/** Whether an authored HTML/template string uses the SVG animation engine. */
export function usesSvgAnim(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.includes(SVG_ANIM_MARKER);
}
