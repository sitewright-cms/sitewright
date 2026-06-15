import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- WORK
// The portfolio as a first-party LIGHTBOX gallery: each project card is a `data-sw-part="item"`
// link whose href is the full-size shot — click-to-zoom with keyboard nav once the runtime
// enhances it, a plain link to the image without JS. The viewer DOM is built entirely by the
// runtime — only the grid of anchor items is authored.
export function pageWork(): Page {
  return {
    id: 'work',
    path: 'work',
    title: 'Our Work',
    description: 'Recent sites across retail, health, finance, and the arts — each one hand-built and fast.',
    parent: 'home', // home is the tree root — every page nests under it
    nav: { title: 'Work', slots: ['header'], order: 2 },
    data: { aria_caption: 'Project gallery' },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <div class="nw-rise max-w-2xl">
    <span class="text-sm font-semibold uppercase tracking-[0.18em] text-primary" data-sw-translate="work.eyebrow">Portfolio</span>
    <h1 class="mt-4 text-4xl font-bold tracking-tight sm:text-6xl" data-sw-translate="work.headline">Work we’re proud of</h1>
    <p class="mt-5 text-lg leading-relaxed text-base-content/60" data-sw-translate="work.intro">A selection of recent sites across retail, health, finance, and the arts — each one hand-built and fast. Click any shot to view it full-screen.</p>
  </div>
</section>
<section class="mx-auto max-w-6xl px-6 pb-28">
  <div data-sw-component="lightbox" data-sw-block="Lightbox" aria-label="{{page.data.aria_caption}}">
    <div data-sw-part="grid" class="!grid-cols-1 gap-10 md:!grid-cols-2">
      {{#each dataset.projects}}
      <a data-sw-part="item" href="{{sw-url image}}" data-caption="{{title}} — {{summary}}" class="group card nw-card overflow-hidden border border-base-200 bg-base-100 no-underline shadow-sm hover:border-primary/30 hover:shadow-2xl hover:shadow-primary/10 nw-zoom" data-aos="fade-up">
        <figure class="relative aspect-[16/10] overflow-hidden">
          <img src="{{sw-url image}}" alt="{{title}}" class="!aspect-[16/10] h-full w-full object-cover" loading="lazy" />
          <span class="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden="true"></span>
          <span class="absolute right-5 top-5 inline-flex h-10 w-10 translate-y-1 items-center justify-center rounded-full bg-white/90 text-neutral opacity-0 shadow-lg transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">${icon('maximize-2', 'h-4 w-4')}</span>
        </figure>
        <div class="card-body p-7">
          <div class="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-wider"><span class="rounded-full bg-primary/10 px-3 py-1 text-primary">{{category}}</span><span class="font-mono font-medium normal-case tracking-normal text-base-content/40">{{year}}</span></div>
          <h2 class="mt-2 text-2xl font-bold tracking-tight">{{title}}</h2>
          <p class="text-sm font-medium text-base-content/40">{{client}}</p>
          <p class="mt-1 leading-relaxed text-base-content/65">{{summary}}</p>
        </div>
      </a>
      {{/each}}
    </div>
  </div>
</section>`,
  };
}
