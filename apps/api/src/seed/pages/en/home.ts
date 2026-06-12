import type { Page } from '@sitewright/schema';
import { icon, STARS } from '../../helpers.js';

// ---------------------------------------------------------------- HOME
// The flagship landing page: aurora hero (lazy-loaded image), data-aos scroll reveals, a stats
// band, a keyed-lookup case-study spotlight (`item.projects` driven by page.data.spotlight — so
// locale variants point at their own entry ids), dataset grids, and a testimonial CAROUSEL.
// Every visible string is a data-sw-text/html leaf (EN defaults authored here; locale variants
// override via their own page.data); internal links carry data-sw-href keys the variants point
// at their locale's routes. The {{sw-control}} chips expose the page title/description to the
// in-preview content editor (stripped on publish).
export function pageHome(assets: Record<string, string>): Page {
  return {
    id: 'home',
    path: '',
    title: 'Northwind Web Studio — Websites that mean business',
    description: 'A boutique web studio in San Francisco: strategy, design, and hand-built static sites that win you more business.',
    nav: { title: 'Home', slots: ['header'], order: 1 },
    data: {
      spotlight: 'proj-harbor',
      hero_alt: 'A recent Northwind website',
      aria_prev: 'Previous testimonial',
      aria_next: 'Next testimonial',
    },
    source: `<div class="hidden">{{sw-control target="page.title" as="text" label="Page title"}} {{sw-control target="page.description" as="textarea" label="Meta description"}} {{sw-control target="data.spotlight" as="dataset" label="Spotlight project"}}</div>
<section class="nw-aurora text-white">
  <div class="mx-auto grid max-w-6xl items-center gap-10 px-6 py-24 lg:grid-cols-2 lg:py-32">
    <div class="nw-rise">
      <span class="badge badge-lg border-white/30 bg-white/10 text-white" data-sw-text="hero_eyebrow">Boutique web studio · San Francisco</span>
      <h1 class="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl" data-sw-text="hero_title">Websites that win you more business.</h1>
      <p class="mt-6 max-w-md text-lg text-white/80" data-sw-text="hero_sub">We design and build fast, beautiful sites for ambitious brands — strategy, design, and engineering under one roof.</p>
      <div class="mt-8 flex flex-wrap gap-3">
        <a class="btn btn-lg gap-2 border-0 bg-white text-primary shadow-xl hover:bg-white/90 waves-effect" href="/contact" data-sw-href="href_contact"><span data-sw-text="hero_cta">Start a project</span> ${icon('arrow-right', 'h-5 w-5')}</a>
        <a class="btn btn-lg btn-ghost gap-2 border-white/40 text-white hover:bg-white/10 waves-effect waves-light" href="/work" data-sw-href="href_work"><span data-sw-text="hero_cta2">See our work</span> ${icon('arrow-up-right', 'h-5 w-5')}</a>
      </div>
    </div>
    <div class="nw-float hidden lg:block">
      <div class="overflow-hidden rounded-3xl border border-white/20 shadow-2xl nw-zoom">
        <!-- Lazy-loaded: the URL lives in data-src → the runtime swaps it to src on scroll-in. -->
        <img class="h-full w-full object-cover" data-src="${assets.hero}" alt="{{page.data.hero_alt}}" />
      </div>
    </div>
  </div>
</section>

<section class="border-y border-base-200 bg-base-100">
  <dl class="mx-auto grid max-w-5xl grid-cols-2 gap-6 px-6 py-12 text-center md:grid-cols-4">
    <div data-aos="fade-up"><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat1_n">120+</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat1_l">Sites shipped</dd></div>
    <div data-aos="fade-up" data-aos-delay="100"><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat2_n">9</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat2_l">Years in business</dd></div>
    <div data-aos="fade-up" data-aos-delay="200"><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat3_n">100</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat3_l">Avg. Lighthouse score</dd></div>
    <div data-aos="fade-up" data-aos-delay="300"><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat4_n">38%</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat4_l">Avg. lift in enquiries</dd></div>
  </dl>
</section>

<section class="mx-auto max-w-6xl px-6 pt-20">
  <div class="grid gap-10 lg:grid-cols-2 lg:items-center">
    <div data-aos="fade-right">
      <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="why_eyebrow">Why Northwind</span>
      <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="why_title">Senior people, no hand-offs, no surprises</h2>
      <p class="mt-4 text-base-content/60" data-sw-text="why_sub">You work directly with the designers and engineers building your site — start to finish.</p>
    </div>
    <ul class="grid gap-3 sm:grid-cols-2" data-aos="fade-left">
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80" data-sw-text="why1">Fixed scope &amp; timeline</span></li>
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80" data-sw-text="why2">Perfect Lighthouse scores</span></li>
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80" data-sw-text="why3">You can edit the content yourself</span></li>
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80" data-sw-text="why4">Accessible &amp; SEO-ready</span></li>
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80" data-sw-text="why5">Hosting-friendly static export</span></li>
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80" data-sw-text="why6">Ongoing care plans</span></li>
    </ul>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 py-20">
  <div class="max-w-2xl" data-aos="fade-up">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="svc_title">Everything you need under one roof</h2>
    <p class="mt-3 text-base-content/60" data-sw-text="svc_sub">Strategy, design, and engineering — no hand-offs, no agencies-of-agencies.</p>
  </div>
  <div class="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3" data-aos="fade-up" data-aos-delay="100">
    {{#each data.services}}
    <div class="card nw-card border border-base-200 bg-base-100 shadow-sm hover:shadow-xl">
      <div class="card-body">
        <div class="text-3xl">{{icon}}</div>
        <h3 class="card-title mt-2">{{title}}</h3>
        <p class="text-base-content/70">{{summary}}</p>
        <p class="mt-2 text-sm font-semibold text-primary">{{price}}</p>
      </div>
    </div>
    {{/each}}
  </div>
</section>

<section class="bg-base-200">
  <div class="mx-auto grid max-w-6xl items-center gap-10 px-6 py-20 lg:grid-cols-2">
    <!-- Case-study spotlight: a KEYED dataset lookup (item.projects.<id>), with the id in
         page.data so each locale variant points at its own entry (proj-harbor / proj-harbor-de). -->
    {{#with (lookup @root.item.projects @root.page.data.spotlight)}}
    <div class="nw-zoom overflow-hidden rounded-3xl border border-base-200 shadow-xl" data-aos="zoom-in">
      <img src="{{sw-url image}}" alt="{{title}}" class="h-full w-full object-cover" loading="lazy" />
    </div>
    <div data-aos="fade-left">
      <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="spot_eyebrow">Case study</span>
      <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{{title}}</h2>
      <p class="mt-2 text-sm text-base-content/50">{{client}} · {{category}} · {{year}}</p>
      <p class="mt-4 text-lg text-base-content/70">{{summary}}</p>
      <a class="mt-6 inline-flex items-center gap-1.5 font-medium text-primary nw-underline" href="/work" data-sw-href="href_work"><span data-sw-text="spot_link">See the full portfolio</span> ${icon('arrow-right', 'h-4 w-4')}</a>
    </div>
    {{/with}}
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 py-20">
  <div class="flex flex-wrap items-end justify-between gap-4" data-aos="fade-up">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="work_title">Selected work</h2>
    <a class="inline-flex items-center gap-1.5 font-medium text-primary nw-underline" href="/work" data-sw-href="href_work"><span data-sw-text="work_link">View all projects</span> ${icon('arrow-right', 'h-4 w-4')}</a>
  </div>
  <div class="mt-12 grid gap-6 md:grid-cols-3" data-aos="fade-up" data-aos-delay="100">
    {{#each data.projects}}
    <a class="card nw-card overflow-hidden border border-base-200 bg-base-100 shadow-sm hover:shadow-xl nw-zoom" href="/work" data-sw-href="href_work">
      <figure class="aspect-[4/3] overflow-hidden"><img src="{{sw-url image}}" alt="{{title}}" class="h-full w-full object-cover" loading="lazy" /></figure>
      <div class="card-body">
        <span class="text-xs font-semibold uppercase tracking-wide text-primary">{{category}}</span>
        <h3 class="card-title">{{title}}</h3>
        <p class="text-sm text-base-content/60">{{summary}}</p>
      </div>
    </a>
    {{/each}}
  </div>
</section>

<section class="bg-base-200">
  <div class="mx-auto max-w-4xl px-6 py-20">
    <h2 class="text-center text-3xl font-bold tracking-tight sm:text-4xl" data-aos="fade-up" data-sw-text="tst_title">Loved by the brands we build for</h2>
    <!-- First-party CAROUSEL: scroll-snap track (swipeable without JS); the runtime adds arrows,
         dots, keyboard nav, and gentle autoplay (pausing on hover/focus/reduced-motion). -->
    <div class="relative mt-10" data-sw-component="carousel" data-sw-block="Carousel" data-loop="true" data-autoplay="true" data-interval="6000" data-aos="fade-up" data-aos-delay="100">
      <div data-sw-part="track">
        {{#each data.testimonials}}
        <figure data-sw-part="slide" class="px-1 sm:px-10">
          <div class="card border border-base-200 bg-base-100 p-2 shadow-sm">
            <div class="card-body items-center text-center">
              <div class="flex gap-0.5 text-accent">${STARS}</div>
              <blockquote class="mt-2 max-w-xl text-lg text-base-content/80">{{quote}}</blockquote>
              <figcaption class="mt-3 text-sm"><span class="font-semibold">{{author}}</span><span class="text-base-content/50"> — {{role}}</span></figcaption>
            </div>
          </div>
        </figure>
        {{/each}}
      </div>
      <button type="button" data-sw-part="prev" aria-label="{{page.data.aria_prev}}">‹</button>
      <button type="button" data-sw-part="next" aria-label="{{page.data.aria_next}}">›</button>
      <div data-sw-part="dots" aria-hidden="true"></div>
    </div>
  </div>
</section>

<section class="bg-neutral text-neutral-content">
  <div class="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="cta_title">Have a project in mind?</h2>
    <p class="max-w-xl text-neutral-content/70" data-sw-text="cta_sub">Tell us where you want to be in twelve months. We’ll show you how the right website gets you there.</p>
    <a class="btn btn-primary btn-lg gap-2 shadow-xl shadow-primary/30" href="/contact" data-sw-href="href_contact">${icon('calendar', 'h-5 w-5')} <span data-sw-text="cta_btn">Book an intro call</span></a>
  </div>
</section>`,
  };
}
