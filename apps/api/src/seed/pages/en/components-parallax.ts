import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- PARALLAX showcase (child of Components)
// The scroll-linked property engine: one runtime drives translate (parallax SPEED), opacity, scale and
// blur off each element's scroll position, plus a clipped background-drift section. Authored as plain
// data-sw-parallax* attributes — the platform ships the runtime only when used. All motion sits behind
// prefers-reduced-motion (a static, in-flow page without it). Copy bound via data-sw-text/page.data so
// the de/es variants translate (a `data:` block per locale); `<pre><code>` samples stay untranslated.
export function pageComponentsParallax(): Page {
  return {
    id: 'comp-parallax',
    path: 'parallax',
    title: 'Parallax',
    description:
      'Scroll-linked depth, fade, scale and blur — one tiny runtime driven by data-sw-parallax attributes, with a clipped background-drift section. Subtle by default and fully disabled under reduced motion.',
    parent: 'components',
    order: 9,
    data: {
      px_intro:
        'Drive depth off scroll. Add a data-sw-parallax attribute to any element and the platform ships a tiny runtime that translates, fades, scales or blurs it as it passes through the viewport — composable, clamped, and switched off entirely for visitors who prefer reduced motion. Scroll down.',
      hero_t: 'Background drift',
      hero_d: 'A clipped section whose oversized background layer scrolls slower than the page.',
      depth_t: 'Depth — translate speed',
      depth_d:
        'data-sw-parallax="s" sets the speed: 0 is static, a positive value recedes (lags the scroll), a negative value leads (floats toward you). Clamped to ±2. Watch the cards drift at different rates.',
      c1: 'leads',
      c2: 'static',
      c3: 'recedes',
      fx_t: 'Fade · scale · blur',
      fx_d:
        'Each extra channel interpolates from,to across the element’s pass through the viewport — data-sw-parallax-opacity, -scale and -blur — and they compose on one element.',
      t_fade: 'Fades in as it rises',
      t_scale: 'Grows as it scrolls up',
      t_blur: 'Comes into focus',
      nojs_t: 'Without JavaScript (or reduced motion)',
      nojs_d:
        'Every element stays exactly where it sits in the document — the runtime only adds a transform/opacity/filter on top, so nothing shifts, overlaps or disappears. Parallax is decoration, never structure.',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url page.parent.path}}">${icon('arrow-left', 'h-4 w-4')} {{page.parent.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-text="px_intro">Drive depth off scroll.</p>
  <pre class="mt-4 inline-block max-w-full overflow-x-auto text-xs"><code>data-sw-parallax="0.3"  ·  -opacity="0,1"  ·  -scale=".9,1.05"  ·  -blur="8,0"  ·  data-sw-parallax-bg</code></pre>
</section>

<!-- BACKGROUND DRIFT -->
<section data-sw-parallax-bg data-sw-parallax="0.4" class="mx-auto my-10 flex min-h-[68vh] max-w-7xl items-center justify-center rounded-3xl px-6">
  <div data-sw-parallax-layer style="background-image:radial-gradient(120% 90% at 15% 0%, color-mix(in oklab, var(--sw-color-secondary) 75%, #000) 0%, transparent 55%), radial-gradient(120% 110% at 90% 100%, color-mix(in oklab, var(--sw-color-accent) 65%, #000) 0%, transparent 50%), linear-gradient(135deg, var(--sw-color-primary), var(--sw-color-neutral))"></div>
  <div class="text-center text-white">
    <h2 class="text-4xl font-bold tracking-tight drop-shadow-lg sm:text-6xl" data-sw-text="hero_t">Background drift</h2>
    <p class="mx-auto mt-3 max-w-xl text-lg text-white/85" data-sw-text="hero_d">A clipped section whose background drifts slower than the page.</p>
  </div>
</section>

<!-- DEPTH / SPEED -->
<section class="mx-auto max-w-6xl px-6 py-16">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="depth_t">Depth — translate speed</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="depth_d">Positive recedes, negative leads.</p>
  <div class="mt-10 flex flex-wrap gap-6">
    <div data-sw-parallax="-0.5" class="flex-1 basis-48 rounded-2xl border border-base-200 bg-base-100 p-7 text-center shadow-lg">
      <b class="block text-3xl font-bold text-primary">−0.5</b>
      <span class="text-xs font-semibold uppercase tracking-wide text-base-content/50" data-sw-text="c1">leads</span>
    </div>
    <div data-sw-parallax="0" class="flex-1 basis-48 rounded-2xl border border-base-200 bg-base-100 p-7 text-center shadow-lg">
      <b class="block text-3xl font-bold text-primary">0</b>
      <span class="text-xs font-semibold uppercase tracking-wide text-base-content/50" data-sw-text="c2">static</span>
    </div>
    <div data-sw-parallax="0.5" class="flex-1 basis-48 rounded-2xl border border-base-200 bg-base-100 p-7 text-center shadow-lg">
      <b class="block text-3xl font-bold text-primary">0.5</b>
      <span class="text-xs font-semibold uppercase tracking-wide text-base-content/50" data-sw-text="c3">recedes</span>
    </div>
  </div>
</section>

<!-- FADE / SCALE / BLUR -->
<section class="mx-auto max-w-6xl px-6 py-16">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="fx_t">Fade · scale · blur</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="fx_d">Each channel interpolates from,to across the scroll.</p>
  <div class="mt-10 grid gap-6 sm:grid-cols-3">
    <div data-sw-parallax-opacity="0.1,1" class="rounded-2xl bg-gradient-to-br from-primary to-secondary p-8 font-semibold text-primary-content shadow-xl" data-sw-text="t_fade">Fades in as it rises</div>
    <div data-sw-parallax-scale="0.85,1.05" class="rounded-2xl bg-gradient-to-br from-primary to-secondary p-8 font-semibold text-primary-content shadow-xl" data-sw-text="t_scale">Grows as it scrolls up</div>
    <div data-sw-parallax-blur="9,0" class="rounded-2xl bg-gradient-to-br from-primary to-secondary p-8 font-semibold text-primary-content shadow-xl" data-sw-text="t_blur">Comes into focus</div>
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
