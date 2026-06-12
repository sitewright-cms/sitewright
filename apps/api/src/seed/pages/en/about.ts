import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- ABOUT (+ careers child)
// About adds a MEDIA-FOLDER gallery ({{#sw-folder}} over the Studio/ folder, wrapped in a
// Lightbox; the folder name is a page.data value an editor can repoint via the {{sw-control}}
// folder chip). Careers showcases the remaining dataset field types: select (dept), boolean
// (remote), date ({{sw-date posted}}), richtext ({{sw-rich description}}), and a REFERENCE
// resolved with the keyed {{item.team.…}} lookup.
export function pagesAbout(assets: Record<string, string>): Page[] {
  return [
  {
    id: 'about',
    path: 'about',
    title: 'About',
    description: 'A small, senior team of designers and engineers — by design.',
    parent: 'home', // home is the tree root
    nav: { slots: ['header'], order: 4, dropdown: true },
    data: { gallery_folder: 'Studio', aria_gallery: 'Studio photos', ab_img_alt: 'The Northwind studio' },
    source: `<section class="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2">
  <div class="nw-rise">
    <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="ab_eyebrow">About us</span>
    <h1 class="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="ab_h1">A small, senior team — by design</h1>
    <p class="mt-5 text-lg text-base-content/70" data-sw-text="ab_p1">Northwind is a boutique studio of designers and engineers who’d rather do a few projects brilliantly than many adequately. No juniors learning on your dime, no layers of account managers — just the people doing the work.</p>
    <p class="mt-4 text-base-content/70" data-sw-text="ab_p2">We believe a great website is the hardest-working member of your team: fast, clear, and quietly persuasive. That belief shapes every decision we make.</p>
  </div>
  <div class="nw-zoom overflow-hidden rounded-3xl border border-base-200 shadow-xl" data-aos="zoom-in">
    <img src="${assets.studio}" alt="{{page.data.ab_img_alt}}" class="h-full w-full object-cover" loading="lazy" />
  </div>
</section>

<section class="bg-base-200">
  <div class="mx-auto max-w-6xl px-6 py-20">
    <h2 class="text-3xl font-bold tracking-tight" data-aos="fade-up" data-sw-text="val_title">What we value</h2>
    <div class="mt-10 grid gap-6 md:grid-cols-3">
      <div class="rounded-2xl bg-base-100 p-7 shadow-sm" data-aos="fade-up"><span class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('star', 'h-5 w-5')}</span><h3 class="mt-4 text-lg font-bold" data-sw-text="v1_t">Craft over churn</h3><p class="mt-2 text-base-content/60" data-sw-text="v1_b">We sweat the details most teams skip — because details are what people feel.</p></div>
      <div class="rounded-2xl bg-base-100 p-7 shadow-sm" data-aos="fade-up" data-aos-delay="100"><span class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('arrow-up-right', 'h-5 w-5')}</span><h3 class="mt-4 text-lg font-bold" data-sw-text="v2_t">Speed is a feature</h3><p class="mt-2 text-base-content/60" data-sw-text="v2_b">Every site we ship is static, optimized, and built to load instantly.</p></div>
      <div class="rounded-2xl bg-base-100 p-7 shadow-sm" data-aos="fade-up" data-aos-delay="200"><span class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('check', 'h-5 w-5')}</span><h3 class="mt-4 text-lg font-bold" data-sw-text="v3_t">Plain dealing</h3><p class="mt-2 text-base-content/60" data-sw-text="v3_b">Fixed scopes, clear timelines, and honest advice — even when it costs us the upsell.</p></div>
    </div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 py-20">
  <h2 class="text-3xl font-bold tracking-tight" data-aos="fade-up" data-sw-text="team_title">The people you’ll work with</h2>
  <div class="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4" data-aos="fade-up" data-aos-delay="100">
    {{#each data.team}}
    <div class="text-center">
      <div class="mx-auto aspect-square w-36 overflow-hidden rounded-full border-4 border-base-100 shadow-lg nw-zoom"><img src="{{sw-url photo}}" alt="{{name}}" class="h-full w-full object-cover" loading="lazy" /></div>
      <h3 class="mt-4 font-bold">{{name}}</h3>
      <p class="text-sm text-primary">{{role}}</p>
      <p class="mt-1 text-sm text-base-content/50">{{bio}}</p>
    </div>
    {{/each}}
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-24">
  <div class="flex flex-wrap items-end justify-between gap-3" data-aos="fade-up">
    <h2 class="text-3xl font-bold tracking-tight" data-sw-text="gal_title">Inside the studio</h2>
    {{sw-control target="data.gallery_folder" as="folder" label="Gallery folder"}}
  </div>
  <!-- The sw-folder block iterates a MEDIA FOLDER (the editor's library, not a dataset) — drop
       new photos into Studio/ and they appear here. Wrapped in a Lightbox for click-to-zoom. -->
  <div class="mt-8" data-sw-component="lightbox" data-sw-block="Lightbox" aria-label="{{page.data.aria_gallery}}">
    <div data-sw-part="grid" class="gap-3 !grid-cols-2 md:!grid-cols-4">
      {{#sw-folder page.data.gallery_folder kind="image"}}
      <a data-sw-part="item" href="{{sw-url url}}" data-caption="{{alt}}" class="overflow-hidden rounded-2xl border border-base-200 nw-zoom">
        <img src="{{sw-url url}}" alt="{{alt}}" loading="lazy" />
      </a>
      {{else}}
      <p class="col-span-full text-base-content/50" data-sw-text="gal_empty">No photos yet — drop some into the Studio folder.</p>
      {{/sw-folder}}
    </div>
    <div data-sw-part="overlay" aria-hidden="true"></div>
  </div>
</section>`,
  },

  // ---------------------------------------------------------------- CAREERS (sub-page of /about)
  {
    id: 'careers',
    path: 'careers',
    title: 'Careers',
    description: 'Open roles at Northwind — small team, senior work, no nonsense.',
    parent: 'about',
    data: { badge_remote: 'Remote OK', posted_l: 'Posted' },
    source: `<section class="mx-auto max-w-4xl px-6 py-20">
  <a class="inline-flex items-center gap-1.5 text-sm font-medium text-primary nw-underline" href="{{sw-url parentPage.path}}">${icon('arrow-left', 'h-4 w-4')} {{parentPage.title}}</a>
  <h1 class="mt-6 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="ca_h1">Come do the best work of your career</h1>
  <p class="mt-4 text-lg text-base-content/60" data-sw-text="ca_intro">A small team means your work ships, your name is on it, and nobody manages the manager. These roles are open right now.</p>

  <div class="mt-12 space-y-6">
    {{#each data.roles}}
    <article class="rounded-3xl border border-base-200 bg-base-100 p-8 shadow-sm" data-aos="fade-up">
      <div class="flex flex-wrap items-center gap-2">
        <span class="badge badge-primary badge-outline">{{dept}}</span>
        {{#if remote}}<span class="badge badge-ghost">{{@root.page.data.badge_remote}}</span>{{/if}}
        <span class="ml-auto text-xs text-base-content/40">{{@root.page.data.posted_l}} <time>{{sw-date posted}}</time></span>
      </div>
      <h2 class="mt-3 text-2xl font-bold">{{title}}</h2>
      <p class="text-sm text-base-content/50">${icon('map-pin', 'inline h-3.5 w-3.5')} {{location}}</p>
      <div class="prose prose-sm mt-4 max-w-none text-base-content/70">{{sw-rich description}}</div>
      {{#with (lookup @root.item.team manager)}}
      <div class="mt-5 flex items-center gap-3 border-t border-base-200 pt-5">
        <div class="h-10 w-10 overflow-hidden rounded-full"><img src="{{sw-url photo}}" alt="{{name}}" loading="lazy" /></div>
        <p class="text-sm"><span class="font-semibold">{{name}}</span><span class="text-base-content/50"> — {{role}}</span></p>
      </div>
      {{/with}}
    </article>
    {{else}}
    <p class="rounded-3xl border border-dashed border-base-300 p-10 text-center text-base-content/50" data-sw-text="ca_empty">No openings right now — but we always read a great portfolio.</p>
    {{/each}}
  </div>

  <div class="mt-12 rounded-3xl bg-base-200 p-8 text-center">
    <p class="font-semibold" data-sw-text="ca_cta_t">Don’t see your role?</p>
    <p class="mt-1 text-sm text-base-content/60" data-sw-text="ca_cta_b">Pitch us. The best people rarely fit a template.</p>
    <a class="btn btn-primary mt-5" href="/contact" data-sw-href="href_contact" data-sw-text="ca_cta">Get in touch</a>
  </div>
</section>`,
  },
  ];
}
