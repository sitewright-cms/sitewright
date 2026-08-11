// Animation (Entrance + Scroll-Reveal): a first-party runtime for the `data-sw-animation`
// attribute vocabulary (`data-sw-animation="fade-up"`, `data-sw-delay="200"`, …).
//
// Tenants and AI agents author plain `data-sw-animation` attributes in code-first page sources,
// skeleton slots, snippets, or raw Html blocks — one small, self-describing vocabulary. No
// third-party animation library is bundled (WOW.js never will be — GPL + abandoned); this module
// ships a tiny audited implementation under the same only-used-ships discipline as components.ts.
// Timing is shared with the SVG engine via the `data-sw-duration/-delay/-easing/-once` primitives
// (see timing.ts), so there is one timing language across every animation family.
//
// Invariants:
// - No-FOUC: a scroll-reveal element is hidden from FIRST PAINT by CSS (see {@link HIDDEN}) so it never
//   flashes visible in its final position before the deferred runtime reveals it (the old class-gated
//   hide painted content visible until the script ran, then popped it hidden — a visible flash through
//   the translucent preloader). The runtime reveals by adding `.sw-animation-active`.
// - PE-first is preserved WITHOUT leaving content visible pre-JS: a `<noscript>` un-hide
//   ({@link ANIMATION_NOSCRIPT}) restores content when scripting is off, and a CSS self-heal failsafe
//   reveals any element the runtime never `sw-animation-armed`s (script failed to load). Mirrors the SVG
//   engine (svg-anim.ts). A Banner is the sole `.sw-animation-init` user — it ships `hidden` and
//   self-drives its entrance (banner.ts), so it is excluded from the first-paint hide + the failsafe.
// - Accessibility: all motion (and the first-paint hide + failsafe) sits inside
//   `prefers-reduced-motion: no-preference`, and the runtime also bails out under reduced motion.
// - First-party, audited, static code only — tenants supply DATA (attribute values, parsed /
//   clamped / allowlisted below); never JavaScript.
import { SW_TIMING_ATTRS, SW_DURATION_DEFAULT, SW_EASINGS, SW_TIMING_CORE, SW_READY_CORE } from './timing.js';

/** The `data-sw-animation` effects with a dedicated initial transform (plain `fade` is the base rule). */
export const ANIMATION_EFFECTS: readonly string[] = [
  'fade',
  'fade-up',
  'fade-down',
  'fade-left',
  'fade-right',
  'zoom-in',
  'zoom-out',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
  'flip-up',
  'flip-down',
  'flip-left',
  'flip-right',
];

// Initial (pre-reveal) transform per effect. An unknown/empty effect simply
// falls back to the base opacity fade — graceful, never broken.
// TRAVEL: the fade-* offsets were 2rem, which reads as a twitch rather than motion at typical section
// sizes — the entrance was easily missed on a first scroll-through. 4rem is far enough to register as
// an arrival while still landing inside the reveal window (the trigger fires once any part of the
// element crosses the line, so a larger offset cannot leave content parked off-screen). slide-* stay at
// 100% (already a full self-width traverse) and flip-* at 100deg (a rotation has no travel to grow).
const EFFECT_TRANSFORMS: ReadonlyArray<readonly [string, string]> = [
  ['fade-up', 'translate3d(0,4rem,0)'],
  ['fade-down', 'translate3d(0,-4rem,0)'],
  ['fade-right', 'translate3d(-4rem,0,0)'],
  ['fade-left', 'translate3d(4rem,0,0)'],
  // Zoom is travel in the depth axis: .6→.45 and 1.2→1.35 widen the same way the fades do.
  ['zoom-in', 'scale3d(.45,.45,.45)'],
  ['zoom-out', 'scale3d(1.35,1.35,1.35)'],
  ['slide-up', 'translate3d(0,100%,0)'],
  ['slide-down', 'translate3d(0,-100%,0)'],
  ['slide-right', 'translate3d(-100%,0,0)'],
  ['slide-left', 'translate3d(100%,0,0)'],
  ['flip-up', 'perspective(2500px) rotateX(-100deg)'],
  ['flip-down', 'perspective(2500px) rotateX(100deg)'],
  ['flip-left', 'perspective(2500px) rotateY(-100deg)'],
  ['flip-right', 'perspective(2500px) rotateY(100deg)'],
];

