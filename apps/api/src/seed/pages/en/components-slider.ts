import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- SLIDER showcase (child of Components)
// Every Carousel variant the platform ships, defaults-first then each knob. Slide CONTENT comes
// from the localized `projects` dataset + Studio folder (no per-slide translation keys). The hero
// section is authored the EASY way — the `hero-slider` WIDGET ({{> hero-slider}}), which on save
// provisions a `hero` config dataset (settings + an editable slides list) and renders from it — to
// show that a full Ken Burns hero is one include with zero custom CSS, fully editable as data. The
// `<pre><code>` samples are intentionally untranslated.
export function pageComponentsSlider(): Page {
  return {
    id: 'comp-slider',
    path: 'slider',
    title: 'Sliders',
    description: 'The Carousel in every mode — hero, fade, slide, multi-item peek, alignment, auto-scroll ticker, wheel + auto-height, and click-to-slide.',
    parent: 'components',
    order: 1, // Sliders before Lightbox in the dropdown + hub cards

    data: {
      a_prev: 'Previous slide',
      a_next: 'Next slide',
      sld_intro: 'One component, every configuration. Each slider below is plain declarative markup — a data-sw-component root, data-sw-part slots, and data-* options.',
      sec_hero_t: 'Hero slider — one include',
      sec_hero_d: 'The classic frontpage opener: fixed-height background slides with an alternating Ken Burns drift and captions that rise in. This entire block is the hero-slider Widget — drop it in, then edit its slides (images + captions) as data. No custom CSS.',
      sec_fade_t: 'Slider — the defaults',
      sec_fade_d: 'No options at all: slides crossfade, arrows overlay mid-left and mid-right, indicators sit centered at the bottom.',
      aria_fade: 'Project slideshow (fade)',
      sec_slide_t: 'Slide effect, looping, autoplay',
      sec_slide_d: 'The translating strip instead of a crossfade, wrapping endlessly and advancing on its own — hover or focus pauses it.',
      aria_slide: 'Project slideshow (slide)',
      sec_items_t: 'Multiple items with a peek',
      sec_items_d: 'The --sw-items variable sets slides per view; a fractional value leaves a card peeking. data-item-align="center" centres the active card with a peek on both sides — and the first and last clamp to the edges. Drag, swipe, or use the arrows.',
      aria_items: 'Project cards',
      sec_align_t: 'Aligning a partial row',
      sec_align_d: 'When fewer items are shown than fill the row, data-item-align distributes them horizontally — start (default), center, or end — instead of leaving them stuck to the left.',
      aria_align: 'Featured tools (centered)',
      sec_scroll_t: 'Continuous auto-scroll',
      sec_scroll_d: 'A steady ticker instead of stepped slides — built for logo walls and image strips. It pauses while hovered or focused.',
      aria_scroll: 'Project ticker',
      sec_wheel_t: 'Wheel gestures & auto height',
      sec_wheel_d: 'Scroll the mouse wheel or trackpad over the slider to move it; the track animates its height to fit each quote.',
      aria_wheel: 'Client quotes',
      sec_click_t: 'Click to slide',
      sec_click_d: 'No arrows at all: click or tap anywhere on a slide to advance — every press answers with a ripple. Links inside a slide still behave like links, dragging still swipes, and arrow keys still work once the slider has focus.',
      aria_click: 'Project highlights (click to advance)',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url page.parent.path}}">${icon('arrow-left', 'h-4 w-4')} {{page.parent.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-text="sld_intro">One component, every configuration.</p>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_hero_t">Hero slider — one include</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_hero_d">This entire hero is one snippet — no custom CSS.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>&#123;&#123;&gt; hero-slider&#125;&#125;</code></pre>
  {{!-- Editor-only config picker: choose which Hero Slider config this page shows (stripped on publish). --}}
  <div class="mt-3 text-xs">{{sw-control as="dataset-item" dataset="hero" target="page.data.hero_config" label="Hero config"}}</div>
  <div class="mt-8">{{> hero-slider}}</div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_fade_t">Slider — the defaults</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_fade_d">No options at all: slides crossfade, arrows overlay mid-left and mid-right, indicators sit centered at the bottom.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>data-sw-component="carousel"</code></pre>
  <div class="relative mt-8 overflow-hidden rounded-3xl" data-sw-component="carousel" data-sw-block="Carousel" aria-label="{{page.data.aria_fade}}">
    <div data-sw-part="track">
      {{#each data.projects}}
      <figure data-sw-part="slide" class="relative">
        <img src="{{sw-url image}}" alt="{{title}}" class="!aspect-[16/9] w-full object-cover" loading="lazy" />
        <figcaption class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-6 pb-12 pt-16 text-white"><span class="text-xs font-semibold uppercase tracking-wider opacity-70">{{category}}</span><span class="block text-xl font-bold">{{title}}</span></figcaption>
      </figure>
      {{/each}}
    </div>
    <button type="button" data-sw-part="prev" aria-label="{{page.data.a_prev}}">{{sw-icon "chevron-left" "size-6"}}</button>
    <button type="button" data-sw-part="next" aria-label="{{page.data.a_next}}">{{sw-icon "chevron-right" "size-6"}}</button>
    <div data-sw-part="dots" aria-hidden="true"></div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_slide_t">Slide effect, looping, autoplay</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_slide_d">The translating strip instead of a crossfade, wrapping endlessly and advancing on its own — hover or focus pauses it.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>data-effect="slide" data-loop="true" data-autoplay="true" data-interval="4000"</code></pre>
  <div class="relative mt-8 overflow-hidden rounded-3xl" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-loop="true" data-autoplay="true" data-interval="4000" aria-label="{{page.data.aria_slide}}">
    <div data-sw-part="track">
      {{#each data.projects}}
      <figure data-sw-part="slide" class="relative">
        <img src="{{sw-url image}}" alt="{{title}}" class="!aspect-[16/9] w-full object-cover" loading="lazy" />
        <figcaption class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-6 pb-12 pt-16 text-white"><span class="text-xs font-semibold uppercase tracking-wider opacity-70">{{category}}</span><span class="block text-xl font-bold">{{title}}</span></figcaption>
      </figure>
      {{/each}}
    </div>
    <button type="button" data-sw-part="prev" aria-label="{{page.data.a_prev}}">{{sw-icon "chevron-left" "size-6"}}</button>
    <button type="button" data-sw-part="next" aria-label="{{page.data.a_next}}">{{sw-icon "chevron-right" "size-6"}}</button>
    <div data-sw-part="dots" aria-hidden="true"></div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_items_t">Multiple items with a peek</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_items_d">The --sw-items variable sets slides per view; a fractional value leaves a card peeking. data-item-align="center" centres the active card with a peek on both sides — and the first and last clamp to the edges. Drag, swipe, or use the arrows.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>data-effect="slide" data-item-align="center" class="[--sw-items:1.2] md:[--sw-items:2.4] lg:[--sw-items:3.2]"</code></pre>
  <div class="relative mt-8 [--sw-items:1.2] md:[--sw-items:2.4] lg:[--sw-items:3.2]" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-item-align="center" aria-label="{{page.data.aria_items}}">
    <div data-sw-part="track" class="overflow-hidden rounded-3xl">
      {{#each data.projects}}
      <figure data-sw-part="slide" class="px-3 py-1">
        <div class="card nw-card h-full overflow-hidden border border-base-200 bg-base-100 shadow-sm">
          <img src="{{sw-url image}}" alt="{{title}}" class="!aspect-[16/10] w-full object-cover" loading="lazy" />
          <div class="card-body p-6"><span class="text-xs font-semibold uppercase tracking-wider text-primary">{{category}}</span>
            <h3 class="text-lg font-bold tracking-tight">{{title}}</h3>
            <p class="text-sm text-base-content/60">{{client}}</p>
          </div>
        </div>
      </figure>
      {{/each}}
    </div>
    <button type="button" data-sw-part="prev" aria-label="{{page.data.a_prev}}">{{sw-icon "chevron-left" "size-6"}}</button>
    <button type="button" data-sw-part="next" aria-label="{{page.data.a_next}}">{{sw-icon "chevron-right" "size-6"}}</button>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_align_t">Aligning a partial row</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_align_d">When fewer items are shown than fill the row, data-item-align distributes them horizontally.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>data-item-align="center" class="[--sw-items:5]"</code></pre>
  <div class="relative mt-8 [--sw-items:5]" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-item-align="center" aria-label="{{page.data.aria_align}}">
    <div data-sw-part="track">
      <figure data-sw-part="slide" class="px-2"><div class="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border border-base-200 bg-base-100 text-primary shadow-sm">${icon('palette', 'h-8 w-8')}</div></figure>
      <figure data-sw-part="slide" class="px-2"><div class="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border border-base-200 bg-base-100 text-primary shadow-sm">${icon('code', 'h-8 w-8')}</div></figure>
      <figure data-sw-part="slide" class="px-2"><div class="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border border-base-200 bg-base-100 text-primary shadow-sm">${icon('rocket', 'h-8 w-8')}</div></figure>
    </div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_scroll_t">Continuous auto-scroll</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_scroll_d">A steady ticker instead of stepped slides — built for logo walls and image strips. It pauses while hovered or focused.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>data-autoscroll="true" data-autoscroll-speed="1.5" data-loop="true" data-effect="slide"</code></pre>
  <div class="relative mt-8 [--sw-items:2] md:[--sw-items:4]" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-loop="true" data-autoscroll="true" data-autoscroll-speed="1.5" aria-label="{{page.data.aria_scroll}}">
    <div data-sw-part="track" class="overflow-hidden rounded-2xl">
      {{#each data.projects}}
      <figure data-sw-part="slide" class="px-2">
        <img src="{{sw-url image}}" alt="{{title}}" class="!aspect-[4/3] w-full rounded-xl object-cover" loading="lazy" />
      </figure>
      {{/each}}
    </div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_wheel_t">Wheel gestures &amp; auto height</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_wheel_d">Scroll the mouse wheel or trackpad over the slider to move it; the track animates its height to fit each quote.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>data-wheel="true" data-autoheight="true" data-effect="slide"</code></pre>
  <div class="relative mt-8 mx-auto max-w-3xl" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-wheel="true" data-autoheight="true" aria-label="{{page.data.aria_wheel}}">
    <div data-sw-part="track">
      {{#each data.projects}}
      <figure data-sw-part="slide" class="px-2 pb-10">
        <blockquote class="rounded-3xl border border-base-200 bg-base-100 p-8 shadow-sm">
          <p class="text-lg leading-relaxed">{{summary}}</p>
          <div class="mt-4 text-sm font-semibold text-base-content/60">{{client}} · {{year}}</div>
        </blockquote>
      </figure>
      {{/each}}
    </div>
    <button type="button" data-sw-part="prev" aria-label="{{page.data.a_prev}}" class="!bg-base-200 !text-base-content top-[calc(50%-1.25rem)]">{{sw-icon "chevron-left" "size-6"}}</button>
    <button type="button" data-sw-part="next" aria-label="{{page.data.a_next}}" class="!bg-base-200 !text-base-content top-[calc(50%-1.25rem)]">{{sw-icon "chevron-right" "size-6"}}</button>
    <div data-sw-part="dots" aria-hidden="true" class="!bottom-2 text-primary"></div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-28">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_click_t">Click to slide</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_click_d">No arrows at all: click or tap anywhere on a slide to advance — every press answers with a ripple. Links inside a slide still behave like links, dragging still swipes, and arrow keys still work once the slider has focus.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>data-click-next="true"</code></pre>
  <div class="relative mt-8 overflow-hidden rounded-3xl" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-loop="true" data-click-next="true" aria-label="{{page.data.aria_click}}">
    <div data-sw-part="track">
      {{#each data.projects}}
      <figure data-sw-part="slide" class="relative">
        <img src="{{sw-url image}}" alt="{{title}}" class="!aspect-[21/9] w-full object-cover" loading="lazy" />
        <figcaption class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-6 pb-10 pt-16 text-white"><span class="block text-xl font-bold">{{title}}</span></figcaption>
      </figure>
      {{/each}}
    </div>
    <div data-sw-part="dots" aria-hidden="true"></div>
  </div>
</section>`,
  };
}
