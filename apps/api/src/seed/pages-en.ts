import type { Page } from '@sitewright/schema';
import { icon, STARS, placeholderRoot } from './helpers.js';

export function pagesEn(assets: Record<string, string>): Page[] {
  return [
  // ---------------------------------------------------------------- HOME
  {
    id: 'home',
    path: '',
    title: 'Northwind Web Studio — Websites that mean business',
    root: placeholderRoot,
    nav: { title: 'Home', slots: ['header'], order: 1 },
    // Linked to its German variant (`home-de`) for hreflang + the language switcher.
    translationGroup: 'home',
    source: `<section class="nw-aurora text-white">
  <div class="mx-auto grid max-w-6xl items-center gap-10 px-6 py-24 lg:grid-cols-2 lg:py-32">
    <div class="nw-rise">
      <span class="badge badge-lg border-white/30 bg-white/10 text-white" data-sw-text="hero_eyebrow">Boutique web studio · San Francisco</span>
      <h1 class="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl" data-sw-text="hero_title">Websites that win you more business.</h1>
      <p class="mt-6 max-w-md text-lg text-white/80" data-sw-text="hero_sub">We design and build fast, beautiful sites for ambitious brands — strategy, design, and engineering under one roof.</p>
      <div class="mt-8 flex flex-wrap gap-3">
        <a class="btn btn-lg gap-2 border-0 bg-white text-primary shadow-xl hover:bg-white/90 waves-effect" href="/contact"><span data-sw-text="hero_cta">Start a project</span> ${icon('arrow-right', 'h-5 w-5')}</a>
        <a class="btn btn-lg btn-ghost gap-2 border-white/40 text-white hover:bg-white/10 waves-effect waves-light" href="/work">See our work ${icon('arrow-up-right', 'h-5 w-5')}</a>
      </div>
    </div>
    <div class="nw-float hidden lg:block">
      <div class="overflow-hidden rounded-3xl border border-white/20 shadow-2xl nw-zoom">
        <!-- Lazy-loaded: the URL lives in data-src (no class needed) → the runtime swaps it to src on scroll-in, with a blur-up fade. -->
        <img class="h-full w-full object-cover" data-src="${assets.hero}" alt="A recent Northwind website" />
      </div>
    </div>
  </div>
</section>

<section class="border-y border-base-200 bg-base-100">
  <dl class="nw-stagger mx-auto grid max-w-5xl grid-cols-2 gap-6 px-6 py-12 text-center md:grid-cols-4">
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat1_n">120+</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat1_l">Sites shipped</dd></div>
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat2_n">9</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat2_l">Years in business</dd></div>
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat3_n">100</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat3_l">Avg. Lighthouse score</dd></div>
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat4_n">38%</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat4_l">Avg. lift in enquiries</dd></div>
  </dl>
</section>

<section class="mx-auto max-w-6xl px-6 pt-20">
  <div class="grid gap-10 lg:grid-cols-2 lg:items-center">
    <div>
      <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="why_eyebrow">Why Northwind</span>
      <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="why_title">Senior people, no hand-offs, no surprises</h2>
      <p class="mt-4 text-base-content/60" data-sw-text="why_sub">You work directly with the designers and engineers building your site — start to finish.</p>
    </div>
    <ul class="nw-stagger grid gap-3 sm:grid-cols-2">
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
  <div class="max-w-2xl">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="svc_title">Everything you need under one roof</h2>
    <p class="mt-3 text-base-content/60" data-sw-text="svc_sub">Strategy, design, and engineering — no hand-offs, no agencies-of-agencies.</p>
  </div>
  <div class="nw-stagger mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
  <div class="mx-auto max-w-6xl px-6 py-20">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="work_title">Selected work</h2>
      <a class="inline-flex items-center gap-1.5 font-medium text-primary nw-underline" href="/work">View all projects ${icon('arrow-right', 'h-4 w-4')}</a>
    </div>
    <div class="nw-stagger mt-12 grid gap-6 md:grid-cols-3">
      {{#each data.projects}}
      <a class="card nw-card overflow-hidden border border-base-200 bg-base-100 shadow-sm hover:shadow-xl nw-zoom" href="/work">
        <figure class="aspect-[4/3] overflow-hidden"><img src="{{sw-url image}}" alt="{{title}}" class="h-full w-full object-cover" loading="lazy" /></figure>
        <div class="card-body">
          <span class="text-xs font-semibold uppercase tracking-wide text-primary">{{category}}</span>
          <h3 class="card-title">{{title}}</h3>
          <p class="text-sm text-base-content/60">{{summary}}</p>
        </div>
      </a>
      {{/each}}
    </div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 py-20">
  <h2 class="text-center text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="tst_title">Loved by the brands we build for</h2>
  <div class="nw-stagger mt-12 grid gap-6 lg:grid-cols-3">
    {{#each data.testimonials}}
    <figure class="card nw-card border border-base-200 bg-base-100 p-2 shadow-sm">
      <div class="card-body">
        <div class="flex gap-0.5 text-accent">${STARS}</div>
        <blockquote class="mt-2 text-base-content/80">{{quote}}</blockquote>
        <figcaption class="mt-4 text-sm"><span class="font-semibold">{{author}}</span><span class="text-base-content/50"> — {{role}}</span></figcaption>
      </div>
    </figure>
    {{/each}}
  </div>
</section>

<section class="bg-neutral text-neutral-content">
  <div class="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="cta_title">Have a project in mind?</h2>
    <p class="max-w-xl text-neutral-content/70" data-sw-text="cta_sub">Tell us where you want to be in twelve months. We’ll show you how the right website gets you there.</p>
    <a class="btn btn-primary btn-lg gap-2 shadow-xl shadow-primary/30" href="/contact">${icon('calendar', 'h-5 w-5')} <span data-sw-text="cta_btn">Book an intro call</span></a>
  </div>
</section>`,
  },

  // ---------------------------------------------------------------- WORK
  {
    id: 'work',
    path: 'work',
    title: 'Our Work',
    root: placeholderRoot,
    parent: 'home', // home is the tree root — every page nests under it
    nav: { title: 'Work', slots: ['header'], order: 2 },
    source: `<section class="mx-auto max-w-6xl px-6 pt-20 pb-6">
  <div class="nw-rise max-w-2xl">
    <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="work_eyebrow">Portfolio</span>
    <h1 class="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="work_h1">Work we’re proud of</h1>
    <p class="mt-4 text-lg text-base-content/60" data-sw-text="work_intro">A selection of recent sites across retail, health, finance, and the arts — each one hand-built and fast.</p>
  </div>
</section>
<section class="mx-auto max-w-6xl px-6 pb-24">
  <div class="nw-stagger grid gap-8 md:grid-cols-2">
    {{#each data.projects}}
    <a class="card nw-card overflow-hidden border border-base-200 bg-base-100 shadow-sm hover:shadow-2xl nw-zoom" href="/contact">
      <figure class="aspect-[16/10] overflow-hidden"><img src="{{sw-url image}}" alt="{{title}}" class="h-full w-full object-cover" loading="lazy" /></figure>
      <div class="card-body">
        <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><span>{{category}}</span><span class="text-base-content/30">·</span><span class="text-base-content/40">{{year}}</span></div>
        <h2 class="card-title text-2xl">{{title}}</h2>
        <p class="text-sm text-base-content/40">{{client}}</p>
        <p class="mt-1 text-base-content/70">{{summary}}</p>
      </div>
    </a>
    {{/each}}
  </div>
</section>`,
  },

  // ---------------------------------------------------------------- SERVICES
  {
    id: 'services',
    path: 'services',
    title: 'Services',
    root: placeholderRoot,
    parent: 'home', // home is the tree root
    // `dropdown: true` folds this page's CHILD pages (parent = 'services') into a
    // nav dropdown — and the editor's pages list nests them under it (the page tree).
    nav: { slots: ['header'], order: 3, dropdown: true },
    // Linked to its German variant (`services-de`) for hreflang + the language switcher.
    translationGroup: 'services',
    source: `<section class="mx-auto max-w-6xl px-6 pt-20 pb-8">
  <div class="nw-rise max-w-2xl">
    <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="srv_eyebrow">What we do</span>
    <h1 class="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="srv_h1">Services built to grow your business</h1>
    <p class="mt-4 text-lg text-base-content/60" data-sw-text="srv_intro">Engage us end-to-end or for a single phase. Either way you work directly with the people doing the work.</p>
  </div>
</section>
<section class="mx-auto max-w-6xl px-6 pb-12">
  <div class="nw-stagger grid gap-px overflow-hidden rounded-3xl border border-base-200 bg-base-200 sm:grid-cols-2">
    {{#each data.services}}
    <div class="bg-base-100 p-8 transition hover:bg-base-200/40">
      <div class="text-3xl">{{icon}}</div>
      <h2 class="mt-3 text-xl font-bold">{{title}}</h2>
      <p class="mt-2 text-base-content/70">{{summary}}</p>
      <p class="mt-4 text-sm font-semibold text-primary">{{price}}</p>
    </div>
    {{/each}}
  </div>
</section>
<section class="mx-auto max-w-5xl px-6 py-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="proc_title">A simple, proven process</h2>
  <ol class="nw-stagger mt-10 grid gap-6 md:grid-cols-4">
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">01</div><h3 class="mt-1 font-semibold" data-sw-text="p1_t">Discover</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p1_b">Goals, audience, and the metrics that matter.</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">02</div><h3 class="mt-1 font-semibold" data-sw-text="p2_t">Design</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p2_b">Interfaces and a brand system, reviewed together.</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">03</div><h3 class="mt-1 font-semibold" data-sw-text="p3_t">Build</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p3_b">Fast, accessible, content-managed, SEO-ready.</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">04</div><h3 class="mt-1 font-semibold" data-sw-text="p4_t">Launch &amp; care</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p4_b">We ship, measure, and keep improving.</p></li>
  </ol>
  <div class="mt-12"><a class="btn btn-primary btn-lg" href="/contact" data-sw-text="srv_cta">Start a project</a></div>
</section>`,
  },

  // -------------------------------------------------- SERVICE DETAIL (sub-pages of /services)
  // Child pages (parent: 'services') — they nest under Services in the nav dropdown AND are
  // indented under it in the editor's pages list. With the parent's dropdown ON they need no
  // own nav slot.
  {
    id: 'service-web-design',
    path: 'web-design',
    title: 'Web Design',
    root: placeholderRoot,
    // A sub-page: it nests under Services (the dropdown label falls back to this title)
    // and is indented under it in the editor's pages list. No own nav slot needed.
    parent: 'services',
    source: `<section class="mx-auto max-w-4xl px-6 py-20">
  <a class="inline-flex items-center gap-1.5 text-sm font-medium text-primary nw-underline" href="/services">${icon('arrow-left', 'h-4 w-4')} <span data-sw-text="back">All services</span></a>
  <span class="mt-6 block text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="wd_eyebrow">Service</span>
  <h1 class="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="wd_h1">Web Design</h1>
  <p class="mt-4 text-lg text-base-content/60" data-sw-text="wd_intro">Distinctive, on-brand interfaces designed pixel-perfect for every screen — from first wireframe to a polished, accessible UI.</p>
  <div class="nw-stagger mt-10 grid gap-4 sm:grid-cols-2">
    <div class="rounded-2xl border border-base-200 bg-base-100 p-6"><h3 class="font-semibold" data-sw-text="wd_1t">Design systems</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="wd_1b">Reusable components and tokens that scale with your brand.</p></div>
    <div class="rounded-2xl border border-base-200 bg-base-100 p-6"><h3 class="font-semibold" data-sw-text="wd_2t">Responsive by default</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="wd_2b">Every layout is crafted for mobile, tablet, and desktop.</p></div>
  </div>
  <div class="mt-10"><a class="btn btn-primary btn-lg" href="/contact" data-sw-text="wd_cta">Start a project</a></div>
</section>`,
  },
  {
    id: 'service-seo',
    path: 'seo',
    title: 'SEO & Performance',
    root: placeholderRoot,
    parent: 'services',
    source: `<section class="mx-auto max-w-4xl px-6 py-20">
  <a class="inline-flex items-center gap-1.5 text-sm font-medium text-primary nw-underline" href="/services">${icon('arrow-left', 'h-4 w-4')} <span data-sw-text="back">All services</span></a>
  <span class="mt-6 block text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="seo_eyebrow">Service</span>
  <h1 class="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="seo_h1">SEO &amp; Performance</h1>
  <p class="mt-4 text-lg text-base-content/60" data-sw-text="seo_intro">Technical SEO, Core Web Vitals, and analytics wired in from day one — so the fast, beautiful site you launch is the one Google rewards.</p>
  <div class="nw-stagger mt-10 grid gap-4 sm:grid-cols-2">
    <div class="rounded-2xl border border-base-200 bg-base-100 p-6"><h3 class="font-semibold" data-sw-text="seo_1t">Core Web Vitals</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="seo_1b">We tune LCP, CLS, and INP until the scores are green.</p></div>
    <div class="rounded-2xl border border-base-200 bg-base-100 p-6"><h3 class="font-semibold" data-sw-text="seo_2t">Technical SEO</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="seo_2b">Structured data, sitemaps, and clean, crawlable markup.</p></div>
  </div>
  <div class="mt-10"><a class="btn btn-primary btn-lg" href="/contact" data-sw-text="seo_cta">Start a project</a></div>
</section>`,
  },

  // ---------------------------------------------------------------- ABOUT
  {
    id: 'about',
    path: 'about',
    title: 'About',
    root: placeholderRoot,
    parent: 'home', // home is the tree root
    nav: { slots: ['header'], order: 4 },
    source: `<section class="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2">
  <div class="nw-rise">
    <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="ab_eyebrow">About us</span>
    <h1 class="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="ab_h1">A small, senior team — by design</h1>
    <p class="mt-5 text-lg text-base-content/70" data-sw-text="ab_p1">Northwind is a boutique studio of designers and engineers who’d rather do a few projects brilliantly than many adequately. No juniors learning on your dime, no layers of account managers — just the people doing the work.</p>
    <p class="mt-4 text-base-content/70" data-sw-text="ab_p2">We believe a great website is the hardest-working member of your team: fast, clear, and quietly persuasive. That belief shapes every decision we make.</p>
  </div>
  <div class="nw-zoom overflow-hidden rounded-3xl border border-base-200 shadow-xl">
    <img src="${assets.studio}" alt="The Northwind studio" class="h-full w-full object-cover" loading="lazy" />
  </div>
</section>

<section class="bg-base-200">
  <div class="mx-auto max-w-6xl px-6 py-20">
    <h2 class="text-3xl font-bold tracking-tight" data-sw-text="val_title">What we value</h2>
    <div class="nw-stagger mt-10 grid gap-6 md:grid-cols-3">
      <div class="rounded-2xl bg-base-100 p-7 shadow-sm"><span class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('star', 'h-5 w-5')}</span><h3 class="mt-4 text-lg font-bold" data-sw-text="v1_t">Craft over churn</h3><p class="mt-2 text-base-content/60" data-sw-text="v1_b">We sweat the details most teams skip — because details are what people feel.</p></div>
      <div class="rounded-2xl bg-base-100 p-7 shadow-sm"><span class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('arrow-up-right', 'h-5 w-5')}</span><h3 class="mt-4 text-lg font-bold" data-sw-text="v2_t">Speed is a feature</h3><p class="mt-2 text-base-content/60" data-sw-text="v2_b">Every site we ship is static, optimized, and built to load instantly.</p></div>
      <div class="rounded-2xl bg-base-100 p-7 shadow-sm"><span class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('check', 'h-5 w-5')}</span><h3 class="mt-4 text-lg font-bold" data-sw-text="v3_t">Plain dealing</h3><p class="mt-2 text-base-content/60" data-sw-text="v3_b">Fixed scopes, clear timelines, and honest advice — even when it costs us the upsell.</p></div>
    </div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 py-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="team_title">The people you’ll work with</h2>
  <div class="nw-stagger mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
    {{#each data.team}}
    <div class="text-center">
      <div class="mx-auto aspect-square w-36 overflow-hidden rounded-full border-4 border-base-100 shadow-lg nw-zoom"><img src="{{sw-url photo}}" alt="{{name}}" class="h-full w-full object-cover" loading="lazy" /></div>
      <h3 class="mt-4 font-bold">{{name}}</h3>
      <p class="text-sm text-primary">{{role}}</p>
      <p class="mt-1 text-sm text-base-content/50">{{bio}}</p>
    </div>
    {{/each}}
  </div>
</section>`,
  },

  // ---------------------------------------------------------------- CONTACT (block-tree: hosts the Form block)
  {
    id: 'contact',
    path: 'contact',
    title: 'Contact',
    parent: 'home', // home is the tree root
    nav: { slots: ['header'], order: 5 },
    root: {
      id: 'contact-root',
      type: 'Section',
      className: 'mx-auto max-w-6xl px-6 py-20',
      children: [
        {
          id: 'c-grid',
          type: 'Grid',
          props: { columns: 2 },
          className: 'gap-10 lg:gap-16 items-start',
          children: [
            {
              id: 'c-info',
              type: 'Card',
              className: 'nw-rise',
              children: [
                { id: 'c-h', type: 'Heading', props: { level: 1, text: 'Let’s build something great' }, className: 'text-4xl font-extrabold tracking-tight' },
                { id: 'c-sub', type: 'RichText', props: { text: 'Tell us about your project and we’ll get back within one business day. Prefer email? Reach us directly — we read every message.' }, className: 'mt-4 text-lg text-base-content/70' },
                {
                  id: 'c-details',
                  type: 'Html',
                  className: 'mt-8',
                  props: {
                    html:
                      '<ul class="space-y-4">' +
                      `<li class="flex items-center gap-3"><span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('mail', 'h-5 w-5')}</span><a class="font-medium text-primary nw-underline" href="mailto:hello@northwindstudio.com">hello@northwindstudio.com</a></li>` +
                      `<li class="flex items-center gap-3"><span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('phone', 'h-5 w-5')}</span><span class="text-base-content/80">+1 (415) 555-0142</span></li>` +
                      `<li class="flex items-center gap-3"><span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('map-pin', 'h-5 w-5')}</span><span class="text-base-content/80">548 Market Street, Suite 200 · San Francisco, CA</span></li>` +
                      `<li class="flex items-center gap-3"><span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('clock', 'h-5 w-5')}</span><span class="text-base-content/80">Mon–Fri, 9–6 PT</span></li>` +
                      '</ul>',
                  },
                },
              ],
            },
            {
              id: 'c-form-card',
              type: 'Card',
              className: 'nw-card rounded-3xl border border-base-200 bg-base-100 p-8 shadow-xl',
              children: [{ id: 'c-form', type: 'Form', props: { formId: 'contact' } }],
            },
          ],
        },
      ],
    },
  },
  ];
}

