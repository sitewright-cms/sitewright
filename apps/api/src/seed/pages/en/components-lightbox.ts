import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- LIGHTBOX showcase (child of Components)
// The SmartPhoto-backed gallery across its switches: the full-feature default (thumbnail strip,
// enlarge-from-thumbnail open, counter + caption), a stripped-down viewer (no strip/arrows), and
// fill mode + options. Tiles are PE-safe polished cards: a DaisyUI .skeleton loader behind a
// cover-cropped <img> (the viewer's clone + strip source) with a dim gradient overlay on top.
// Grids come from the Studio media folder ({{#sw-folder}}) and the localized `projects` dataset.
export function pageComponentsLightbox(): Page {
  return {
    id: 'comp-lightbox',
    path: 'lightbox',
    title: 'Lightbox',
    description:
      'The full-screen gallery viewer — a bottom thumbnail strip, an enlarge-from-thumbnail open animation, an image counter + caption, keyboard + swipe + pinch-zoom, and switches for the strip, arrows, fit, and more.',
    parent: 'components',
    order: 2,

    data: {
      lb_intro:
        'A photo grid that opens full-screen on click — the picture enlarges from its tile, a thumbnail strip and image counter ride along, and swipe / pinch-zoom / keyboard all work. Focus returns to the tile on close.',
      sec_lb_t: 'Lightbox — the defaults',
      sec_lb_d:
        'Click any photo: it enlarges from its tile into a full-screen viewer with a bottom thumbnail strip, an image counter and a caption. Swipe or pinch on touch, arrow keys on desktop, Escape to close.',
      aria_gallery: 'Studio gallery',
      sec_lbfx_t: 'Lightbox — stripped down',
      sec_lbfx_d:
        'The same gallery with the thumbnail strip and the arrows switched off — a cleaner viewer driven by swipe, keyboard and the counter alone.',
      aria_gallery2: 'Project gallery',
      sec_lb3_t: 'Lightbox — fill the screen',
      sec_lb3_d:
        'Fit can fill the viewport instead of showing the whole image, the open animation can be turned off, and the open picture can be reflected in the URL. On mobile the zoomed image can pan with the device tilt.',
      aria_gallery3: 'Studio gallery, fill mode',
      sec_single_t: 'Lightbox — a single image (one line)',
      sec_single_d:
        'No grid scaffolding needed: put data-sw-component="lightbox" straight on an <img> and that one image opens full-screen on click — the whole lightbox in a single line.',
      aria_single: 'Featured photo',
      sec_masonry_t: 'Lightbox — masonry grid',
      sec_masonry_d:
        'Mixed-aspect images — portraits, landscapes and wide covers — staggered into balanced CSS columns with no cropping. The attribute goes straight on the columns container; the images become one gallery.',
      aria_masonry: 'Masonry gallery',
      sec_group_t: 'Lightbox — one gallery from separate images',
      sec_group_d:
        'These images are separate elements in their own cards, but a shared data-gallery name merges them into one lightbox — click either and page through both. The same works across different sections of the page.',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url parentPage.path}}">${icon('arrow-left', 'h-4 w-4')} {{parentPage.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-text="lb_intro">A photo grid that opens full-screen on click.</p>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_lb_t">Lightbox — the defaults</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_lb_d">Click any photo to open the gallery full-screen.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>data-sw-component="lightbox"</code></pre>
  <div class="mt-8" data-sw-component="lightbox" data-sw-block="Lightbox" aria-label="{{page.data.aria_gallery}}">
    <div data-sw-part="grid" class="gap-4 !grid-cols-2 md:!grid-cols-4">
      {{#sw-folder "Studio" kind="image"}}
      <a data-sw-part="item" href="{{sw-url url}}" data-caption="{{alt}}" class="group relative block aspect-[4/3] overflow-hidden rounded-2xl bg-base-200 shadow-sm transition-shadow duration-300 hover:shadow-xl">
        <span class="skeleton absolute inset-0 z-0" aria-hidden="true"></span>
        <img src="{{sw-url url}}" alt="{{alt}}" loading="lazy" class="relative z-10 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <span class="pointer-events-none absolute inset-0 z-20 bg-gradient-to-t from-black/40 via-black/0 to-black/0 opacity-60 transition-opacity duration-300 group-hover:opacity-90" aria-hidden="true"></span>
      </a>
      {{/sw-folder}}
    </div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_lbfx_t">Lightbox — stripped down</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_lbfx_d">The same gallery with the thumbnail strip and arrows turned off.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>data-thumbnails="false" data-arrows="false"</code></pre>
  <div class="mt-8" data-sw-component="lightbox" data-sw-block="Lightbox" data-thumbnails="false" data-arrows="false" aria-label="{{page.data.aria_gallery2}}">
    <div data-sw-part="grid" class="gap-4 !grid-cols-3 md:!grid-cols-6">
      {{#each data.projects}}
      <a data-sw-part="item" href="{{sw-url image}}" data-caption="{{title}} — {{summary}}" class="group relative block aspect-[10/7] overflow-hidden rounded-xl bg-base-200">
        <span class="skeleton absolute inset-0 z-0" aria-hidden="true"></span>
        <img src="{{sw-url image}}" alt="{{title}}" loading="lazy" class="relative z-10 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <span class="pointer-events-none absolute inset-0 z-20 bg-gradient-to-t from-black/40 via-black/0 to-black/0 opacity-50 transition-opacity duration-300 group-hover:opacity-90" aria-hidden="true"></span>
      </a>
      {{/each}}
    </div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-28">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_lb3_t">Lightbox — fill the screen</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_lb3_d">Fill the viewport, drop the open animation, reflect the image in the URL, and allow tilt-to-pan on mobile.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>data-fit="fill" data-animation="false" data-history="true" data-tilt="true"</code></pre>
  <div class="mt-8" data-sw-component="lightbox" data-sw-block="Lightbox" data-fit="fill" data-animation="false" data-history="true" data-tilt="true" aria-label="{{page.data.aria_gallery3}}">
    <div data-sw-part="grid" class="gap-4 !grid-cols-2 md:!grid-cols-4">
      {{#sw-folder "Studio" kind="image"}}
      <a data-sw-part="item" href="{{sw-url url}}" data-caption="{{alt}}" class="group relative block aspect-[4/3] overflow-hidden rounded-2xl bg-base-200 shadow-sm transition-shadow duration-300 hover:shadow-xl">
        <span class="skeleton absolute inset-0 z-0" aria-hidden="true"></span>
        <img src="{{sw-url url}}" alt="{{alt}}" loading="lazy" class="relative z-10 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <span class="pointer-events-none absolute inset-0 z-20 bg-gradient-to-t from-black/40 via-black/0 to-black/0 opacity-60 transition-opacity duration-300 group-hover:opacity-90" aria-hidden="true"></span>
      </a>
      {{/sw-folder}}
    </div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_single_t">Lightbox — a single image (one line)</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_single_d">No grid scaffolding needed — put the attribute straight on an &lt;img&gt; and it opens full-screen on click.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>&lt;img data-sw-component="lightbox" src="…" data-caption="…"&gt;</code></pre>
  <div class="mt-8">
    {{#each data.projects}}{{#if @first}}
    <img data-sw-component="lightbox" data-thumbnails="false" src="{{sw-url image}}" data-caption="{{title}} — {{summary}}" alt="{{title}}" loading="lazy" class="mx-auto block w-full max-w-3xl rounded-2xl shadow-sm transition-shadow duration-300 hover:shadow-xl" />
    {{/if}}{{/each}}
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-28">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_masonry_t">Lightbox — masonry grid</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_masonry_d">Mixed-aspect images staggered into balanced CSS columns — no cropping — and the whole set is one gallery.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>&lt;div data-sw-component="lightbox" class="columns-2 sm:columns-3"&gt;</code></pre>
  <div class="mt-8 block columns-2 gap-4 sm:columns-3" data-sw-component="lightbox" aria-label="{{page.data.aria_masonry}}">
    {{#sw-folder "Team" kind="image"}}
    <a href="{{sw-url url}}" data-caption="{{alt}}" class="group relative mb-4 block break-inside-avoid overflow-hidden rounded-xl bg-base-200"><span class="skeleton absolute inset-0 z-0" aria-hidden="true"></span><img src="{{sw-url url}}" alt="{{alt}}" width="{{width}}" height="{{height}}" loading="lazy" class="relative z-10 block w-full transition-transform duration-500 group-hover:scale-[1.03]" /><span class="pointer-events-none absolute inset-0 z-20 bg-gradient-to-t from-black/40 via-black/0 to-black/0 opacity-50 transition-opacity duration-300 group-hover:opacity-90" aria-hidden="true"></span></a>
    {{/sw-folder}}
    {{#sw-folder "Projects" kind="image"}}
    <a href="{{sw-url url}}" data-caption="{{alt}}" class="group relative mb-4 block break-inside-avoid overflow-hidden rounded-xl bg-base-200"><span class="skeleton absolute inset-0 z-0" aria-hidden="true"></span><img src="{{sw-url url}}" alt="{{alt}}" width="{{width}}" height="{{height}}" loading="lazy" class="relative z-10 block w-full transition-transform duration-500 group-hover:scale-[1.03]" /><span class="pointer-events-none absolute inset-0 z-20 bg-gradient-to-t from-black/40 via-black/0 to-black/0 opacity-50 transition-opacity duration-300 group-hover:opacity-90" aria-hidden="true"></span></a>
    {{/sw-folder}}
    {{#sw-folder "Blog" kind="image"}}
    <a href="{{sw-url url}}" data-caption="{{alt}}" class="group relative mb-4 block break-inside-avoid overflow-hidden rounded-xl bg-base-200"><span class="skeleton absolute inset-0 z-0" aria-hidden="true"></span><img src="{{sw-url url}}" alt="{{alt}}" width="{{width}}" height="{{height}}" loading="lazy" class="relative z-10 block w-full transition-transform duration-500 group-hover:scale-[1.03]" /><span class="pointer-events-none absolute inset-0 z-20 bg-gradient-to-t from-black/40 via-black/0 to-black/0 opacity-50 transition-opacity duration-300 group-hover:opacity-90" aria-hidden="true"></span></a>
    {{/sw-folder}}
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-28">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_group_t">Lightbox — one gallery from separate images</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_group_d">Separate images, one gallery — via a shared data-gallery name.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>&lt;img data-sw-component="lightbox" data-gallery="studio-tour" …&gt;</code></pre>
  <div class="mt-8 grid gap-6 sm:grid-cols-2">
    {{#sw-folder "Brand" kind="image"}}
    <figure class="rounded-2xl border border-base-200/70 bg-base-100 p-3 shadow-sm">
      <img data-sw-component="lightbox" data-gallery="studio-tour" src="{{sw-url url}}" data-caption="{{alt}}" alt="{{alt}}" width="{{width}}" height="{{height}}" loading="lazy" class="block w-full rounded-xl" />
      <figcaption class="mt-2 px-1 text-sm text-base-content/60">{{alt}}</figcaption>
    </figure>
    {{/sw-folder}}
  </div>
</section>`,
  };
}
