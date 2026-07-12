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
// GLOBAL (whole-SVG) settings — authored on the ROOT <svg>; when any is present the SVG animates as ONE
// coordinated unit driven by these (individual elements keep their own effect/timing/direction):
//   data-sw-svg-trigger="view|load"       when the whole SVG plays (default: view — on scroll-in)
//   data-sw-svg-replay="true"             re-play every time it (re-)enters the viewport, any direction
//   data-sw-svg-click="true"              clicking the SVG re-plays it (with a pointer ripple)
//   data-sw-svg-loop="10000"              auto-repeat the whole animation every N ms (0.5s–10min)
//   data-sw-svg-responsive="true"         scale the SVG to fill its parent (pure CSS, no-JS friendly)
//
// TIMING is the SHARED vocabulary (timing.ts), identical to the entrance engine:
//   data-sw-duration (default 450) · data-sw-delay · data-sw-easing · data-sw-once
//
// Authored as plain attributes in code-first sources, snippets, inline SVGs, or {{sw-icon}} output.
// Tenants supply DATA only (effect keyword allowlisted, numerics clamped); never JavaScript.
//
// Invariants (shared with parallax.ts / animations.ts):
// - No-FOUC + PE-safe: an animated element is hidden from FIRST PAINT via CSS (so it never flashes before
//   it animates), and the runtime reveals it (`.sw-svg-shown`) when the page is ready. Content is never
//   STRANDED hidden: a no-JS visitor is un-hidden by a `<noscript>` override (build-emitted), a visitor
//   whose runtime failed to load is un-hidden by a CSS failsafe (~9s), and a reduced-motion visitor is
//   never hidden at all (every rule sits inside `prefers-reduced-motion: no-preference`).
// - Coordinated start: the reveal waits for the page-ready signal (`sw:ready`, dispatched by the preloader
//   when it clears, or fired immediately when there is no preloader) — never behind a still-up overlay.
// - Accessibility: ALL motion is JS-applied and the runtime BAILS entirely under
//   prefers-reduced-motion: reduce (nothing is hidden, nothing animates).
// - Performance: effects run on the Web Animations API (compositor-friendly transform/opacity/filter);
//   view-triggered units are gated by one IntersectionObserver, so off-screen SVGs do no work.
// - First-party, audited, static code only.
import { SW_TIMING_ATTRS, SW_DURATION_DEFAULT, SW_TIMING_CORE, SW_READY_CORE } from './timing.js';

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
// fill-box` makes CSS transform percentages + `transform-origin` resolve per-element (viewBox-safe).
//
// No-FOUC: an animated element is hidden from FIRST PAINT (not gated on a JS-added class) so it never
// flashes visible before it animates — the runtime reveals it by adding `.sw-svg-shown`. PE-first is
// preserved by a self-healing failsafe: an element the runtime never marks `.sw-svg-armed` (JS disabled
// or the runtime failed to load) reveals itself after a grace period, so content is never stranded
// hidden. Everything is inside `prefers-reduced-motion: no-preference` → reduced-motion visitors see the
// natural, fully-visible artwork with no hide and no failsafe. OUT (exit) elements start visible.
export const SVG_ANIM_CSS = [
  '[data-sw-svg]{transform-box:fill-box;transform-origin:center}',
  '@media (prefers-reduced-motion: no-preference){' +
    '[data-sw-svg]:not([data-sw-svg-dir="out"]):not(.sw-svg-shown){opacity:0}' +
    '[data-sw-svg]:not(.sw-svg-armed):not(.sw-svg-shown):not([data-sw-svg-dir="out"]){animation:sw-svg-failsafe .01s linear 9s forwards}' +
    '@keyframes sw-svg-failsafe{to{opacity:1}}' +
    '}',
  // --- Global (whole-SVG) settings, authored on the root <svg> ---
  // Responsive: scale the SVG to fill its parent container (no-JS friendly — pure CSS).
  'svg[data-sw-svg-responsive]{width:100%;height:auto;max-width:100%}',
  // Click-to-replay: hint interactivity (on a whole-SVG root OR a scene container).
  'svg[data-sw-svg-click],[data-sw-svg-scene][data-sw-svg-click]{cursor:pointer}',
  // Click ripple — mirrors the button ripple, but body-anchored (position:fixed) at the pointer so it
  // works over an inline <svg> without needing a positioned wrapper. Colour is set inline from the SVG.
  '.sw-svg-ripple{position:fixed;z-index:2147483646;border-radius:50%;pointer-events:none;opacity:.3;transform:translate(-50%,-50%) scale(0)}',
  '@media (prefers-reduced-motion: no-preference){.sw-svg-ripple{animation:sw-svg-ripple .6s ease-out forwards}}',
  '@media (prefers-reduced-motion: reduce){.sw-svg-ripple{display:none}}',
  '@keyframes sw-svg-ripple{to{transform:translate(-50%,-50%) scale(1);opacity:0}}',
].join('');

