import type { Page } from '@sitewright/schema';
import { icon, STARS } from '../../helpers.js';

// ---------------------------------------------------------------- HOME
// The flagship landing page: a dark aurora hero (blueprint grid texture, lazy-loaded brand art,
// a floating Lighthouse chip), a glass stats card pulled up over the hero edge, data-aos scroll
// reveals, a keyed-lookup case-study spotlight (`item.projects` driven by page.data.spotlight —
// so locale variants point at their own entry ids), dataset grids, and a testimonial CAROUSEL on
// a dark glow band. Every visible string is a data-sw-text/html leaf (EN defaults authored here;
// locale variants override via their own page.data); internal links carry data-sw-href keys the
// variants point at their locale's routes. The {{sw-control}} chips expose the page
// title/description to the in-preview content editor (stripped on publish).
export function pageHome(assets: Record<string, string>): Page {
  return {
    id: 'home',
    path: '',
    title: 'Northwind Web Studio — Websites that mean business',
    description: 'A boutique web studio in San Francisco: strategy, design, and hand-built static sites that win you more business.',
    nav: { title: 'Home', slots: ['header'], order: 1 },
    data: {
      spotlight: 'proj-harbor',
      // Demo values for the editor-only {{sw-control}} "studio settings" chips below. These are
      // page.data knobs an editor sets from inside the preview; nothing renders them on the page, so
      // they carry no translation obligation (the chips, like all controls, are stripped on publish).
      demo_team: '12',
      demo_accent: '#6366f1',
      demo_launch: '2026-09-01',
      demo_status: 'Open for projects',
    },
    // The "studio settings" block exercises every {{sw-control}} input type. It is class="hidden" (it
    // renders nothing on the page), and the Content Editor reveals it while editing so the chips are
    // reachable — text/textarea/dataset plus number/color/date/select.
    source: `<div class="hidden">{{sw-control target="page.title" as="text" label="Page title"}} {{sw-control target="page.description" as="textarea" label="Meta description"}} {{sw-control target="page.data.spotlight" as="dataset" label="Spotlight project"}} {{sw-control target="page.data.demo_team" as="number" label="Team size"}} {{sw-control target="page.data.demo_accent" as="color" label="Brand accent"}} {{sw-control target="page.data.demo_launch" as="date" label="Next opening"}} {{sw-control target="page.data.demo_status" as="select" options="Open for projects, Booked, Waitlist" label="Availability"}}</div>
<section class="nw-aurora relative overflow-hidden text-white">
  <div class="nw-grid-bg pointer-events-none absolute inset-0" aria-hidden="true"></div>
  <div class="relative mx-auto grid max-w-6xl items-center gap-14 px-6 pb-36 pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:pb-44 lg:pt-28">
    <div class="nw-rise">
      <span class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-sm font-medium text-white/90 backdrop-blur"><span class="inline-block h-2 w-2 rounded-full bg-secondary"></span><span data-sw-translate="home.eyebrow">Boutique web studio · San Francisco</span></span>
      <h1 class="mt-7 text-5xl font-bold leading-[1.04] tracking-tight sm:text-6xl xl:text-7xl" data-sw-translate="home.headline">Websites that win you more business.</h1>
      <p class="mt-6 max-w-md text-lg leading-relaxed text-white/65" data-sw-translate="home.subhead">We design and build fast, beautiful sites for ambitious brands — strategy, design, and engineering under one roof.</p>
      <div class="mt-9 flex flex-wrap gap-3">
        <a class="btn btn-lg gap-2 rounded-full border-0 bg-white px-7 text-primary shadow-xl shadow-black/20 hover:bg-white/90 waves-effect" href="/contact" data-sw-href="href_contact"><span data-sw-translate="nav_cta">Start a project</span> ${icon('arrow-right', 'h-5 w-5')}</a>
        <a class="btn btn-lg btn-ghost gap-2 rounded-full border-white/25 px-7 text-white hover:border-white/50 hover:bg-white/10 waves-effect waves-light" href="/work" data-sw-href="href_work"><span data-sw-translate="home.cta_work">See our work</span> ${icon('arrow-up-right', 'h-5 w-5')}</a>
      </div>
    </div>
    <div class="relative hidden lg:block">
      <div class="absolute -inset-8 rounded-full bg-primary/30 blur-3xl" aria-hidden="true"></div>
      <div class="nw-float relative overflow-hidden rounded-3xl shadow-2xl shadow-black/40 ring-1 ring-white/20 nw-zoom">
        <!-- Lazy-loaded: the URL lives in data-src → the runtime swaps it to src on scroll-in. -->
        <img class="h-full w-full object-cover" data-src="${assets.hero}" alt="{{sw-translate "home.hero_alt"}}" />
      </div>
      <!-- Floating chip REUSES the stats-band keys (stat3_n / stat3_l) on purpose: one
           translated value renders in both spots, so locale variants stay in sync for free. -->
      <div class="absolute -bottom-6 -left-8 flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 px-5 py-4 shadow-xl backdrop-blur-xl">
        <span class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-white">${icon('gauge', 'h-5 w-5')}</span>
        <span><span class="block text-xl font-bold leading-none" data-sw-text="stat3_n">100</span><span class="mt-1 block text-xs text-white/60" data-sw-translate="home.stat3_l">Avg. Lighthouse score</span></span>
      </div>
    </div>
  </div>
</section>

<section class="relative z-10 mx-auto -mt-20 max-w-5xl px-6 lg:-mt-24">
  <dl class="grid grid-cols-2 gap-y-10 rounded-3xl border border-base-200/80 bg-base-100/95 px-6 py-10 shadow-2xl shadow-neutral/10 backdrop-blur-xl md:grid-cols-4">
    <div class="text-center" data-aos="fade-up"><dt class="bg-gradient-to-br from-primary to-secondary bg-clip-text text-4xl font-bold tracking-tight text-transparent" data-sw-text="stat1_n">120+</dt><dd class="mt-2 text-xs font-medium uppercase tracking-wider text-base-content/50" data-sw-translate="home.stat1_l">Sites shipped</dd></div>
    <div class="text-center" data-aos="fade-up" data-aos-delay="100"><dt class="bg-gradient-to-br from-primary to-secondary bg-clip-text text-4xl font-bold tracking-tight text-transparent" data-sw-text="stat2_n">9</dt><dd class="mt-2 text-xs font-medium uppercase tracking-wider text-base-content/50" data-sw-translate="home.stat2_l">Years in business</dd></div>
    <div class="text-center" data-aos="fade-up" data-aos-delay="200"><dt class="bg-gradient-to-br from-primary to-secondary bg-clip-text text-4xl font-bold tracking-tight text-transparent" data-sw-text="stat3_n">100</dt><dd class="mt-2 text-xs font-medium uppercase tracking-wider text-base-content/50" data-sw-translate="home.stat3_l">Avg. Lighthouse score</dd></div>
    <div class="text-center" data-aos="fade-up" data-aos-delay="300"><dt class="bg-gradient-to-br from-primary to-secondary bg-clip-text text-4xl font-bold tracking-tight text-transparent" data-sw-text="stat4_n">38%</dt><dd class="mt-2 text-xs font-medium uppercase tracking-wider text-base-content/50" data-sw-translate="home.stat4_l">Avg. lift in enquiries</dd></div>
  </dl>
</section>

<section class="mx-auto max-w-6xl px-6 pt-24">
  <div class="grid gap-12 lg:grid-cols-2 lg:items-center">
    <div data-aos="fade-right">
      <span class="text-sm font-semibold uppercase tracking-[0.18em] text-primary" data-sw-translate="home.why_eyebrow">Why Northwind</span>
      <h2 class="mt-4 text-3xl font-bold tracking-tight sm:text-4xl" data-sw-translate="home.why_title">Senior people, no hand-offs, no surprises</h2>
      <p class="mt-4 text-lg leading-relaxed text-base-content/60" data-sw-translate="home.why_sub">You work directly with the designers and engineers building your site — start to finish.</p>
    </div>
    <ul class="grid list-none gap-4 p-0 sm:grid-cols-2" data-aos="fade-left">
      <li class="flex items-start gap-3 rounded-2xl border border-base-200 bg-base-100 px-4 py-3.5 shadow-sm"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="font-medium text-base-content/80" data-sw-translate="home.why1">Fixed scope &amp; timeline</span></li>
      <li class="flex items-start gap-3 rounded-2xl border border-base-200 bg-base-100 px-4 py-3.5 shadow-sm"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="font-medium text-base-content/80" data-sw-translate="home.why2">Perfect Lighthouse scores</span></li>
      <li class="flex items-start gap-3 rounded-2xl border border-base-200 bg-base-100 px-4 py-3.5 shadow-sm"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="font-medium text-base-content/80" data-sw-translate="home.why3">You can edit the content yourself</span></li>
      <li class="flex items-start gap-3 rounded-2xl border border-base-200 bg-base-100 px-4 py-3.5 shadow-sm"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="font-medium text-base-content/80" data-sw-translate="home.why4">Accessible &amp; SEO-ready</span></li>
      <li class="flex items-start gap-3 rounded-2xl border border-base-200 bg-base-100 px-4 py-3.5 shadow-sm"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="font-medium text-base-content/80" data-sw-translate="home.why5">Hosting-friendly static export</span></li>
      <li class="flex items-start gap-3 rounded-2xl border border-base-200 bg-base-100 px-4 py-3.5 shadow-sm"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="font-medium text-base-content/80" data-sw-translate="home.why6">Ongoing care plans</span></li>
    </ul>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 py-24">
  <div class="max-w-2xl" data-aos="fade-up">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-sw-translate="home.svc_title">Everything you need under one roof</h2>
    <p class="mt-4 text-lg leading-relaxed text-base-content/60" data-sw-translate="home.svc_sub">Strategy, design, and engineering — no hand-offs, no agencies-of-agencies.</p>
  </div>
  <div class="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3" data-aos="fade-up" data-aos-delay="100">
    {{#each dataset.services}}
    <div class="card nw-card border border-base-200 bg-base-100 shadow-sm hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5">
      <div class="card-body p-7">
        <span class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-secondary/15 text-primary">{{sw-icon icon "h-6 w-6"}}</span>
        <h3 class="mt-4 text-lg font-bold tracking-tight">{{title}}</h3>
        <p class="text-[0.95rem] leading-relaxed text-base-content/60">{{summary}}</p>
        <p class="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">${icon('tag', 'h-3.5 w-3.5')} {{price}}</p>
      </div>
    </div>
    {{/each}}
  </div>
</section>

<section class="overflow-hidden bg-base-200/60">
  <div class="mx-auto grid max-w-6xl items-center gap-14 px-6 py-24 lg:grid-cols-2">
    <!-- Case-study spotlight: a KEYED dataset lookup (item.projects.<id>), with the id in
         page.data so each locale variant points at its own entry (proj-harbor / proj-harbor-de). -->
    {{#with (lookup @root.item.projects @root.page.data.spotlight)}}
    <div class="relative" data-aos="zoom-in">
      <div class="absolute -inset-6 -rotate-2 rounded-[2rem] bg-gradient-to-br from-primary/20 to-secondary/20" aria-hidden="true"></div>
      <div class="nw-zoom relative overflow-hidden rounded-3xl shadow-2xl shadow-neutral/20">
        <img src="{{sw-url image}}" alt="{{title}}" class="h-full w-full object-cover" loading="lazy" />
        <span class="absolute left-4 top-4 rounded-full bg-black/45 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-white backdrop-blur">{{category}}</span>
      </div>
    </div>
    <div data-aos="fade-left">
      <span class="text-sm font-semibold uppercase tracking-[0.18em] text-primary" data-sw-translate="home.spot_eyebrow">Case study</span>
      <h2 class="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{{title}}</h2>
      <p class="mt-3 text-sm font-medium text-base-content/45">{{client}} · {{category}} · {{year}}</p>
      <p class="mt-5 text-lg leading-relaxed text-base-content/70">{{summary}}</p>
      <a class="nw-underline mt-7 inline-flex items-center gap-1.5 font-semibold text-primary no-underline" href="/work" data-sw-href="href_work"><span data-sw-translate="home.spot_link">See the full portfolio</span> ${icon('arrow-right', 'h-4 w-4')}</a>
    </div>
    {{/with}}
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 py-24">
  <div class="flex flex-wrap items-end justify-between gap-4" data-aos="fade-up">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-sw-translate="home.work_title">Selected work</h2>
    <a class="nw-underline inline-flex items-center gap-1.5 font-semibold text-primary no-underline" href="/work" data-sw-href="href_work"><span data-sw-translate="home.work_link">View all projects</span> ${icon('arrow-right', 'h-4 w-4')}</a>
  </div>
  <div class="mt-12 grid gap-7 md:grid-cols-3" data-aos="fade-up" data-aos-delay="100">
    {{#each dataset.projects}}
    <a class="group card nw-card overflow-hidden border border-base-200 bg-base-100 no-underline shadow-sm hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5 nw-zoom" href="/work" data-sw-href="href_work">
      <figure class="relative aspect-[4/3] overflow-hidden">
        <img src="{{sw-url image}}" alt="{{title}}" class="h-full w-full object-cover" loading="lazy" />
        <span class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden="true"></span>
        <span class="absolute right-4 top-4 inline-flex h-9 w-9 translate-y-1 items-center justify-center rounded-full bg-white/90 text-neutral opacity-0 shadow transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">${icon('arrow-up-right', 'h-4 w-4')}</span>
      </figure>
      <div class="card-body p-6">
        <span class="text-xs font-semibold uppercase tracking-wider text-primary">{{category}}</span>
        <h3 class="text-lg font-bold tracking-tight">{{title}}</h3>
        <p class="text-sm leading-relaxed text-base-content/55">{{summary}}</p>
      </div>
    </a>
    {{/each}}
  </div>
</section>

<section class="relative overflow-hidden bg-neutral text-neutral-content">
  <div class="pointer-events-none absolute -left-32 top-0 h-96 w-96 rounded-full bg-primary/25 blur-3xl" aria-hidden="true"></div>
  <div class="pointer-events-none absolute -right-32 bottom-0 h-96 w-96 rounded-full bg-secondary/20 blur-3xl" aria-hidden="true"></div>
  <div class="relative mx-auto max-w-4xl px-6 py-24">
    <h2 class="text-center text-3xl font-bold tracking-tight sm:text-4xl" data-aos="fade-up" data-sw-translate="home.tst_title">Loved by the brands we build for</h2>
    <!-- First-party CAROUSEL: scroll-snap track (swipeable without JS); the runtime adds arrows,
         dots, keyboard nav, and gentle autoplay (pausing on hover/focus/reduced-motion). -->
    <div class="relative mt-12" data-sw-component="carousel" data-sw-block="Carousel" data-loop="true" data-autoplay="true" data-interval="6000" data-aos="fade-up" data-aos-delay="100">
      <div data-sw-part="track">
        {{#each dataset.testimonials}}
        <figure data-sw-part="slide" class="px-1 sm:px-10">
          <div class="rounded-3xl border border-white/10 bg-white/5 p-10 backdrop-blur">
            <div class="flex flex-col items-center text-center">
              <div class="flex gap-1 text-accent">${STARS}</div>
              <blockquote class="mt-5 max-w-xl text-xl font-medium leading-relaxed text-neutral-content/90 sm:text-2xl">{{quote}}</blockquote>
              <figcaption class="mt-6 text-sm"><span class="font-semibold">{{author}}</span><span class="text-neutral-content/50"> — {{role}}</span></figcaption>
            </div>
          </div>
        </figure>
        {{/each}}
      </div>
      <button type="button" data-sw-part="prev" aria-label="{{sw-translate "home.aria_prev"}}">‹</button>
      <button type="button" data-sw-part="next" aria-label="{{sw-translate "home.aria_next"}}">›</button>
      <div data-sw-part="dots" aria-hidden="true"></div>
    </div>
  </div>
</section>

<section class="bg-base-100 px-6 py-24">
  <div class="nw-aurora relative mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] text-white shadow-2xl shadow-primary/15">
    <div class="nw-grid-bg pointer-events-none absolute inset-0" aria-hidden="true"></div>
    <div class="relative mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 py-20 text-center">
      <h2 class="text-3xl font-bold tracking-tight sm:text-5xl" data-sw-translate="home.cta_title">Have a project in mind?</h2>
      <p class="max-w-xl text-lg leading-relaxed text-white/65" data-sw-translate="home.cta_sub">Tell us where you want to be in twelve months. We’ll show you how the right website gets you there.</p>
      <a class="btn btn-lg mt-2 gap-2 rounded-full border-0 bg-white px-8 text-primary shadow-xl hover:bg-white/90" href="/contact" data-sw-href="href_contact">${icon('calendar', 'h-5 w-5')} <span data-sw-translate="home.cta_btn">Book an intro call</span></a>
    </div>
  </div>
</section>`,
  };
}
