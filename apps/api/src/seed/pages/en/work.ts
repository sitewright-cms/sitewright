import type { Page } from '@sitewright/schema';


// ---------------------------------------------------------------- WORK
// The portfolio as a first-party LIGHTBOX gallery: each project card is a `data-sw-part="item"`
// link whose href is the full-size shot — click-to-zoom with keyboard nav once the runtime
// enhances it, a plain link to the image without JS. The authored empty `overlay` div is the
// mount the runtime builds the viewer into.
export function pageWork(): Page {
  return {
    id: 'work',
    path: 'work',
    title: 'Our Work',
    description: 'Recent sites across retail, health, finance, and the arts — each one hand-built and fast.',
    parent: 'home', // home is the tree root — every page nests under it
    nav: { title: 'Work', slots: ['header'], order: 2 },
    data: { aria_caption: 'Project gallery' },
    source: `<section class="mx-auto max-w-6xl px-6 pt-20 pb-6">
  <div class="nw-rise max-w-2xl">
    <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="work_eyebrow">Portfolio</span>
    <h1 class="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="work_h1">Work we’re proud of</h1>
    <p class="mt-4 text-lg text-base-content/60" data-sw-text="work_intro">A selection of recent sites across retail, health, finance, and the arts — each one hand-built and fast. Click any shot to view it full-screen.</p>
  </div>
</section>
<section class="mx-auto max-w-6xl px-6 pb-24">
  <div data-sw-component="lightbox" data-sw-block="Lightbox" aria-label="{{page.data.aria_caption}}">
    <div data-sw-part="grid" class="!grid-cols-1 gap-8 md:!grid-cols-2">
      {{#each data.projects}}
      <a data-sw-part="item" href="{{sw-url image}}" data-caption="{{title}} — {{summary}}" class="card nw-card overflow-hidden border border-base-200 bg-base-100 shadow-sm hover:shadow-2xl nw-zoom" data-aos="fade-up">
        <figure class="aspect-[16/10] overflow-hidden"><img src="{{sw-url image}}" alt="{{title}}" class="!aspect-[16/10] h-full w-full object-cover" loading="lazy" /></figure>
        <div class="card-body">
          <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><span>{{category}}</span><span class="text-base-content/30">·</span><span class="text-base-content/40">{{year}}</span></div>
          <h2 class="card-title text-2xl">{{title}}</h2>
          <p class="text-sm text-base-content/40">{{client}}</p>
          <p class="mt-1 text-base-content/70">{{summary}}</p>
        </div>
      </a>
      {{/each}}
    </div>
    <div data-sw-part="overlay" aria-hidden="true"></div>
  </div>
</section>`,
  };
}
