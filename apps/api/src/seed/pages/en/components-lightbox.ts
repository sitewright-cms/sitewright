import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- LIGHTBOX showcase (child of Components)
// The GLightbox-backed gallery in both modes — the zoom default and the fade + loop variant.
// Grids come from the Studio media folder ({{#sw-folder}}) and the localized `projects` dataset.
export function pageComponentsLightbox(): Page {
  return {
    id: 'comp-lightbox',
    path: 'lightbox',
    title: 'Lightbox',
    description: 'The full-screen gallery viewer — zoom or fade open/close, keyboard + swipe navigation, captions, and optional wrap-around looping.',
    parent: 'components',
    order: 2,

    data: {
      lb_intro: 'A photo grid that opens full-screen on click — keyboard, swipe, and pinch-zoom, with focus restored to the thumbnail on close.',
      sec_lb_t: 'Lightbox — the defaults',
      sec_lb_d: 'Click any photo: the gallery opens full-screen with a zoom animation, slides between pictures, and closes on Escape. Swipe on touch, arrows on keys.',
      aria_gallery: 'Studio gallery',
      sec_lbfx_t: 'Lightbox — fade & loop',
      sec_lbfx_d: 'The same gallery with fade open/close, fading picture changes, and wrap-around navigation — past the last image lands on the first.',
      aria_gallery2: 'Project gallery',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url parentPage.path}}">${icon('arrow-left', 'h-4 w-4')} {{parentPage.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-text="lb_intro">A photo grid that opens full-screen on click.</p>
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