// The hidden-state selector. Two branches, both 0-specificity-wrapped in `:where()` so the
// `.sw-animation-active` reveal rule (0,2,0) always wins over these hidden rules (0,1,0):
//  - non-banner scroll-reveal elements are hidden from FIRST PAINT (NOT gated on a JS-added class), so
//    they never flash visible in their final position before the deferred runtime reveals them. PE-first
//    is preserved by the noscript un-hide + the CSS self-heal failsafe below (mirrors the SVG engine),
//    not by leaving content visible pre-JS — which caused a visible show→hide→animate flash through the
//    translucent preloader.
//  - a Banner (`data-sw-component="banner"`) is EXCLUDED from the first-paint hide (it ships `hidden`,
//    so it can't flash) and instead drives the SAME hidden state itself via the runtime-added
//    `.sw-animation-init` class — its reveal is triggered by the banner runtime, not a scroll.
const HIDDEN = ':where(:not([data-sw-component="banner"]):not(.sw-animation-active),.sw-animation-init)';

/**
 * The animation stylesheet. Non-banner elements are hidden from FIRST PAINT (see {@link HIDDEN}); a
 * Banner self-drives the same hidden state via `.sw-animation-init`. `.sw-animation-active` (last rule)
 * reveals. The default transition-duration is SW_DURATION_DEFAULT (450ms — aligned with the shared timing
 * default; `data-sw-duration` overrides it inline). `pointer-events` is suspended while hidden so
 * invisible content can't be clicked. A self-heal failsafe reveals any element the runtime never armed
 * (JS disabled / the script failed) after a grace period, so content is never stranded hidden.
 *
 * CRITICAL: the `transition` is declared UNCONDITIONALLY on `[data-sw-animation]` — NOT on the {@link
 * HIDDEN} selector. If the transition lived on the hidden rule, adding `.sw-animation-active` would make
 * the element stop matching that rule, so the transition-property would VANISH in the same style recalc
 * that flips opacity/transform → the reveal would POP instead of animate. Keeping it unconditional means
 * the transition is present in BOTH the hidden and revealed states, so the reveal always animates.
 */
export const ANIMATION_CSS = [
  '@media (prefers-reduced-motion: no-preference){',
  // Transition — ALWAYS present on a managed element (see the CRITICAL note above). Duration/easing are
  // overridable per-element inline by the runtime from data-sw-duration / data-sw-easing.
  `[data-sw-animation]{transition-property:opacity,transform;transition-duration:${SW_DURATION_DEFAULT}ms;transition-timing-function:cubic-bezier(.25,.46,.45,.94)}`,
  // First-paint / un-activated HIDE (opacity + pointer-events).
  `[data-sw-animation]${HIDDEN}{opacity:0;pointer-events:none}`,
  ...EFFECT_TRANSFORMS.map(
    ([effect, transform]) => `[data-sw-animation="${effect}"]${HIDDEN}{transform:${transform}}`,
  ),
  // Self-heal failsafe: an element the runtime never armed (JS off / the script failed to load) reveals
  // itself after a grace period so first-paint-hidden content can never be stranded. An armed element
  // (runtime present) opts out and waits for its scroll-triggered reveal. Banners self-manage → excluded.
  '[data-sw-animation]:not([data-sw-component="banner"]):not(.sw-animation-armed):not(.sw-animation-active){animation:sw-anim-reveal .01s linear 9s forwards}',
  '@keyframes sw-anim-reveal{to{opacity:1;transform:none;pointer-events:auto}}',
  '[data-sw-animation].sw-animation-active{opacity:1;pointer-events:auto;transform:none}',
  '}',
].join('\n');

/** No-JS override (emitted inside a `<noscript><style>` by the build/preview): when scripting is off the
 *  runtime can never reveal, so cancel the first-paint hide + failsafe immediately — a no-JS visitor sees
 *  the content at once (restores the PE-first "never hide content without JS" guarantee). Mirrors
 *  SVG_ANIM_NOSCRIPT. (A Banner stays `hidden` regardless — it needs JS to show, so opacity:1 is inert.) */
export const ANIMATION_NOSCRIPT =
  '[data-sw-animation]{opacity:1!important;transform:none!important;pointer-events:auto!important;animation:none!important}';

/** Scroll-reveal trigger point: the reveal fires once at least this fraction of the element is in view
 *  (0.2 = 20% — "meaningfully in view", intentionally later than a bare edge-touch). The reveal also
 *  RESETS on a full exit (ratio 0) so it replays on re-entry from any scroll direction. */
