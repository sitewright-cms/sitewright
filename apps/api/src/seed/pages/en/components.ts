import type { Page } from '@sitewright/schema';

// ---------------------------------------------------------------- COMPONENT SHOWCASE
// A living reference for the first-party interactive components: every Carousel and Lightbox
// variant/option side by side — defaults first, then each knob. Slide/gallery CONTENT comes
// from the localized `projects` dataset and the Studio media folder, so the showcase adds no
// per-slide translation keys; the `<code>` attribute chips under each heading are intentionally
// untranslated (they are code, identical in every locale). Doubles as canonical agent-authored
// markup for the COMPONENT_CATALOG contracts.
export function pageComponents(assets: Record<string, string>): Page {
  return {
    id: 'components',
    path: 'components',
    title: 'Component Showcase',
    description: 'Sliders and galleries in every variant the platform ships — fade and slide effects, peek and multi-item layouts, auto-scroll, and lightbox galleries.',
    parent: 'home',
    nav: { title: 'Showcase', slots: ['header'], order: 8 },
    // Tier-2 attribute keys (aria labels) — present in EVERY locale, including EN.
    // hero_bg_* are data-sw-bg bindings (editable background images): URL values, identical
    // across locales, repeated in each variant's data — same pattern as the blog article_image.
    data: {
      a_prev: 'Previous slide',
      a_next: 'Next slide',
      aria_hero: 'Welcome slideshow',
      hero_bg_1: assets['proj-aria'] ?? '',
      hero_bg_2: assets['proj-flint'] ?? '',
      hero_bg_3: assets['proj-harbor'] ?? '',
      aria_fade: 'Project slideshow (fade)',
      aria_slide: 'Project slideshow (slide)',
      aria_items: 'Project cards',
      aria_scroll: 'Project ticker',
      aria_wheel: 'Client quotes',
      aria_click: 'Project highlights (click to advance)',
      aria_gallery: 'Studio gallery',
      aria_gallery2: 'Project gallery',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <div class="nw-rise max-w-2xl">
    <span class="text-sm font-semibold uppercase tracking-[0.18em] text-primary" data-sw-text="comp_eyebrow">Showcase</span>
    <h1 class="mt-4 text-4xl font-bold tracking-tight sm:text-6xl" data-sw-text="comp_h1">Sliders &amp; galleries, every variant</h1>
    <p class="mt-5 text-lg leading-relaxed text-base-content/60" data-sw-text="comp_intro">The interactive components this site is built with, shown in every configuration — defaults first, then each option. Everything below works with keyboard, touch, and without JavaScript.</p>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_hero_t">Hero slider — backgrounds, Ken Burns &amp; caption motion</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_hero_d">The classic frontpage opener: fixed-height slides with editable background images (no img elements), captions that rise in on a blurred glass pill, full-height gradient arrows that grow on hover, and an alternating Ken Burns drift on every activation. All of it is plain CSS keyed off the data-active marker the runtime stamps on the current slide.</p>
  <p class="mt-3 font-mono text-xs text-base-content/40"><code>data-sw-bg + [data-active] CSS hook — kenburns/caption keyframes live in the site stylesheet</code></p>
  <div class="nw-hero relative mt-8 overflow-hidden rounded-3xl" data-sw-component="carousel" data-sw-block="Carousel" data-loop="true" data-autoplay="true" data-interval="6000" aria-label="{{page.data.aria_hero}}">
    <div data-sw-part="track">
      <div data-sw-part="slide" class="relative h-[60vh] min-h-[420px] max-h-[640px] overflow-hidden">
        <div class="nw-hero-bg absolute inset-0 bg-cover bg-center" data-sw-bg="hero_bg_1"></div>
        <div class="relative z-10 flex h-full items-center justify-center px-6">
          <div class="nw-hero-cap rounded-xl bg-black/40 px-7 py-3.5 text-center text-xl font-semibold uppercase tracking-wider text-white shadow-2xl backdrop-blur-md sm:text-2xl" data-sw-text="hero_cap_1">Welcome to Northwind Studio</div>
        </div>
      </div>
      <div data-sw-part="slide" class="relative h-[60vh] min-h-[420px] max-h-[640px] overflow-hidden">
        <div class="nw-hero-bg absolute inset-0 bg-cover bg-center" data-sw-bg="hero_bg_2"></div>
        <div class="relative z-10 flex h-full items-center justify-center px-6">
          <div class="nw-hero-cap rounded-xl bg-black/40 px-7 py-3.5 text-center text-xl font-semibold uppercase tracking-wider text-white shadow-2xl backdrop-blur-md sm:text-2xl" data-sw-text="hero_cap_2">Websites with real craft</div>
        </div>
      </div>
      <div data-sw-part="slide" class="relative h-[60vh] min-h-[420px] max-h-[640px] overflow-hidden">
        <div class="nw-hero-bg absolute inset-0 bg-cover bg-center" data-sw-bg="hero_bg_3"></div>
        <div class="relative z-10 flex h-full items-center justify-center px-6">
          <div class="nw-hero-cap rounded-xl bg-black/40 px-7 py-3.5 text-center text-xl font-semibold uppercase tracking-wider text-white shadow-2xl backdrop-blur-md sm:text-2xl" data-sw-text="hero_cap_3">Built to perform</div>
        </div>
      </div>
    </div>
    <button type="button" data-sw-part="prev" class="group absolute inset-y-0 left-0 z-10 flex h-full w-20 transform-none items-center justify-start rounded-none bg-transparent bg-gradient-to-r from-black/60 via-black/20 to-transparent pl-4 text-white opacity-70 transition-opacity duration-300 hover:opacity-100 sm:w-36" aria-label="{{page.data.a_prev}}">{{sw-icon "chevron-left" "size-25 drop-shadow-lg scale-[0.6] transition-transform duration-300 group-hover:scale-[0.7] group-hover:-translate-x-5 group-active:-translate-x-10"}}</button>
    <button type="button" data-sw-part="next" class="group absolute inset-y-0 right-0 z-10 flex h-full w-20 transform-none items-center justify-end rounded-none bg-transparent bg-gradient-to-l from-black/60 via-black/20 to-transparent pr-4 text-white opacity-70 transition-opacity duration-300 hover:opacity-100 sm:w-36" aria-label="{{page.data.a_next}}">{{sw-icon "chevron-right" "size-25 drop-shadow-lg scale-[0.6] transition-transform duration-300 group-hover:scale-[0.7] group-hover:translate-x-5 group-active:translate-x-10"}}</button>
    <div data-sw-part="dots" aria-hidden="true"></div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_fade_t">Slider — the defaults</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_fade_d">No options at all: slides crossfade, arrows overlay mid-left and mid-right, indicators sit centered at the bottom.</p>
  <p class="mt-3 font-mono text-xs text-base-content/40"><code>data-sw-component="carousel"</code></p>
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
  <p class="mt-3 font-mono text-xs text-base-content/40"><code>data-effect="slide" data-loop="true" data-autoplay="true" data-interval="4000"</code></p>
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
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_items_d">The --sw-items variable sets slides per view; a fractional value leaves the next card peeking in from the edge. Drag, swipe, or use the arrows.</p>
  <p class="mt-3 font-mono text-xs text-base-content/40"><code>data-effect="slide" data-loop="true" class="[--sw-items:1.2] md:[--sw-items:2.4] lg:[--sw-items:3.2]"</code></p>
  <div class="relative mt-8 [--sw-items:1.2] md:[--sw-items:2.4] lg:[--sw-items:3.2]" data-sw-component="carousel" data-sw-block="Carousel" data-effect="slide" data-loop="true" aria-label="{{page.data.aria_items}}">
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
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_scroll_t">Continuous auto-scroll</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_scroll_d">A steady ticker instead of stepped slides — built for logo walls and image strips. It pauses while hovered or focused.</p>
  <p class="mt-3 font-mono text-xs text-base-content/40"><code>data-autoscroll="true" data-autoscroll-speed="1.5" data-loop="true" data-effect="slide"</code></p>
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
  <p class="mt-3 font-mono text-xs text-base-content/40"><code>data-wheel="true" data-autoheight="true" data-effect="slide"</code></p>
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

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_click_t">Click to slide</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_click_d">No arrows at all: click or tap anywhere on a slide to advance — every press answers with a ripple. Links inside a slide still behave like links, dragging still swipes, and arrow keys still work once the slider has focus.</p>
  <p class="mt-3 font-mono text-xs text-base-content/40"><code>data-click-next="true"</code></p>
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
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_lb_t">Lightbox — the defaults</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_lb_d">Click any photo: the gallery opens full-screen with a zoom animation, slides between pictures, and closes on Escape. Swipe on touch, arrows on keys.</p>
  <p class="mt-3 font-mono text-xs text-base-content/40"><code>data-sw-component="lightbox"</code></p>
  <div class="mt-8" data-sw-component="lightbox" data-sw-block="Lightbox" aria-label="{{page.data.aria_gallery}}">
    <div data-sw-part="grid" class="gap-4 !grid-cols-2 md:!grid-cols-4">
      {{#sw-folder "Studio" kind="image"}}
      <a data-sw-part="item" href="{{sw-url url}}" data-caption="{{alt}}" class="overflow-hidden rounded-2xl shadow-sm transition-shadow hover:shadow-xl nw-zoom">
        <img src="{{sw-url url}}" alt="{{alt}}" loading="lazy" />
      </a>
      {{/sw-folder}}
    </div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-28">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_lbfx_t">Lightbox — fade &amp; loop</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_lbfx_d">The same gallery with fade open/close, fading picture changes, and wrap-around navigation — past the last image lands on the first.</p>
  <p class="mt-3 font-mono text-xs text-base-content/40"><code>data-effect="fade" data-slide-effect="fade" data-loop="true"</code></p>
  <div class="mt-8" data-sw-component="lightbox" data-sw-block="Lightbox" data-effect="fade" data-slide-effect="fade" data-loop="true" aria-label="{{page.data.aria_gallery2}}">
    <div data-sw-part="grid" class="gap-4 !grid-cols-3 md:!grid-cols-6">
      {{#each data.projects}}
      <a data-sw-part="item" href="{{sw-url image}}" data-caption="{{title}} — {{summary}}" class="overflow-hidden rounded-xl nw-zoom">
        <img src="{{sw-url image}}" alt="{{title}}" loading="lazy" />
      </a>
      {{/each}}
    </div>
  </div>
</section>`,
  };
}
