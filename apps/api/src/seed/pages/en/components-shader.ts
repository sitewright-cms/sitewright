import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- ANIMATED BACKGROUND showcase (child of Components)
// The WebGL animated-background component (`data-sw-component="shader-bg"`): a CSP-clean runtime that
// paints a CI-themed shader behind any section — 30 presets, tuned only by declarative data-* knobs
// (preset / speed / intensity / angle / colors / interactive), never author JavaScript. It pauses
// offscreen + when the tab is hidden, renders a single static frame under reduced motion, and falls
// back to a CSS gradient (built from the same brand tokens) with JS off. Copy is bound via
// data-sw-text → page.data so the de/es inherit-mode variants translate; preset slugs stay literal.
export function pageComponentsShader(): Page {
  return {
    id: 'comp-shader',
    path: 'animated-background',
    title: 'Animated background',
    description:
      'A WebGL animated background behind any section — 30 CI-themed presets, tuned only by declarative data-* knobs (preset, speed, intensity, angle, colors, interactive), never author code. CSP-clean, paused offscreen, a single static frame under reduced motion, and a CSS-gradient fallback with JS off.',
    parent: 'components',
    order: 10,
    data: {
      intro_lead:
        'A living background, no video and no image. Add data-sw-component="shader-bg" to any section and the platform ships a tiny, CSP-clean WebGL runtime that paints a CI-themed shader behind your content — pick a preset, tune it with a few data-* attributes, and it follows your brand colors and light/dark theme. It pauses when offscreen, renders one static frame under reduced motion, and falls back to a brand gradient with JavaScript off.',
      hero_t: 'Set the mood in one attribute',
      hero_d:
        'This whole panel is a single shader-bg — move your pointer across it. The colors are your CI tokens; a legibility scrim keeps text crisp on top.',
      presets_t: 'A preset for every mood',
      presets_d:
        'Thirty named presets ship in — from soft mesh gradients to flowing silk, caustics, lava and starfields. Set data-preset and the rest is automatic; here are six, each recolored to this site’s palette.',
      p_mesh: 'Mesh gradient',
      p_silk: 'Silk flow',
      p_caustics: 'Caustics',
      p_lava: 'Lava lamp',
      p_waterfall: 'Waterfall',
      p_starfield: 'Starfield',
      knobs_t: 'Tune it with data-*',
      knobs_d:
        'Beyond the preset, four optional knobs shape the look — data-speed (0–4), data-intensity (0–1, saturation + brightness), data-angle (degrees) and data-interactive (let the pointer morph it). data-colors can even remap the three palette slots to other CI tokens.',
      k_calm: 'Calm — low intensity, slow',
      k_vivid: 'Vivid — high intensity',
      k_interactive: 'Interactive — follows the pointer',
      nojs_t: 'CSP-clean, accessible, and never required',
      nojs_d:
        'The runtime ships as one external components.js from your own origin (no inline script, eval or Workers), only when a page uses it. With JavaScript off — or under prefers-reduced-motion — the background is a still CSS gradient from the same brand tokens, so the content never depends on the animation.',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url page.parent.path}}">${icon('arrow-left', 'h-4 w-4')} {{page.parent.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-text="intro_lead">A living background, no video and no image.</p>
  <pre class="mt-4 inline-block max-w-full overflow-x-auto text-xs"><code>data-sw-component="shader-bg"  ·  data-preset="silk-flow"  ·  data-speed="1"  ·  data-intensity=".6"  ·  data-angle="0"  ·  data-interactive="true"  ·  data-colors="accent,primary,neutral"</code></pre>
</section>

<!-- HERO: a single interactive shader-bg with a legibility scrim (data-sw-part="overlay", painted
     above the canvas but below content) so the heading stays crisp over the brightest frames. -->
<section class="mx-auto max-w-7xl px-6">
  <div class="relative grid min-h-[60vh] place-items-center overflow-hidden rounded-3xl px-6 text-center text-white shadow-2xl shadow-primary/15" data-sw-component="shader-bg" data-preset="silk-flow" data-speed="1" data-intensity="0.6" data-interactive="true">
    <div data-sw-part="overlay" class="bg-neutral/40" aria-hidden="true"></div>
    <div class="relative max-w-2xl">
      <h2 class="text-4xl font-bold tracking-tight drop-shadow-lg sm:text-6xl" data-sw-text="hero_t">Set the mood in one attribute</h2>
      <p class="mx-auto mt-4 max-w-xl text-lg text-white/85" data-sw-text="hero_d">This whole panel is a single shader-bg — move your pointer across it.</p>
    </div>
  </div>
</section>

<!-- PRESET GALLERY: six presets, each recolored to the project palette. Every tile carries the CSS
     gradient fallback (::before) until the runtime enhances it. -->
<section class="mx-auto max-w-6xl px-6 py-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="presets_t">A preset for every mood</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="presets_d">Thirty named presets ship in.</p>
  <div class="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
    <div class="relative grid h-48 place-items-end overflow-hidden rounded-2xl p-4 shadow-lg" data-sw-component="shader-bg" data-preset="mesh-gradient" data-speed="0.7" data-intensity="0.6">
      <span class="relative rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white backdrop-blur" data-sw-text="p_mesh">Mesh gradient</span>
    </div>
    <div class="relative grid h-48 place-items-end overflow-hidden rounded-2xl p-4 shadow-lg" data-sw-component="shader-bg" data-preset="silk-flow" data-speed="0.9" data-intensity="0.6">
      <span class="relative rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white backdrop-blur" data-sw-text="p_silk">Silk flow</span>
    </div>
    <div class="relative grid h-48 place-items-end overflow-hidden rounded-2xl p-4 shadow-lg" data-sw-component="shader-bg" data-preset="caustics" data-speed="0.8" data-intensity="0.62">
      <span class="relative rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white backdrop-blur" data-sw-text="p_caustics">Caustics</span>
    </div>
    <div class="relative grid h-48 place-items-end overflow-hidden rounded-2xl p-4 shadow-lg" data-sw-component="shader-bg" data-preset="lava-lamp" data-speed="0.6" data-intensity="0.6">
      <span class="relative rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white backdrop-blur" data-sw-text="p_lava">Lava lamp</span>
    </div>
    <div class="relative grid h-48 place-items-end overflow-hidden rounded-2xl p-4 shadow-lg" data-sw-component="shader-bg" data-preset="waterfall" data-speed="1" data-intensity="0.58">
      <span class="relative rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white backdrop-blur" data-sw-text="p_waterfall">Waterfall</span>
    </div>
    <div class="relative grid h-48 place-items-end overflow-hidden rounded-2xl p-4 shadow-lg" data-sw-component="shader-bg" data-preset="starfield" data-speed="0.5" data-intensity="0.7">
      <span class="relative rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white backdrop-blur" data-sw-text="p_starfield">Starfield</span>
    </div>
  </div>
</section>

<!-- DATA-* KNOBS: the same preset under different knobs — calm vs vivid, and pointer-interactive. -->
<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="knobs_t">Tune it with data-*</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="knobs_d">Four optional knobs shape the look.</p>
  <div class="mt-10 grid gap-5 sm:grid-cols-3">
    <div class="relative grid h-44 place-items-end overflow-hidden rounded-2xl p-4 shadow-lg" data-sw-component="shader-bg" data-preset="mesh-gradient" data-speed="0.4" data-intensity="0.3">
      <span class="relative rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white backdrop-blur" data-sw-text="k_calm">Calm — low intensity, slow</span>
    </div>
    <div class="relative grid h-44 place-items-end overflow-hidden rounded-2xl p-4 shadow-lg" data-sw-component="shader-bg" data-preset="mesh-gradient" data-speed="1.4" data-intensity="0.95">
      <span class="relative rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white backdrop-blur" data-sw-text="k_vivid">Vivid — high intensity</span>
    </div>
    <div class="relative grid h-44 place-items-end overflow-hidden rounded-2xl p-4 shadow-lg" data-sw-component="shader-bg" data-preset="pointer-ripples" data-speed="0.8" data-intensity="0.6" data-interactive="true">
      <span class="relative rounded-full bg-black/40 px-3 py-1 text-xs font-semibold text-white backdrop-blur" data-sw-text="k_interactive">Interactive — follows the pointer</span>
    </div>
  </div>
</section>

<!-- CSP / A11Y / NO-JS -->
<section class="mx-auto max-w-6xl px-6 pb-28">
  <div class="rounded-2xl border border-base-200 bg-base-200/40 p-8">
    <h2 class="text-2xl font-bold tracking-tight" data-sw-text="nojs_t">CSP-clean, accessible, and never required</h2>
    <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="nojs_d">The runtime ships as one external components.js from your own origin.</p>
  </div>
</section>`,
  };
}