// DEFAULT reveal ratio — 0, i.e. "any part of the element has crossed the reveal line".
//
// It used to be 0.2, and that was the wrong UNIT: intersectionRatio is a fraction of the ELEMENT's own
// area, so the trigger point drifts with content length. An element taller than the viewport can only ever
// reach `viewportH / elementH`, and past `elementH > viewportH / ratio` it can never reach 0.2 at all.
// MEASURED on a real clone (a 2960px content card, viewport 1440x900): the whole first screen of the page's
// main content arrived INVISIBLE and only faded in around scrollY 300-600, i.e. after the reader had already
// scrolled past it. The taller the section, the later it fires.
// The "meaningfully in view" gate that this default was reaching for is the observer's rootMargin
// (`0px 0px -20% 0px`, a fraction of the VIEWPORT) — that one is height-independent and already correct, so
// the ratio gate on top of it only ever hurt. `data-sw-threshold` remains as an explicit escape hatch for an
// author who really does want "N% of this element visible", and `data-sw-offset` sets the line in px.
const REVEAL_RATIO = 0;

// The runtime. Notes:
// - Content is hidden from FIRST PAINT by CSS ({@link HIDDEN}) — it never flashes visible before the
//   reveal. The runtime marks each element `sw-animation-armed` so the CSS self-heal failsafe stands down
//   (this runtime owns them and guarantees the reveal), then DEFERS observing (the reveal itself) until
//   the page is ready (swWhenReady) so the entrance doesn't fire behind a still-visible preloader.
// - `data-sw-delay` (start delay, ms) / `data-sw-duration` (length, ms; default {@link SW_DURATION_DEFAULT})
//   are parsed + clamped (swMs, timing.ts) and applied inline; `data-sw-easing` resolves through a fixed
//   allowlist map. Attribute values can therefore never inject style/script.
// - Scroll-reveal fires when the element crosses the REVEAL LINE — by default 20% up from the viewport
//   bottom (the observer's rootMargin), so it animates clearly on screen rather than at the very edge.
//   `data-sw-offset="150"` moves that line to a fixed 150px inside the viewport instead (its own observer);
//   `data-sw-threshold` (0-1) additionally requires that fraction of the ELEMENT to be visible — an escape
//   hatch, NOT the default, because an element taller than the viewport can never reach a high fraction.
//   By DEFAULT the reveal REPLAYS: the element is RESET on a full exit (ratio 0) and re-reveals
//   on re-entry from ANY scroll direction (mirrors the SVG engine's approach). `data-sw-once="true"` opts
//   into play-once (unobserved after the first reveal).
export const ANIMATION_JS = `(function(){
  'use strict';
  if(!('IntersectionObserver' in window))return;
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  // Banner roots are EXCLUDED: a Banner with an animation effect drives the same
  // sw-animation-init/sw-animation-active classes itself on reveal (the reveal, not a scroll, is the
  // trigger — and fixed banners near a viewport edge are dropped by this observer's rootMargin, which
  // would yank their entrance back off).
  var els=document.querySelectorAll('[data-sw-animation]:not([data-sw-component="banner"])');
  if(els.length===0)return;
  ${SW_TIMING_CORE}
  ${SW_READY_CORE}
  // Null-prototype map: a hostile key ('constructor', 'toString', …) must miss, not resolve to an
  // inherited Object.prototype member.
  var EASINGS=Object.create(null);
  ${Object.entries(SW_EASINGS)
    .map(([k, v]) => `EASINGS[${JSON.stringify(k)}]=${JSON.stringify(v)};`)
    .join('')}
  // Per-element reveal threshold: data-sw-threshold (0-1 fraction of the element in view; default
  // REVEAL_RATIO). swRatio parses + clamps to [0,1]; a non-numeric value falls back to the default (no
  // injection — the value is only ever compared as a number). A single observer applies ONE threshold
  // list to all its targets, so we UNION every element's threshold (+ 0 for the reset) → the callback
  // fires exactly at each element's own crossing.
  function swRatio(el,attr,def){var v=parseFloat(el.getAttribute(attr));return isNaN(v)?def:Math.max(0,Math.min(v,1));}
  var thrSet={};thrSet['0']=1;
  Array.prototype.forEach.call(els,function(el){thrSet[swRatio(el,'data-sw-threshold',${REVEAL_RATIO})]=1;});
  // ★ A LADDER, not just the crossings. The default threshold is 0, so with only the per-element
  // values this observer fires EXACTLY ONCE as an element enters — at the instant it first touches
  // the root, ratio 0. Any reveal declined at that instant (see the layout check in swRevealCb) is
  // therefore declined FOREVER: the ratio climbs 0 → 1 with no further threshold to cross, so no
  // second callback ever arrives and the element stays at opacity 0 while the reader looks straight
  // at it. Entering from the TOP always lands on that instant, because the root's top edge is not
  // inset the way its bottom is — which is exactly why this only ever showed up scrolling UP.
  // Measured: 4 of 8 effects permanently invisible on the way back up, in every version since the
  // reveal observer was written. The extra rungs cost nothing (a handful of callbacks per element
  // per entry) and give every later decision another chance to say yes.
  [0.01,0.1,0.25,0.5,0.75,1].forEach(function(t){thrSet[t]=1;});
  var THRESHOLDS=[];for(var tk in thrSet)THRESHOLDS.push(parseFloat(tk));
  // Scroll ROOT for both observers. In the whole-site PREVIEW the page scrolls on <body> (the renderer sets
  // html{overflow:hidden} body{overflow-y:auto} for a styled scrollbar in the sandboxed frame) — a NON-ROOT
  // scroll container. With root:null, Chromium resolves the implicit root + a PERCENTAGE rootMargin against
  // that body scrollport correctly, but WebKit/Gecko can resolve them against the (never-scrolling) layout
  // viewport instead, so the -20% line drifts and the reveal fires far too late. Pin the root to the actual
  // scroll container whenever the body is it; a normally-scrolling published page has body overflowY
  // 'visible' → root stays null (the layout viewport), unchanged.
  var scrollRoot=null;try{if(getComputedStyle(document.body).overflowY==='auto')scrollRoot=document.body;}catch(e){}
  // RESET (replay) observer — SEPARATE from the reveal observer, over the FULL viewport (rootMargin 0). Its
  // intersectionRatio===0 fires EXACTLY when NO part of the element is on screen, whether it left past the
  // TOP or past the BOTTOM. Re-arm the replay only then. This is what lets replay work in BOTH directions
  // while never blinking visible content: (a) a revealed element resting anywhere in view — including the
  // reveal observer's bottom-20% margin band — keeps ratio>0 here, so it's never yanked back hidden; (b) an
  // element scrolled fully off the BOTTOM still resets — which the -20% reveal observer CANNOT detect (it
  // reads ratio 0 already at the -20% line and never fires again as the element continues off-screen).
  // LAYOUT position, ignoring the element's own transform. IntersectionObserver measures the TRANSFORMED
  // box, which is what let the hidden state feed its own trigger: an element leaving past the top reset,
  // the hidden transform shoved it back into view (fade-up is 4rem DOWN; slide-up is a full element
  // height DOWN), the reveal fired, the transform came off, it snapped back out, and it reset again —
  // a visible flicker loop at the top edge for as long as you stayed there. offsetTop/offsetHeight are
  // layout values and are unaffected by transforms, so the decision is made on where the element
  // actually SITS rather than where its animation has momentarily put it.
  // Returns null when the chain cannot be walked (a fixed/detached element, no offsetParent) — the
  // caller then falls back to the observer's own numbers rather than guessing.
  function swLayoutBox(el){
    if(!el.offsetParent&&el.offsetTop===0)return null;
    var t=0,n=el;
    while(n){t+=n.offsetTop||0;n=n.offsetParent;}
    var sy=scrollRoot?scrollRoot.scrollTop:(window.pageYOffset||document.documentElement.scrollTop||0);
    var vh=scrollRoot?scrollRoot.clientHeight:(window.innerHeight||document.documentElement.clientHeight);
    return {top:t-sy,bottom:t+(el.offsetHeight||0)-sy,vh:vh};
  }
  // True when the element's LAYOUT box is entirely outside the viewport.
  function swLayoutOffscreen(el){
    var b=swLayoutBox(el);
    if(!b)return true; // unmeasurable: keep the observer's verdict
    return b.bottom<=0||b.top>=b.vh;
  }
  var exitIo=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      // ★ \`!isIntersecting\`, NOT \`intersectionRatio===0\`. Those look interchangeable and are not: the
      // ratio is ALSO 0 when the element is exactly TOUCHING the root edge — zero area, but present —
      // and that is the precise moment it arrives while scrolling UP. So the old test reset an element
      // at the very instant the reveal observer was announcing it; the two fought over one frame and
      // the reset won, and with a single threshold there was no later callback to undo it. The element
      // then stayed hidden for good. \`isIntersecting\` is false only when there is genuinely no
      // intersection, which is what "it has left" was always meant to mean.
      // ★ And the layout check: an element is only reset once it has genuinely LEFT, not when its own
      // hidden transform has carried it out — that fed the flicker loop at the top edge (#900).
      if(!entry.isIntersecting&&entry.target.classList.contains('sw-animation-active')&&swLayoutOffscreen(entry.target)){entry.target.classList.remove('sw-animation-active');if(swBlind(entry.target))swDefer(entry.target);}
    });
  },{threshold:[0],root:scrollRoot});
  // Reveal an element once. data-sw-once="true" then stops BOTH observers watching it → it can never reset.
  function swReveal(el){
    el.classList.add('sw-animation-active');
    if(el.getAttribute('${SW_TIMING_ATTRS.once}')==='true'){if(el.__swIo)el.__swIo.unobserve(el);exitIo.unobserve(el);}
  }
  // SCROLL-REVEAL: fires once the element crosses the reveal line — 20% up from the viewport bottom by
  // default, or data-sw-offset px in. Height-INDEPENDENT, so a 200px card and a 3000px section behave the
  // same. data-sw-threshold can additionally demand a fraction of the element. Reveal only; exitIo owns reset.
  // The reveal criterion applied to the element's LAYOUT box — the same line the observer uses, minus
  // the element's own transform. Unmeasurable (fixed/detached) → defer to the observer.
  function swLayoutInRoot(el){
    var b=swLayoutBox(el);
    if(!b)return true;
    var off=swOffset(el);
    return b.bottom>0&&b.top<b.vh-(off===null?b.vh*0.2:off);
  }
  // ★ DECLINED IS NOT DENIED. A reveal the layout check turns down must be RE-OFFERED, because the
  // observer will not offer it again: intersectionRatio saturates as an element enters, and once the
  // last threshold is crossed there are no more callbacks. slide-up made that concrete — its hidden
  // state sits a full element height BELOW its layout box, so the ratio reaches its maximum at exactly
  // the moment the layout box arrives, and the one callback that could have revealed it was the one
  // being declined. Adding thresholds narrowed this (4 stuck effects → 1) but cannot close it: for an
  // element taller than the viewport the ratio never reaches the upper rungs at all. So a declined
  // element goes on a list that is re-checked on scroll, against its LAYOUT box, until it qualifies or
  // drifts out of range. The list only ever holds elements the observer has already pointed at.
  // ★ The slide-* family is INVISIBLE TO THE OBSERVER. Their hidden transform is 100% of the element's
  // OWN size, so a tall one is drawn an entire height away from where it belongs: bring a 1200px
  // slide-up into the middle of an 800px viewport and the thing the observer is watching sits 1200px
  // below the fold, never intersecting, never reported. No threshold and no re-offer can help, because
  // there is no callback to re-offer — the element simply never enters the observer's world while the
  // reader is looking straight at the space it should occupy. (Measured stuck before AND after #900,
  // so this one is older than that fix.) They therefore stay on the deferred list on their own account,
  // from init and again after every reset, and are revealed off their LAYOUT box like everything else.
  function swBlind(el){return (el.getAttribute('data-sw-animation')||'').indexOf('slide-')===0;}
  var deferred=[],deferredTick=false;
  function swDefer(el){if(deferred.indexOf(el)<0&&deferred.length<400)deferred.push(el);}
  function swDrainDeferred(){
    deferredTick=false;
    for(var i=deferred.length-1;i>=0;i--){
      var el=deferred[i];
      if(el.classList.contains('sw-animation-active')){deferred.splice(i,1);continue;}
      if(swLayoutInRoot(el)){swReveal(el);deferred.splice(i,1);continue;}
      // Well out of range: drop it, so the per-scroll cost stays proportional to what is near the
      // viewport. Safe for everything the observer CAN see — it re-offers them on the way back. A
      // slide-* element has no such safety net, so it keeps its place in the queue.
      var b=swLayoutBox(el);
      if(b&&(b.bottom<-b.vh||b.top>2*b.vh)&&!swBlind(el))deferred.splice(i,1);
    }
  }
  function swDeferredTick(){if(!deferredTick&&deferred.length){deferredTick=true;requestAnimationFrame(swDrainDeferred);}}
  // capture:true so a scroll inside an INNER container counts too (scroll events do not bubble).
  addEventListener('scroll',swDeferredTick,{passive:true,capture:true});
  addEventListener('resize',swDeferredTick,{passive:true});
  function swRevealCb(entries){
    entries.forEach(function(entry){
      var el=entry.target;
      // ★ The layout check is the other half of the flicker guard: a hidden element whose transform
      // has pushed it back into view is not something the reader has scrolled to, and revealing it
      // there is what completed the loop (#900). Its LAYOUT box has to have arrived too.
      if(entry.isIntersecting&&entry.intersectionRatio>=swRatio(el,'data-sw-threshold',${REVEAL_RATIO})){
        if(swLayoutInRoot(el))swReveal(el);
        else swDefer(el);
      }
    });
  }
  // BOTTOM-OF-DOCUMENT FAILSAFE. The reveal line sits 20% up from the viewport bottom, which an element
  // reaches by having content BELOW it to scroll past. The last things on the page have none: at maximum
  // scroll the footer still lies inside that excluded band, so it never crosses the line and stays at
  // opacity 0 FOREVER. Measured on a real clone — 4 animated elements, the 1 in the page body revealed,
  // all 3 in the footer slot permanently invisible, which read as missing content rather than a broken
  // animation. So once the scroller cannot move any further, reveal whatever is genuinely on screen.
  function swAtBottom(){
    var se=scrollRoot||document.scrollingElement||document.documentElement;
    var y=scrollRoot?scrollRoot.scrollTop:(window.pageYOffset||se.scrollTop||0);
    var vh=scrollRoot?scrollRoot.clientHeight:(window.innerHeight||se.clientHeight);
    return y+vh>=se.scrollHeight-2;
  }
  function swRevealTrailing(){
    if(!swAtBottom())return;
    var vh=window.innerHeight||document.documentElement.clientHeight;
    Array.prototype.forEach.call(els,function(el){
      if(el.classList.contains('sw-animation-active'))return;
      var r=el.getBoundingClientRect();
      if(r.bottom>0&&r.top<vh)swReveal(el);
    });
  }
  window.addEventListener('scroll',swRevealTrailing,{passive:true});
  window.addEventListener('resize',swRevealTrailing,{passive:true});
  if(scrollRoot)scrollRoot.addEventListener('scroll',swRevealTrailing,{passive:true});
  // Reveal observers keyed by their bottom rootMargin. Default is the -20% VIEWPORT line; an element with
  // data-sw-offset="N" reveals once its top edge is N px inside the viewport instead. rootMargin is a
  // property of the OBSERVER, not of a target, so each distinct offset needs its own observer — grouped, so
  // a page using one offset throughout still creates exactly one extra.
  var revealIos=Object.create(null);
  function swOffset(el){var v=parseInt(el.getAttribute('data-sw-offset'),10);return isNaN(v)?null:Math.max(0,Math.min(v,4000));}
  function swIoFor(el){
    var off=swOffset(el);
    var key=off===null?'d':'o'+off;
    if(!revealIos[key])revealIos[key]=new IntersectionObserver(swRevealCb,{threshold:THRESHOLDS,rootMargin:'0px 0px '+(off===null?'-20%':'-'+off+'px')+' 0px',root:scrollRoot});
    return revealIos[key];
  }
  // The elements are ALREADY hidden from first paint by CSS (no flash). ARM them now so the CSS self-heal
  // failsafe stands down — this runtime has taken ownership and swWhenReady guarantees the reveal below.
  Array.prototype.forEach.call(els,function(el){
    el.classList.add('sw-animation-armed');
  });
  swWhenReady(function(){
    // DEFER the reveal (observing) until the page is ready — after the preloader clears — so the entrance
    // animates in the open, not behind the still-visible overlay. A failsafe in swWhenReady guarantees
    // observation begins even if the ready signal never arrives.
    Array.prototype.forEach.call(els,function(el){
      // SELF-HEAL A CLOBBERED TRANSITION. The reveal rides on
      // \`[data-sw-animation]{transition-property:opacity,transform}\`, which is (0,1,0) — deliberately
      // low, so an author can retune it. But a plain \`transition:\` SHORTHAND on the same element is
      // also (0,1,0), and a shorthand REPLACES transition-property rather than adding to it. So an
      // ordinary hover effect — \`.card{transition:outline-color .2s ease}\` — silently deletes the
      // reveal: the element still arms, still activates, and simply snaps from hidden to visible with
      // no travel and no stagger. Measured on a clone: four tiles jumped 0 → 1 opacity inside 80ms
      // while their 0/90/180/270ms delays did nothing, and the author's markup was entirely correct.
      // It reads as "the animation is broken", never as "my CSS did that", and the same shorthand
      // appeared on four separate classes in that one site.
      // So: if opacity/transform are no longer being transitioned, put them back INLINE (which beats
      // any stylesheet rule) while KEEPING whatever the author was transitioning. An author who names
      // opacity or transform themselves is left completely alone — that is a deliberate retune.
      var tp=(getComputedStyle(el).transitionProperty||'');
      if(tp.indexOf('opacity')<0&&tp.indexOf('transform')<0&&tp.indexOf('all')<0){
        el.style.transitionProperty=(tp&&tp!=='none'?tp+',':'')+'opacity,transform';
        if(!el.style.transitionDuration)el.style.transitionDuration=${SW_DURATION_DEFAULT}+'ms';
      }
      var delay=swMs(el,'${SW_TIMING_ATTRS.delay}',0);
      if(delay>0)el.style.transitionDelay=delay+'ms';
      var duration=swMs(el,'${SW_TIMING_ATTRS.duration}',0);
      if(duration>0)el.style.transitionDuration=duration+'ms';
      var easing=EASINGS[el.getAttribute('${SW_TIMING_ATTRS.easing}')||''];
      if(easing)el.style.transitionTimingFunction=easing;
      var revealIo=swIoFor(el);  // reveal: the -20% line, or data-sw-offset px
      el.__swIo=revealIo;        // remembered so data-sw-once can unobserve the RIGHT observer
      revealIo.observe(el);
      exitIo.observe(el);
      if(swBlind(el))swDefer(el);  // see swBlind: the observer can never report this one in time  // reset (replay) when FULLY off the viewport
    });
    // ON-LOAD entrance: a THIRD observer against the FULL viewport (NO -20% bottom margin) reveals whatever
    // is already MEANINGFULLY in view at load — an above-the-fold entrance (a section under a tall hero, whose
    // fade-up transform also pushes it lower; or a card pinned to the bottom edge) animates in immediately
    // instead of waiting for a scroll. Being an OBSERVER, not a one-shot read, it also catches a near-fold
    // element that a late-loading lazy image shifts INTO view AFTER ready. It only reveals (never resets); the
    // exitIo reset never fires while an element is in view, so an on-load reveal is never yanked back. At the
    // FIRST user scroll it disconnects → the -20% observer owns reveal-as-you-scroll from then on (so scroll
    // reveals still fire "clearly on screen", not at the bottom edge).
    var loadArmed=false;
    var loadIo=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting&&entry.intersectionRatio>=swRatio(entry.target,'data-sw-threshold',${REVEAL_RATIO}))swReveal(entry.target);
      });
      // (loadIo shares the same scroll root as the primary observer — see scrollRoot above.)
      // Arm the hand-off ONLY after loadIo has actually DELIVERED its first batch (IO callbacks are async —
      // never synchronous with observe()). Otherwise an early scroll — a carried-over wheel/touch gesture, or
      // another script's scrollTo()/scroll-restoration on load — could disconnect loadIo before it ever
      // reveals, silently reintroducing the blank band. capture:true also catches a scroll of an INNER
      // container (scroll events don't bubble) so loadIo never lingers past the first user scroll.
      if(!loadArmed){loadArmed=true;addEventListener('scroll',function(){loadIo.disconnect();},{once:true,capture:true,passive:true});}
    },{threshold:THRESHOLDS,root:scrollRoot});
    Array.prototype.forEach.call(els,function(el){loadIo.observe(el);});
  });
})();`;

// Detection is a literal substring match: `data-sw-animation` written via a Handlebars variable
// won't be detected (don't do that), and a prose mention of "data-sw-animation" over-ships ~2.5KB of
// assets — benign in both directions.
const ANIMATION_MARKER = 'data-sw-animation';

/** Whether an authored HTML/template string uses entrance / scroll-reveal animations. */
export function usesAnimations(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.includes(ANIMATION_MARKER);
}