export function pagesEnContentOnly(assets: Record<string, string>): Page[] {
  return [
  // ---------------------------------------------------------------- BLOG (content-only templates)
  // A page-tree blog: the overview uses global:blog-overview ({{#each page.children}}), each article
  // uses global:blog-article (every field a data-sw-*="data.*" in-preview-editable leaf). No code —
  // the content lives entirely in each page's `data` (page.data), seeded from the template defaults.
  {
    id: 'blog',
    path: 'blog',
    title: 'Blog',
    root: placeholderRoot,
    parent: 'home',
    nav: { title: 'Blog', slots: ['header'], order: 5 },
    template: 'global:blog-overview',
    description: 'Notes on web design, performance, and building sites that earn their keep.',
    data: { heading: 'From the studio', intro: 'Notes on web design, performance, and building sites that earn their keep.' },
  },
  {
    id: 'blog-static-speed',
    path: 'why-static-sites-win',
    title: 'Why static sites win on speed',
    root: placeholderRoot,
    parent: 'blog',
    template: 'global:blog-article',
    order: 1,
    description: 'A static-first build keeps your site fast, cheap to host, and effortless to maintain.',
    data: {
      article_kicker: 'Performance',
      article_title: 'Why static sites win on speed',
      article_excerpt: 'A static-first build keeps your site fast, cheap to host, and effortless to maintain.',
      article_image: assets['proj-harbor'] ?? '',
      article_body:
        '<p>Every millisecond of load time costs you visitors. A pre-rendered, static site ships plain HTML, CSS, and a sliver of JS — there is no server to wait on, so the page paints almost instantly.</p>' +
        '<h2>Fewer moving parts</h2>' +
        '<p>No database, no runtime, no patching. The whole site is a folder of files any host can serve from a CDN edge near your visitor.</p>' +
        '<ul><li>Top Core Web Vitals out of the box</li><li>Cheap, simple hosting</li><li>A smaller attack surface</li></ul>',
    },
  },
  {
    id: 'blog-design-systems',
    path: 'design-systems-that-scale',
    title: 'Design systems that scale',
    root: placeholderRoot,
    parent: 'blog',
    template: 'global:blog-article',
    order: 2,
    description: 'Tokens and reusable components keep a growing site consistent — and fast to build.',
    data: {
      article_kicker: 'Design',
      article_title: 'Design systems that scale',
      article_excerpt: 'Tokens and reusable components keep a growing site consistent — and fast to build.',
      article_image: assets['proj-vela'] ?? '',
      article_body:
        '<p>A design system is the shared vocabulary between design and code: colour tokens, type scales, spacing, and a library of components everyone reaches for.</p>' +
        '<p>The payoff compounds. Once the building blocks exist, new pages are assembled in hours, and a brand tweak ripples everywhere from a single change.</p>',
    },
  },
  {
    id: 'blog-seo-foundations',
    path: 'seo-foundations',
    title: 'SEO foundations, from day one',
    root: placeholderRoot,
    parent: 'blog',
    template: 'global:blog-article',
    order: 3,
    description: 'Clean markup, structured data, and fast pages are the SEO basics that actually move rankings.',
    data: {
      article_kicker: 'SEO',
      article_title: 'SEO foundations, from day one',
      article_excerpt: 'Clean markup, structured data, and fast pages are the basics that actually move rankings.',
      article_image: assets['proj-lumen'] ?? '',
      article_body:
        '<p>SEO is not a bolt-on. The fast, accessible, semantically-marked-up site you launch is the one search engines reward.</p>' +
        '<h2>Get the basics right</h2>' +
        '<ul><li>Descriptive titles and meta descriptions</li><li>A clean, crawlable URL structure</li><li>Structured data and an accurate sitemap</li></ul>',
    },
  },
  // MINI SHOP demo: a content-free storefront. global:shop loops the `products` dataset, each card
  // with a {{sw-add-to-cart}} button + the {{sw-cart}} mount. The cart builds an order in the browser
  // and submits it via WhatsApp / email / PayPal (configured in EXAMPLE_WEBSITE.shop). Front-end only.
  {
    id: 'shop',
    path: 'shop',
    title: 'Studio merch — Northwind shop',
    root: placeholderRoot,
    parent: 'home',
    nav: { title: 'Shop', slots: ['header'], order: 6 },
    template: 'global:shop',
    description: 'Studio merch for fellow web nerds — add to cart and order via WhatsApp, email, or a payment link.',
    data: {
      heading: 'Studio merch',
      intro: 'A little something for fellow web nerds. Add to cart and check out via WhatsApp, email, or a payment link.',
    },
  },
  ];
}
