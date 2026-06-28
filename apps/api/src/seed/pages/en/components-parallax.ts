import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- PARALLAX showcase (child of Components)
// The scroll-linked property engine: one runtime drives a from→to MOVE (px), opacity, scale and blur off
// each element's scroll position. Each effect is anchored to its own WINDOW of the element's viewport
// pass-through (with an optional OUT phase), and a depth SCENE is just a clipping container of stacked,
// absolutely-positioned layers. Authored as plain data-sw-parallax* attributes — the platform ships the
// runtime only when used. All motion sits behind prefers-reduced-motion (a static, in-flow page without
// it). Copy bound via data-sw-text/page.data so the de/es variants translate; `<pre><code>` stays as-is.
export function pageComponentsParallax(): Page {
  return {
    id: 'comp-parallax',
    path: 'parallax',
    title: 'Parallax',
    description:
      'Scroll-linked move, fade, scale and blur — one tiny runtime driven by data-sw-parallax attributes. Each effect is anchored to its own window of the viewport pass-through (with an optional out phase), and depth scenes stack absolutely-positioned layers. Subtle by default and disabled under reduced motion.',
    parent: 'components',
    order: 9,
    data: {
      px_intro:
        'Drive motion off scroll. Add a data-sw-parallax-* attribute to any element and the platform ships a tiny runtime that moves, fades, scales or blurs it as it passes through the viewport — each effect anchored to its own window, composable, clamped, and switched off entirely for visitors who prefer reduced motion. Scroll down.',
      hero_t: 'Depth scene',
      hero_d:
        'A clipping container of stacked layers — the background drifts and pushes in while the heading rises, fades, scales and sharpens into focus by centre, then eases back out.',
      depth_t: 'Depth — a from→to move',
      depth_d:
        'data-sw-parallax-translate="from,to" slides an element between two pixel offsets as it crosses the viewport. Bigger offsets feel closer; pair opposing directions for depth. Watch the cards travel at different rates.',
      c1: 'foreground',
      c2: 'static',
      c3: 'background',
      fx_t: 'Fade · scale · blur',
      fx_d:
        'Each extra channel interpolates from,to across its window — data-sw-parallax-opacity, -scale and -blur — and they compose on one element.',
      t_fade: 'Fades in as it rises',
      t_scale: 'Grows as it scrolls up',
      t_blur: 'Comes into focus',
      anchor_t: 'Anchor the window — and animate back out',
      anchor_d:
        'By default an effect runs across the whole pass-through, so it peaks as the element leaves the top. Add -<effect>-range="0,0.5" to finish while it’s centred; a shorter window leaves room for an -<effect>-out phase that animates it back out.',
      t_window: 'Full opacity by centre (-opacity-range="0,0.5")',
      t_inout: 'Fades in to centre, then back out',
      nojs_t: 'Without JavaScript (or reduced motion)',
      nojs_d:
        'Every element stays exactly where it sits in the document — the runtime only adds a transform/opacity/filter on top, so nothing shifts, overlaps or disappears. Parallax is decoration, never structure.',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url page.parent.path}}">${icon('arrow-left', 'h-4 w-4')} {{page.parent.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-text="px_intro">Drive motion off scroll.</p>
  <pre class="mt-4 inline-block max-w-full overflow-x-auto text-xs"><code>-translate="40,-40"  ·  -opacity="0,1"  ·  -scale=".9,1.05"  ·  -blur="8,0"  ·  -opacity-range="0,0.5"  ·  -opacity-out="1,0"  ·  data-sw-parallax-scene / -layer</code></pre>
</section>

<!-- DEPTH SCENE (stacked absolute layers) — the showcase: the background DRIFTS + pushes in (translate +
     a cover-safe scale), while the heading composes EVERY channel at once — translate, opacity, scale and
     blur — each anchored to a Bottom-To-Centre window ("-range=0,0.5") with an animate-out ("-out"), so it
     rises, fades up, grows and sharpens into focus by centre, then eases back out as the scene leaves. -->
<section data-sw-parallax-scene class="mx-auto my-10 flex min-h-[68vh] max-w-7xl items-center justify-center rounded-3xl px-6">
  <div data-sw-parallax-layer data-sw-parallax-translate="80,-80" data-sw-parallax-scale="1.2,1.05" data-sw-parallax-scale-range="0,0.5" data-sw-parallax-scale-out="1.05,1.2" style="inset:-14% 0;background-image:radial-gradient(120% 90% at 15% 0%, color-mix(in oklab, var(--sw-color-secondary) 75%, #000) 0%, transparent 55%), radial-gradient(120% 110% at 90% 100%, color-mix(in oklab, var(--sw-color-accent) 65%, #000) 0%, transparent 50%), linear-gradient(135deg, var(--sw-color-primary), var(--sw-color-neutral));background-size:cover"></div>
  <div data-sw-parallax-layer
       data-sw-parallax-translate="0,-44"
       data-sw-parallax-opacity="0,1" data-sw-parallax-opacity-range="0,0.5" data-sw-parallax-opacity-out="1,0"
       data-sw-parallax-scale="0.8,1" data-sw-parallax-scale-range="0,0.5" data-sw-parallax-scale-out="1,1.08"
       data-sw-parallax-blur="12,0" data-sw-parallax-blur-range="0,0.5" data-sw-parallax-blur-out="0,8"
       class="grid place-items-center px-6 text-center text-white">
    <div>
      <h2 class="text-4xl font-bold tracking-tight drop-shadow-lg sm:text-6xl" data-sw-text="hero_t">Depth scene</h2>
      <p class="mx-auto mt-3 max-w-xl text-lg text-white/85" data-sw-text="hero_d">The background drifts while the heading rises, fades, scales and sharpens into focus by centre — then eases back out.</p>
    </div>
  </div>
</section>

<!-- DEPTH / FROM→TO MOVE -->
<section class="mx-auto max-w-6xl px-6 py-16">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="depth_t">Depth — a from→to move</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="depth_d">Slide between two pixel offsets.</p>
  <div class="mt-10 flex flex-wrap gap-6">
    <div data-sw-parallax-translate="90,-90" class="flex-1 basis-48 rounded-2xl border border-base-200 bg-base-100 p-7 text-center shadow-lg">
      <b class="block text-2xl font-bold text-primary">90 → −90</b>
      <span class="text-xs font-semibold uppercase tracking-wide text-base-content/50" data-sw-text="c1">foreground</span>
    </div>
    <div class="flex-1 basis-48 rounded-2xl border border-base-200 bg-base-100 p-7 text-center shadow-lg">
      <b class="block text-2xl font-bold text-primary">0</b>
      <span class="text-xs font-semibold uppercase tracking-wide text-base-content/50" data-sw-text="c2">static</span>
    </div>
    <div data-sw-parallax-translate="-30,30" class="flex-1 basis-48 rounded-2xl border border-base-200 bg-base-100 p-7 text-center shadow-lg">
      <b class="block text-2xl font-bold text-primary">−30 → 30</b>
      <span class="text-xs font-semibold uppercase tracking-wide text-base-content/50" data-sw-text="c3">background</span>
    </div>
  </div>
</section>

<!-- FADE / SCALE / BLUR -->
<section class="mx-auto max-w-6xl px-6 py-16">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="fx_t">Fade · scale · blur</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="fx_d">Each channel interpolates from,to across its window.</p>
  <div class="mt-10 grid gap-6 sm:grid-cols-3">
    <div data-sw-parallax-opacity="0.1,1" class="rounded-2xl bg-gradient-to-br from-primary to-secondary p-8 font-semibold text-primary-content shadow-xl" data-sw-text="t_fade">Fades in as it rises</div>
    <div data-sw-parallax-scale="0.85,1.05" class="rounded-2xl bg-gradient-to-br from-primary to-secondary p-8 font-semibold text-primary-content shadow-xl" data-sw-text="t_scale">Grows as it scrolls up</div>
    <div data-sw-parallax-blur="9,0" class="rounded-2xl bg-gradient-to-br from-primary to-secondary p-8 font-semibold text-primary-content shadow-xl" data-sw-text="t_blur">Comes into focus</div>
  </div>
</section>

<!-- ANCHORING / WINDOWS + OUT -->
<section class="mx-auto max-w-6xl px-6 py-16">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="anchor_t">Anchor the window — and animate back out</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="anchor_d">Finish while centred, or add an out phase.</p>
  <div class="mt-10 grid gap-6 sm:grid-cols-2">
    <div data-sw-parallax-opacity="0,1" data-sw-parallax-opacity-range="0,0.5" class="rounded-2xl bg-gradient-to-br from-primary to-secondary p-8 font-semibold text-primary-content shadow-xl" data-sw-text="t_window">Full opacity by centre</div>
    <div data-sw-parallax-opacity="0,1" data-sw-parallax-opacity-range="0,0.5" data-sw-parallax-opacity-out="1,0" data-sw-parallax-scale="0.9,1.05" data-sw-parallax-scale-range="0,0.5" data-sw-parallax-scale-out="1.05,0.9" class="rounded-2xl bg-gradient-to-br from-primary to-secondary p-8 font-semibold text-primary-content shadow-xl" data-sw-text="t_inout">Fades in to centre, then back out</div>
  </div>
</section>

<!-- NO-JS / A11Y -->
<section class="mx-auto max-w-6xl px-6 pb-28">
  <div class="rounded-2xl border border-base-200 bg-base-200/40 p-8">
    <h2 class="text-2xl font-bold tracking-tight" data-sw-text="nojs_t">Without JavaScript (or reduced motion)</h2>
    <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="nojs_d">Every element stays exactly where it sits in the document.</p>
  </div>
</section>`,
  };
}