/** No-JS override (emitted inside a `<noscript><style>` by the build): when scripting is off, the runtime
 *  can never reveal the elements, so cancel the first-paint hide + failsafe immediately — a no-JS visitor
 *  sees the artwork at once (restores the PE-first "never hide content without JS" guarantee). */
export const SVG_ANIM_NOSCRIPT = '[data-sw-svg]{opacity:1!important;animation:none!important}';

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
  function swEaseV(n){return SVG_EASE[n||'']||'ease-out';}
  function swEase(el){return swEaseV(el.getAttribute('${SW_TIMING_ATTRS.easing}'));}
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
    // draw-then-fill only for an ENTERING filled shape; an exit (out) keeps the fill visible while it erases.
    if((m.fill||!noFill)&&m.io!=='out'){
      m.drawFill=true;m.el.style.fillOpacity='0';
      var hasStroke=(cs.stroke&&cs.stroke!=='none'&&cs.stroke.indexOf('rgba(0, 0, 0, 0)')<0);
      var col=m.drawColor||m.el.getAttribute('data-sw-svg-draw-color');
      if(col&&/^[#a-zA-Z0-9(). ,%-]{1,40}$/.test(col)){m.el.style.stroke=col;m.tempStroke=!hasStroke;}
      else if(!hasStroke){m.el.style.stroke='currentColor';m.tempStroke=true;}
      var w=m.drawWidth||m.el.getAttribute('data-sw-svg-draw-width');
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
    // Blur: a SHORT fade (opacity reaches 1 by ~20% of the timeline) while the strong defocus resolves over
    // the FULL duration — the mark appears quickly, then sharpens. 3 keyframes: opacity ends early (its last
    // stop is 0.2), filter spans 0..1. svgPlay's reverse flips the offsets for an OUT (exit) direction.
    if(m.effect==='blur')return [{opacity:0,filter:'blur(40px)',offset:0},{opacity:1,offset:0.2},{filter:'blur(0px)',offset:1}];
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
    m.el.style.fillOpacity='0';var dur2=Math.max(140,m.dur*0.28); // snappier fill-in after the outline draws
    try{var fa=m.el.animate([{fillOpacity:0},{fillOpacity:1}],{duration:dur2,fill:'both'});m.fillAnim=fa;
      fa.onfinish=function(){try{fa.cancel();}catch(e){}if(m.strokeAnim){try{m.strokeAnim.cancel();}catch(e){}m.strokeAnim=null;}m.el.style.fillOpacity='';m.el.style.strokeDasharray='';m.el.style.strokeDashoffset='';if(m.tempStroke){m.el.style.stroke='';m.el.style.strokeWidth='';m.el.style.strokeOpacity='';}};}
    catch(e){m.el.style.fillOpacity='';m.el.style.strokeDasharray='';m.el.style.strokeDashoffset='';}
    // Fade the TEMP outline out as the fill comes in — STORE it (m.strokeAnim) so it's cancelled on finish
    // AND on replay. A fire-and-forget fill:'both' animation would LINGER holding stroke-opacity:0, making
    // the NEXT loop/replay cycle's draw stroke invisible (the line draws but you can't see it).
    if(m.tempStroke){try{m.strokeAnim=m.el.animate([{strokeOpacity:1},{strokeOpacity:0}],{duration:dur2,fill:'both'});}catch(e){}}
  }
  function svgPlay(m){
    if(m.playing)return;m.playing=true;
    m.el.classList.add('sw-svg-shown'); // reveal (WAAPI fill:'both' holds the from-frame → no jump)
    var frames;try{frames=svgFrames(m);}catch(e){svgClear(m.el);return;}
    // AFTER svgFrames so an author's data-sw-svg-origin overrides an effect's baked-in origin (scale-*).
    if(m.origin)m.el.style.transformOrigin=m.origin;
    // exit: reverse the keyframes (flipping any explicit offsets, e.g. blur's 3 stops) → play natural → hidden.
    if(m.io==='out'){var rv=[];for(var ri=frames.length-1;ri>=0;ri--){var rf=frames[ri];if(rf.offset==null){rv.push(rf);}else{var rc={};for(var rk in rf){rc[rk]=rf[rk];}rc.offset=1-rf.offset;rv.push(rc);}}frames=rv;}
    var opts={duration:m.dur,delay:m.delay,fill:'both'};
    try{opts.easing=m.ease||swEase(m.el);}catch(e){}
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
  // Re-hide a member for replay: cancel, reset, drop the sw-svg-shown class so the CSS re-hides it (IN only
  // — an OUT element starts visible and is excluded from the hide rule).
  function svgReset(m){if(!m.playing)return;m.playing=false;if(m.anim){try{m.anim.cancel();}catch(e){}m.anim=null;}if(m.fillAnim){try{m.fillAnim.cancel();}catch(e){}m.fillAnim=null;}if(m.strokeAnim){try{m.strokeAnim.cancel();}catch(e){}m.strokeAnim=null;}svgClear(m.el);
    // Cancelling a fill-reveal mid-flight never fires its onfinish, so clear the TEMP outline stroke here
    // (else a filled draw+once=false shape keeps an outline it never had). Never clears an authored stroke.
    if(m.tempStroke){m.el.style.stroke='';m.el.style.strokeWidth='';m.el.style.strokeOpacity='';}
    m.el.classList.remove('sw-svg-shown');}
`;

export const SVG_ANIM_JS = `(function(){
  'use strict';
  if(!document.querySelector('[data-sw-svg]'))return;
  // Reduced motion / no matchMedia support with the query present → show everything at its natural
  // state and do nothing (never hide, never animate; a data-sw-svg <img> just stays a static <img>).
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  ${SVG_ANIM_CORE}
  ${SW_READY_CORE}
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
  // A DRAW effect on a CONTAINER (a <g> group, or anything with no strokable outline of its own → no
  // getTotalLength) would otherwise degrade to a plain fade. Instead expand it into ONE draw member per
  // drawable descendant, each inheriting the container's timing / direction / fill / stroke — so a logo
  // group visibly draws stroke-by-stroke. Descendants that carry their OWN data-sw-svg animate as
  // themselves (skipped here). Returns [] when the container has no plain drawable descendant.
  function drawMembers(el,extraDelay){
    var kids=el.querySelectorAll('path,line,polyline,polygon,circle,ellipse,rect');
    var gdur=swMs(el,'${SW_TIMING_ATTRS.duration}',${SW_DURATION_DEFAULT});if(gdur<DMIN)gdur=DMIN;if(gdur>DMAX)gdur=DMAX;
    var gdelay=swMs(el,'${SW_TIMING_ATTRS.delay}',0)+extraDelay;
    var gdir=(el.getAttribute('data-sw-svg-draw-dir')==='reverse')?'reverse':'normal';
    var gfill=el.getAttribute('data-sw-svg-fill')==='true';
    var gio=el.getAttribute('data-sw-svg-dir')==='out'?'out':'in';
    var gcol=el.getAttribute('data-sw-svg-draw-color'),gw=el.getAttribute('data-sw-svg-draw-width');
    var gease=swEaseV(el.getAttribute('${SW_TIMING_ATTRS.easing}'));
    var out=[];
    Array.prototype.forEach.call(kids,function(k){
      if(k.getAttribute('data-sw-svg'))return; // has its own directive → its own member
      var len=svgLen(k);if(!(len>0))return;    // not strokable (e.g. a 0-size rect) → skip
      var m={el:k,effect:'draw',dur:gdur,delay:gdelay,playing:false,len:len,dir:gdir,fill:gfill,io:gio,ease:gease,container:el};
      if(gcol)m.drawColor=gcol;if(gw)m.drawWidth=gw;
      out.push(m);
    });
    return out;
  }
  // One animatable element → its member list: normally one member, but a draw on a non-strokable container
  // expands to its drawable descendants. The container is ARMED (failsafe stands down) but stays hidden until
  // play (playUnit reveals it AFTER the members set their hidden from-frame, so nothing flashes).
  function buildMembers(el,extraDelay){
    if(effectOf(el)==='draw'&&svgLen(el)===0){var dm=drawMembers(el,extraDelay);if(dm.length){el.classList.add('sw-svg-armed');return dm;}}
    return [member(el,extraDelay)];
  }
  // morph is owned by the SEPARATE svg-anim-morph runtime; an <img data-sw-svg> is an INLINE target
  // (handled below), never an effect element — both are excluded from the animatable set.
  function isMorph(el){return el.getAttribute('data-sw-svg')==='morph';}
  function isImg(el){return el.tagName&&String(el.tagName).toLowerCase()==='img';}
  var once=function(el){return el.getAttribute('${SW_TIMING_ATTRS.once}')!=='false';};
  // --- global (whole-SVG) settings, authored on the root <svg> ---
  var LOOP_MIN=500,LOOP_MAX=600000; // auto-repeat bounds (ms): 0.5s … 10min
  function boolAttr(el,name){return el.getAttribute(name)==='true';}
  function loopMsOf(el){var v=el.getAttribute('data-sw-svg-loop');if(!v)return 0;var n=parseInt(v,10);if(!isFinite(n)||n<=0)return 0;if(n<LOOP_MIN)n=LOOP_MIN;if(n>LOOP_MAX)n=LOOP_MAX;return n;}
  // A <svg> is a GLOBAL orchestration root when it carries a whole-SVG directive. A self-animated <svg>
  // (data-sw-svg on the <svg> itself) is a STANDALONE element, not a container — so it's excluded here and
  // keeps reading its own per-element trigger (back-compat: data-sw-svg-trigger was a per-element attr).
  function hasGlobal(svg){if(svg.hasAttribute('data-sw-svg'))return false;return svg.hasAttribute('data-sw-svg-trigger')||svg.hasAttribute('data-sw-svg-replay')||svg.hasAttribute('data-sw-svg-click')||svg.hasAttribute('data-sw-svg-loop');}
  // Candidate <svg> roots in a subtree — querySelectorAll misses the subtree root itself (the inlined case),
  // which is added FIRST so an inlined outer <svg>'s global settings win over any nested <svg>.
  function svgRoots(root){var list=[];Array.prototype.forEach.call(root.querySelectorAll('svg'),function(s){list.push(s);});if(root.tagName&&String(root.tagName).toLowerCase()==='svg')list.unshift(root);return list;}
  // Body-anchored ripple at the pointer — the click-to-replay affordance (mirrors the button ripple).
  function swRipple(e,host){
    try{
      var span=document.createElement('span');span.className='sw-svg-ripple';
      var r=host.getBoundingClientRect();var size=Math.max(r.width,r.height)*0.55;if(!(size>0))size=90;
      var x=(e&&e.clientX!=null)?e.clientX:r.left+r.width/2,y=(e&&e.clientY!=null)?e.clientY:r.top+r.height/2;
      span.style.width=span.style.height=size+'px';span.style.left=x+'px';span.style.top=y+'px';
      var col='';try{col=window.getComputedStyle(host).color;}catch(_e){}
      span.style.background=(col&&col.indexOf('rgba(0, 0, 0, 0)')<0)?col:'currentColor';
      document.body.appendChild(span);
      var rm=function(){if(span.parentNode)span.parentNode.removeChild(span);};
      span.addEventListener('animationend',rm,{once:true});setTimeout(rm,800);
    }catch(_e){}
  }
  // Build + arm + trigger animation UNITS within a subtree ROOT (document, or a freshly-inlined <svg>). A
  // UNIT = one trigger SOURCE (an explicit scene, a global <svg> root, or a standalone element) + its
  // ordered members, sharing one trigger/replay/click/loop. Settings on the <svg> drive the whole SVG.
  function runSvgAnim(root){
    var els=root.querySelectorAll('[data-sw-svg]');
    var claimed=[];function claim(el){claimed.push(el);}function isClaimed(el){for(var i=0;i<claimed.length;i++){if(claimed[i]===el)return true;}return false;}
    var units=[];
    // 1) explicit scenes — a container staggers its descendants (claimed first so they aren't re-grouped).
    var scenes=root.querySelectorAll('[data-sw-svg-scene]');
    Array.prototype.forEach.call(scenes,function(s){
      var kids=s.querySelectorAll('[data-sw-svg]');Array.prototype.forEach.call(kids,claim);
      var step=swMs(s,'data-sw-svg-stagger',0);if(step>${SVG_ANIM_LIMITS.stagger.max})step=${SVG_ANIM_LIMITS.stagger.max};
      var trig=(s.getAttribute('data-sw-svg-scene-trigger')==='load')?'load':'view';
      var members=[];Array.prototype.forEach.call(kids,function(k,i){if(!isMorph(k)&&!isImg(k)){var bm=buildMembers(k,step*i);for(var bi=0;bi<bm.length;bi++)members.push(bm[bi]);}});
      // A scene also honours the whole-SVG loop + click-to-replay directives (like a global <svg> root).
      if(members.length)units.push({root:s,trigger:trig,members:members,replay:!once(s),click:boolAttr(s,'data-sw-svg-click'),loopMs:loopMsOf(s)});
    });
    // 2) global <svg> roots — the whole SVG animates as ONE coordinated unit driven by its root settings.
    Array.prototype.forEach.call(svgRoots(root),function(svg){
      if(!hasGlobal(svg))return;
      var kids=svg.querySelectorAll('[data-sw-svg]');var members=[];
      Array.prototype.forEach.call(kids,function(k){if(isClaimed(k)||isMorph(k)||isImg(k))return;claim(k);var bm=buildMembers(k,0);for(var bi=0;bi<bm.length;bi++)members.push(bm[bi]);});
      if(!members.length)return;
      var trig=(svg.getAttribute('data-sw-svg-trigger')==='load')?'load':'view';
      units.push({root:svg,trigger:trig,members:members,replay:boolAttr(svg,'data-sw-svg-replay'),click:boolAttr(svg,'data-sw-svg-click'),loopMs:loopMsOf(svg)});
    });
    // 3) remaining standalone elements — per-element trigger/replay (back-compat).
    Array.prototype.forEach.call(els,function(el){
      if(isClaimed(el)||isMorph(el)||isImg(el))return;
      var trig=(el.getAttribute('data-sw-svg-trigger')==='load')?'load':'view';
      units.push({root:el,trigger:trig,members:buildMembers(el,0),replay:!once(el)});
    });
    if(units.length===0)return;
    // ARM every member NOW (before the ready gate): marks .sw-svg-armed so the CSS first-paint failsafe
    // stands down (JS is managing these). Hiding itself is from first paint via CSS (.sw-svg-shown reveals),
    // so nothing flashes before it animates.
    units.forEach(function(u){u.members.forEach(function(m){m.el.classList.add('sw-svg-armed');});});
    // Longest member timeline (delay + dur, + the draw's fill-reveal tail) — the auto-repeat period is never
    // shorter than this, so a too-short loop can't keep interrupting a slow draw before it finishes.
    units.forEach(function(u){var mx=0;u.members.forEach(function(m){var d=m.delay+m.dur;if(m.effect==='draw')d+=Math.max(140,m.dur*0.28);if(d>mx)mx=d;});u.totalMs=mx;});
    // Reveal an expanded draw container AFTER its members set their hidden from-frame (same tick → no paint
    // between → no flash of the fully-drawn art); resetUnit re-hides it so a replay re-draws from blank.
    function playUnit(u){u.members.forEach(svgPlay);u.members.forEach(function(m){if(m.container)m.container.classList.add('sw-svg-shown');});}
    function resetUnit(u){u.members.forEach(svgReset);u.members.forEach(function(m){if(m.container)m.container.classList.remove('sw-svg-shown');});}
    function replayUnit(u){resetUnit(u);if(window.requestAnimationFrame)requestAnimationFrame(function(){playUnit(u);});else playUnit(u);}
    function stopLoop(u){if(u.timer){clearTimeout(u.timer);u.timer=null;}}
    // (Re)arm the auto-repeat countdown from NOW. setTimeout (NOT a fixed setInterval) so the loop stays
    // SYNCHRONIZED with the actual animation and any manual trigger: EVERY play re-arms it, so a loop tick
    // never lands mid-draw and a click / scroll re-trigger resets the countdown instead of fighting a fixed
    // schedule. Period = max(loopMs, full timeline). Self-clearing when the root leaves the document.
    function armLoop(u){
      if(!(u.loopMs>0))return;stopLoop(u); // no loop (undefined/0) for scene + standalone units → no-op

      u.timer=setTimeout(function(){
        if(!document.contains(u.root)){u.timer=null;return;}
        if(u.trigger==='load'||u.shown){replayUnit(u);armLoop(u);}else{u.timer=null;}
      },Math.max(u.loopMs,u.totalMs+250));
    }
    // Single entry point: (re)play a unit AND (re)sync its loop. first=true uses playUnit (a fresh reveal);
    // otherwise replayUnit (reset then replay) for a click / scroll re-entry from an already-shown state.
    function triggerUnit(u,first){u.shown=true;if(first){playUnit(u);}else{replayUnit(u);}armLoop(u);}
    // REVEAL/triggering waits until the page is READY (preloader cleared / page load) — so nothing fires
    // behind a still-visible preloader overlay. Click/loop wiring lives here too (post-ready is correct).
    swWhenReady(function(){
      // click-to-replay + ripple (global roots only). When the unit is already shown, re-sync the loop
      // (triggerUnit); when clicked BEFORE its first view-in (an opacity:0 element still gets clicks), just
      // replay WITHOUT setting u.shown — else the IntersectionObserver's first-entry guard would be skipped.
      units.forEach(function(u){if(u.click)u.root.addEventListener('click',function(e){if(u.shown){triggerUnit(u,false);}else{replayUnit(u);}swRipple(e,u.root);});});
      // load-trigger: play immediately (+ arm the auto-repeat loop).
      units.forEach(function(u){if(u.trigger==='load')triggerUnit(u,true);});
      var viewUnits=units.filter(function(u){return u.trigger==='view';});
      if(viewUnits.length===0)return;
      if(!('IntersectionObserver' in window)){viewUnits.forEach(function(u){triggerUnit(u,true);});return;} // PE fallback
      // Play when meaningfully visible; RE-ARM replay only on a FULL exit (ratio 0), so replay fires from ANY
      // scroll direction (the old single bottom-margin threshold missed re-entry from some directions).
      var io=new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          var u=null;for(var i=0;i<viewUnits.length;i++){if(viewUnits[i].root===entry.target){u=viewUnits[i];break;}}
          if(!u)return;
          if(entry.isIntersecting&&entry.intersectionRatio>=0.15){
            if(!u.shown){triggerUnit(u,true);if(!u.replay&&!(u.loopMs>0))io.unobserve(u.root);} // keep observing loop units (pause off-screen)
          }else if(entry.intersectionRatio===0){
            if(u.shown&&(u.replay||u.loopMs>0)){u.shown=false;resetUnit(u);stopLoop(u);} // out of view: pause the loop (loop ⇒ viewport-gated)
          }
        });
      },{threshold:[0,0.15],rootMargin:'0px 0px -5% 0px'});
      viewUnits.forEach(function(u){io.observe(u.root);});
    });
  }
  // INLINE an <img data-sw-svg src="…svg"> so its per-element data-sw-svg directives can run: fetch the
  // SAME-ORIGIN svg (media SVGs are pre-sanitized), strip script/foreignObject/on* (belt-and-suspenders),
  // replace the <img> with the inline <svg>, animate it, and notify the morph runtime.
  function stripUnsafe(el){
    var bad=el.querySelectorAll('script,foreignObject');Array.prototype.forEach.call(bad,function(n){if(n.parentNode)n.parentNode.removeChild(n);});
    function clean(n){if(!n.attributes)return;for(var i=n.attributes.length-1;i>=0;i--){var a=n.attributes[i].name;
      if(/^on/i.test(a)){n.removeAttribute(a);continue;}
      if(/(?:^|:)href$/i.test(a)&&/^\\s*(?:javascript|vbscript|data):/i.test(n.attributes[i].value||''))n.setAttribute(a,'#');}}
    clean(el);Array.prototype.forEach.call(el.querySelectorAll('*'),clean);
  }
  function inlineImgs(){
    var imgs=document.querySelectorAll('img[data-sw-svg]');
    // An <img data-sw-svg> is a STATIC image until it is (maybe) inlined. It is NEVER part of an animation
    // unit, so it never gets armed/shown — mark it now so the first-paint hide + failsafe stand down and it
    // stays visible. If fetch is unavailable, or the SVG is cross-origin / fails to load, it simply remains
    // the static image (the old behaviour). On a successful inline it leaves the DOM.
    Array.prototype.forEach.call(imgs,function(img){img.classList.add('sw-svg-armed');img.classList.add('sw-svg-shown');});
    if(!('fetch' in window))return;
    Array.prototype.forEach.call(imgs,function(img){
      var src=img.getAttribute('src');if(!src)return;
      var u;try{u=new URL(src,location.href);}catch(e){return;}
      if(u.origin!==location.origin)return; // SAME-ORIGIN ONLY — no arbitrary remote SVG (XSS guard)
      fetch(u.href,{credentials:'same-origin'}).then(function(r){return r.ok?r.text():null;}).then(function(text){
        if(!text)return;
        // Ensure the SVG namespace so the inlined elements are real SVG (getTotalLength/style/etc.).
        if(text.indexOf('xmlns')<0)text=text.replace(/<svg/i,'<svg xmlns="http://www.w3.org/2000/svg"');
        var doc;try{doc=new DOMParser().parseFromString(text,'image/svg+xml');}catch(e){return;}
        if(doc.querySelector('parsererror'))return;
        var svg=doc.documentElement;if(!svg||String(svg.nodeName).toLowerCase()!=='svg')return;
        stripUnsafe(svg);
        if(img.getAttribute('class'))svg.setAttribute('class',img.getAttribute('class'));
        if(img.getAttribute('width')&&!svg.getAttribute('width'))svg.setAttribute('width',img.getAttribute('width'));
        if(img.getAttribute('height')&&!svg.getAttribute('height'))svg.setAttribute('height',img.getAttribute('height'));
        var adopted;try{adopted=document.importNode(svg,true);}catch(e){return;}
        if(!img.parentNode)return;img.parentNode.replaceChild(adopted,img);
        // Defer to the next frame so the freshly-inlined SVG is laid out — else getTotalLength() (draw) is 0.
        var go=function(){runSvgAnim(adopted);try{document.dispatchEvent(new CustomEvent('sw-svg-inlined',{detail:{root:adopted}}));}catch(e){}};
        if(window.requestAnimationFrame)requestAnimationFrame(go);else go();
      }).catch(function(){});
    });
  }
  inlineImgs();
  runSvgAnim(document);
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
