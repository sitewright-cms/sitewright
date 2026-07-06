import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- SVG ANIMATION showcase (child of Components)
// The SVG animation engine: animate INDIVIDUAL sub-elements of an inline SVG — stroke draw-on, entrance
// transforms, clip-path reveals, motion-path travel, staggered scenes, and shape morph. Authored as plain
// data-sw-svg* attributes (timing shares the data-sw-duration/-delay/-easing/-once primitives with entrance
// animations); the platform ships the tiny WAAPI runtime only when used, and everything is fully visible
// without JS / under reduced motion. Copy bound via data-sw-text/page.data so the de/es variants translate.
export function pageComponentsSvg(): Page {
  return {
    id: 'comp-svg',
    path: 'svg-animation',
    title: 'SVG animation',
    description:
      'Animate inside an SVG — stroke draw-on, entrance transforms, clip-path reveals, motion-path travel, staggered scenes and shape morph, all via data-sw-svg attributes. One tiny runtime, only when used, and fully visible under reduced motion.',
    parent: 'components',
    order: 12,
    data: {
      svg_intro:
        'Animate the individual parts of an inline SVG. Put a data-sw-svg attribute on a path, group or shape and the platform ships a tiny runtime that draws, reveals, moves or morphs it as it scrolls into view — timing shares the same duration/delay/easing attributes as entrance animations, and every shape stays fully visible without JavaScript. Scroll down.',
      logos_t: 'Composed brand marks',
      logos_d:
        'Stack several effects on one SVG and drive them from the root: a stroke draw, a staggered reveal and a spring-in pop assemble a logo on a shared timeline (data-sw-delay). The whole mark then LOOPS on a timer (data-sw-svg-loop), replays as it re-enters view (data-sw-svg-replay) and replays on click (data-sw-svg-click) — every trigger at once.',
      logos_hint: 'Click any mark to replay it — each one also loops on a timer and re-runs on scroll-in.',
      draw_t: 'Draw on',
      draw_d:
        'data-sw-svg="draw" animates a stroked path’s dash offset so the line draws itself on. Add data-sw-svg-fill="true" to fade the fill in once the stroke finishes — perfect for line-art logos and icons.',
      scene_t: 'Staggered scene',
      scene_d:
        'Wrap several elements in data-sw-svg-scene with data-sw-svg-stagger and they cascade in order as the scene enters view — here five bars fade up one after another.',
      reveal_t: 'Clip-path reveals',
      reveal_d:
        'reveal-right / -left / -down / -up / -iris uncover the element in place with a clip-path wipe — no fade, just a clean edge sweeping across.',
      path_t: 'Along a path',
      path_d:
        'data-sw-svg="along-path" sends the element travelling along a motion path (data-sw-svg-path), rotating to face it — great for a plane, comet or cursor.',
      morph_t: 'Shape morph',
      morph_d:
        'data-sw-svg="morph" tweens the shape’s outline toward a target path (data-sw-svg-to) — the mark below morphs from a rounded square into a star as it scrolls in.',
      nojs_t: 'Without JavaScript (or reduced motion)',
      nojs_d:
        'Every shape renders at its authored state — a fully-drawn path, an untransformed icon, the morph’s start shape. The runtime only adds the motion on top, so an SVG is never hidden or broken; animation is decoration, never structure.',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url page.parent.path}}">${icon('arrow-left', 'h-4 w-4')} {{page.parent.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-text="svg_intro">Animate the parts of an inline SVG.</p>
  <pre class="mt-4 inline-block max-w-full overflow-x-auto text-xs"><code>data-sw-svg="draw | fade-up | reveal-right | along-path | morph"  ·  data-sw-svg-scene / -stagger  ·  whole-SVG: data-sw-svg-trigger / -replay / -click / -loop</code></pre>
</section>

<!-- COMPOSED LOGO MARKS — several effects on one timeline, driven from the root <svg>: auto-loop + all triggers -->
<section class="mx-auto max-w-6xl px-6 py-14">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="logos_t">Composed brand marks</h2>
  <p class="mt-2 max-w-3xl leading-relaxed text-base-content/60" data-sw-text="logos_d">Several effects on one timeline — looping, and replaying on scroll-in and on click.</p>
  <div class="mt-10 grid gap-6 sm:grid-cols-3">
    <!-- ORBIT: ring draws, then three satellites + a core spring in -->
    <div class="grid cursor-pointer place-items-center rounded-3xl border border-base-200 bg-base-100 py-16 shadow-lg">
      <svg viewBox="0 0 120 120" class="h-28 w-auto text-primary" data-sw-svg-trigger="view" data-sw-svg-replay="true" data-sw-svg-click="true" data-sw-svg-loop="4000">
        <circle data-sw-svg="draw" data-sw-duration="1100" data-sw-easing="ease-in-out" cx="60" cy="60" r="46" fill="none" stroke="currentColor" stroke-width="5"/>
        <circle data-sw-svg="scale-c" data-sw-delay="1000" data-sw-duration="480" data-sw-easing="back" cx="60" cy="14" r="7" fill="currentColor"/>
        <circle data-sw-svg="scale-c" data-sw-delay="1180" data-sw-duration="480" data-sw-easing="back" class="text-secondary" cx="100" cy="82" r="7" fill="currentColor"/>
        <circle data-sw-svg="scale-c" data-sw-delay="1360" data-sw-duration="480" data-sw-easing="back" class="text-accent" cx="20" cy="82" r="7" fill="currentColor"/>
        <circle data-sw-svg="scale-c" data-sw-delay="1560" data-sw-duration="440" data-sw-easing="back" cx="60" cy="60" r="12" fill="currentColor"/>
      </svg>
    </div>
    <!-- PRISM: three chevrons reveal up, staggered bottom-to-top -->
    <div class="grid cursor-pointer place-items-center rounded-3xl border border-base-200 bg-base-100 py-16 shadow-lg">
      <svg viewBox="0 0 120 120" class="h-28 w-auto" data-sw-svg-trigger="view" data-sw-svg-replay="true" data-sw-svg-click="true" data-sw-svg-loop="4500">
        <path data-sw-svg="reveal-up" data-sw-delay="150" data-sw-duration="480" class="text-secondary" fill="currentColor" d="M20 92 L60 68 L100 92 L100 106 L60 82 L20 106 Z"/>
        <path data-sw-svg="reveal-up" data-sw-delay="380" data-sw-duration="480" class="text-primary" fill="currentColor" d="M20 66 L60 42 L100 66 L100 80 L60 56 L20 80 Z"/>
        <path data-sw-svg="reveal-up" data-sw-delay="610" data-sw-duration="480" class="text-accent" fill="currentColor" d="M20 40 L60 16 L100 40 L100 54 L60 30 L20 54 Z"/>
      </svg>
    </div>
    <!-- BADGE: rounded mark draws its outline then fills, a monogram strokes in, a spark pops -->
    <div class="grid cursor-pointer place-items-center rounded-3xl border border-base-200 bg-base-100 py-16 shadow-lg">
      <svg viewBox="0 0 120 120" class="h-28 w-auto text-primary" data-sw-svg-trigger="view" data-sw-svg-replay="true" data-sw-svg-click="true" data-sw-svg-loop="5000">
        <rect data-sw-svg="draw" data-sw-svg-fill="true" data-sw-svg-draw-width="4" data-sw-duration="1200" x="16" y="16" width="88" height="88" rx="24" fill="currentColor"/>
        <path data-sw-svg="draw" data-sw-delay="1050" data-sw-duration="850" data-sw-easing="ease-in-out" class="text-base-100" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" d="M42 80 V40 L78 80 V40"/>
        <circle data-sw-svg="scale-c" data-sw-delay="2000" data-sw-duration="450" data-sw-easing="back" class="text-accent" cx="94" cy="26" r="8" fill="currentColor"/>
      </svg>
    </div>
  </div>
  <p class="mt-4 text-sm text-base-content/50" data-sw-text="logos_hint">Click any mark to replay it — each also loops and re-runs on scroll-in.</p>
</section>

<!-- DRAW-ON -->
<section class="mx-auto max-w-6xl px-6 py-14">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="draw_t">Draw on</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="draw_d">The line draws itself on.</p>
  <div class="mt-10 grid cursor-pointer place-items-center rounded-3xl border border-base-200 bg-base-100 py-14 shadow-lg">
    <svg viewBox="0 0 240 120" class="h-32 w-auto text-primary" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" data-sw-svg-replay="true" data-sw-svg-click="true" data-sw-svg-loop="4000">
      <path data-sw-svg="draw" data-sw-duration="1600" data-sw-easing="ease-in-out" d="M12 84 C 40 24 72 24 96 60 C 120 96 152 96 176 60 C 196 30 220 30 228 54"/>
    </svg>
  </div>
</section>

<!-- STAGGERED SCENE -->
<section class="mx-auto max-w-6xl px-6 py-14">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="scene_t">Staggered scene</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="scene_d">They cascade in as the scene enters view.</p>
  <div class="mt-10 grid cursor-pointer place-items-center rounded-3xl border border-base-200 bg-base-100 py-14 shadow-lg">
    <svg viewBox="0 0 320 100" class="h-24 w-auto text-primary" data-sw-svg-scene data-sw-svg-stagger="110" data-sw-once="false" data-sw-svg-click="true" data-sw-svg-loop="4000">
      <rect data-sw-svg="fade-up" data-sw-duration="600" x="8"   y="20" width="48" height="60" rx="8" fill="currentColor"/>
      <rect data-sw-svg="fade-up" data-sw-duration="600" x="72"  y="20" width="48" height="60" rx="8" fill="currentColor"/>
      <rect data-sw-svg="fade-up" data-sw-duration="600" x="136" y="20" width="48" height="60" rx="8" fill="currentColor"/>
      <rect data-sw-svg="fade-up" data-sw-duration="600" x="200" y="20" width="48" height="60" rx="8" fill="currentColor"/>
      <rect data-sw-svg="fade-up" data-sw-duration="600" x="264" y="20" width="48" height="60" rx="8" fill="currentColor"/>
    </svg>
  </div>
</section>

<!-- CLIP-PATH REVEAL -->
<section class="mx-auto max-w-6xl px-6 py-14">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="reveal_t">Clip-path reveals</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="reveal_d">A clean edge sweeps across.</p>
  <div class="mt-10 grid cursor-pointer place-items-center rounded-3xl border border-base-200 bg-base-100 py-14 shadow-lg">
    <svg viewBox="0 0 120 120" class="h-28 w-auto text-secondary" data-sw-svg-replay="true" data-sw-svg-click="true" data-sw-svg-loop="3800">
      <circle data-sw-svg="reveal-iris" data-sw-duration="900" cx="60" cy="60" r="52" fill="currentColor"/>
    </svg>
  </div>
</section>

<!-- ALONG A PATH -->
<section class="mx-auto max-w-6xl px-6 py-14">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="path_t">Along a path</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="path_d">The element travels a motion path.</p>
  <div class="mt-10 grid cursor-pointer place-items-center rounded-3xl border border-base-200 bg-base-100 py-14 shadow-lg">
    <svg viewBox="0 0 240 120" class="h-28 w-auto" data-sw-svg-replay="true" data-sw-svg-click="true" data-sw-svg-loop="4200">
      <path d="M16 96 Q 120 -8 224 96" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 6" class="text-base-content/25"/>
      <circle data-sw-svg="along-path" data-sw-svg-path="M16 96 Q 120 -8 224 96" data-sw-duration="1800" data-sw-easing="ease-in-out" data-sw-once="false" cx="0" cy="0" r="9" class="text-accent" fill="currentColor"/>
    </svg>
  </div>
</section>

<!-- SHAPE MORPH -->
<section class="mx-auto max-w-6xl px-6 py-14">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="morph_t">Shape morph</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="morph_d">The outline tweens toward a target shape.</p>
  <div class="mt-10 grid cursor-pointer place-items-center rounded-3xl border border-base-200 bg-base-100 py-14 shadow-lg">
    <svg viewBox="0 0 120 120" class="h-28 w-auto text-primary" data-sw-once="false" data-sw-svg-click="true" data-sw-svg-loop="4500">
      <path data-sw-svg="morph" data-sw-svg-to="M60 8 L74 44 L112 44 L82 68 L94 106 L60 82 L26 106 L38 68 L8 44 L46 44 Z" data-sw-duration="1200" data-sw-easing="ease-in-out" fill="currentColor" d="M28 20 H92 A12 12 0 0 1 104 32 V88 A12 12 0 0 1 92 100 H28 A12 12 0 0 1 16 88 V32 A12 12 0 0 1 28 20 Z"/>
    </svg>
  </div>
</section>

<!-- NO-JS / REDUCED MOTION -->
<section class="mx-auto max-w-6xl px-6 pb-24 pt-6">
  <div class="rounded-3xl border border-base-200 bg-base-100 p-8 shadow-sm">
    <h2 class="text-2xl font-bold tracking-tight" data-sw-text="nojs_t">Without JavaScript (or reduced motion)</h2>
    <p class="mt-2 max-w-3xl leading-relaxed text-base-content/60" data-sw-text="nojs_d">Every shape renders at its authored state — the runtime only adds motion on top.</p>
  </div>
</section>`,
  };
}
