import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- SERVICES (+ 3 children)
// The Services hub is a nav DROPDOWN parent (its children fold under it); the detail pages use
// {{parentPage.*}} back-links and keyed {{item.services.…}} price lookups; the pricing page
// demonstrates the first-party TABS component over the `plans` dataset (number/boolean/json
// field types — the `features` JSON array loops with a nested {{#each}}).
export function pagesServices(): Page[] {
  return [
  {
    id: 'services',
    path: 'services',
    title: 'Services',
    description: 'Strategy, design, development, brand, SEO, and care plans — end-to-end or per phase.',
    parent: 'home', // home is the tree root
    // `dropdown: true` folds this page's CHILD pages (parent = 'services') into a
    // nav dropdown — and the editor's pages list nests them under it (the page tree).
    nav: { slots: ['header'], order: 3, dropdown: true },
    source: `<section class="mx-auto max-w-6xl px-6 pb-10 pt-24">
  <div class="nw-rise max-w-2xl">
    <span class="text-sm font-semibold uppercase tracking-[0.18em] text-primary" data-sw-text="srv_eyebrow">What we do</span>
    <h1 class="mt-4 text-4xl font-bold tracking-tight sm:text-6xl" data-sw-text="srv_h1">Services built to grow your business</h1>
    <p class="mt-5 text-lg leading-relaxed text-base-content/60" data-sw-text="srv_intro">Engage us end-to-end or for a single phase. Either way you work directly with the people doing the work.</p>
  </div>
</section>
<section class="mx-auto max-w-6xl px-6 pb-14">
  <div class="grid gap-6 sm:grid-cols-2" data-aos="fade-up">
    {{#each data.services}}
    <div class="nw-card rounded-3xl border border-base-200 bg-base-100 p-8 shadow-sm hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5">
      <div class="flex items-start justify-between gap-4">
        <span class="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-secondary/15 text-primary">{{sw-icon icon "h-6 w-6"}}</span>
        <span class="rounded-full bg-primary/10 px-3.5 py-1.5 text-sm font-semibold text-primary">{{price}}</span>
      </div>
      <h2 class="mt-5 text-xl font-bold tracking-tight">{{title}}</h2>
      <p class="mt-2 leading-relaxed text-base-content/60">{{summary}}</p>
    </div>
    {{/each}}
  </div>
</section>
<section class="bg-base-200/60">
  <div class="mx-auto max-w-6xl px-6 py-24">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-aos="fade-up" data-sw-text="proc_title">A simple, proven process</h2>
    <ol class="mt-12 grid list-none gap-6 p-0 md:grid-cols-4">
      <li class="nw-card relative rounded-3xl border border-base-200 bg-base-100 p-7 shadow-sm" data-aos="fade-up"><span class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary font-mono text-sm font-bold text-white">01</span><h3 class="mt-4 text-lg font-bold tracking-tight" data-sw-text="p1_t">Discover</h3><p class="mt-1.5 text-sm leading-relaxed text-base-content/60" data-sw-text="p1_b">Goals, audience, and the metrics that matter.</p></li>
      <li class="nw-card relative rounded-3xl border border-base-200 bg-base-100 p-7 shadow-sm" data-aos="fade-up" data-aos-delay="100"><span class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary font-mono text-sm font-bold text-white">02</span><h3 class="mt-4 text-lg font-bold tracking-tight" data-sw-text="p2_t">Design</h3><p class="mt-1.5 text-sm leading-relaxed text-base-content/60" data-sw-text="p2_b">Interfaces and a brand system, reviewed together.</p></li>
      <li class="nw-card relative rounded-3xl border border-base-200 bg-base-100 p-7 shadow-sm" data-aos="fade-up" data-aos-delay="200"><span class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary font-mono text-sm font-bold text-white">03</span><h3 class="mt-4 text-lg font-bold tracking-tight" data-sw-text="p3_t">Build</h3><p class="mt-1.5 text-sm leading-relaxed text-base-content/60" data-sw-text="p3_b">Fast, accessible, content-managed, SEO-ready.</p></li>
      <li class="nw-card relative rounded-3xl border border-base-200 bg-base-100 p-7 shadow-sm" data-aos="fade-up" data-aos-delay="300"><span class="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary font-mono text-sm font-bold text-white">04</span><h3 class="mt-4 text-lg font-bold tracking-tight" data-sw-text="p4_t">Launch &amp; care</h3><p class="mt-1.5 text-sm leading-relaxed text-base-content/60" data-sw-text="p4_b">We ship, measure, and keep improving.</p></li>
    </ol>
    <div class="mt-12"><a class="btn btn-primary btn-lg gap-2 rounded-full px-8 shadow-lg shadow-primary/25" href="/contact" data-sw-href="href_contact"><span data-sw-text="srv_cta">Start a project</span> ${icon('arrow-right', 'h-5 w-5')}</a></div>
  </div>
</section>`,
  },

  // -------------------------------------------------- SERVICE DETAIL (sub-pages of /services)
  // Child pages (parent: 'services') — they nest under Services in the nav dropdown AND are
  // indented under it in the editor's pages list. The back-link reads {{parentPage.*}} (path +
  // title from the parent — per locale, since each variant nests under its own parent variant).
  {
    id: 'service-web-design',
    path: 'web-design',
    title: 'Web Design',
    parent: 'services',
    data: { svc_ref: 'svc-design' },
    source: `<section class="mx-auto max-w-4xl px-6 py-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url parentPage.path}}">${icon('arrow-left', 'h-4 w-4')} {{parentPage.title}}</a>
  <span class="mt-8 block text-sm font-semibold uppercase tracking-[0.18em] text-primary" data-sw-text="wd_eyebrow">Service</span>
  <h1 class="mt-3 text-4xl font-bold tracking-tight sm:text-6xl" data-sw-text="wd_h1">Web Design</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-text="wd_intro">Distinctive, on-brand interfaces designed pixel-perfect for every screen — from first wireframe to a polished, accessible UI.</p>
  <p class="mt-6 inline-flex items-center gap-2.5 rounded-full border border-primary/20 bg-primary/5 px-5 py-2.5 text-sm font-semibold text-primary">${icon('tag', 'h-4 w-4')} <span data-sw-text="wd_price_l">Typical engagement:</span> {{lookup (lookup @root.item.services @root.page.data.svc_ref) 'price'}}</p>
  <div class="mt-12 grid gap-5 sm:grid-cols-2" data-aos="fade-up">
    <div class="nw-card rounded-3xl border border-base-200 bg-base-100 p-7 shadow-sm"><span class="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-secondary/15 text-primary">${icon('layout-grid', 'h-5 w-5')}</span><h3 class="mt-4 font-bold tracking-tight" data-sw-text="wd_1t">Design systems</h3><p class="mt-1.5 text-sm leading-relaxed text-base-content/60" data-sw-text="wd_1b">Reusable components and tokens that scale with your brand.</p></div>
    <div class="nw-card rounded-3xl border border-base-200 bg-base-100 p-7 shadow-sm"><span class="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-secondary/15 text-primary">${icon('pen-tool', 'h-5 w-5')}</span><h3 class="mt-4 font-bold tracking-tight" data-sw-text="wd_2t">Responsive by default</h3><p class="mt-1.5 text-sm leading-relaxed text-base-content/60" data-sw-text="wd_2b">Every layout is crafted for mobile, tablet, and desktop.</p></div>
  </div>
  <div class="mt-12"><a class="btn btn-primary btn-lg gap-2 rounded-full px-8 shadow-lg shadow-primary/25" href="/contact" data-sw-href="href_contact"><span data-sw-text="wd_cta">Start a project</span> ${icon('arrow-right', 'h-5 w-5')}</a></div>
</section>`,
  },
  {
    id: 'service-seo',
    path: 'seo',
    title: 'SEO & Performance',
    parent: 'services',
    data: { svc_ref: 'svc-seo' },
    source: `<section class="mx-auto max-w-4xl px-6 py-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url parentPage.path}}">${icon('arrow-left', 'h-4 w-4')} {{parentPage.title}}</a>
  <span class="mt-8 block text-sm font-semibold uppercase tracking-[0.18em] text-primary" data-sw-text="seo_eyebrow">Service</span>
  <h1 class="mt-3 text-4xl font-bold tracking-tight sm:text-6xl" data-sw-text="seo_h1">SEO &amp; Performance</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-text="seo_intro">Technical SEO, Core Web Vitals, and analytics wired in from day one — so the fast, beautiful site you launch is the one Google rewards.</p>
  <p class="mt-6 inline-flex items-center gap-2.5 rounded-full border border-primary/20 bg-primary/5 px-5 py-2.5 text-sm font-semibold text-primary">${icon('tag', 'h-4 w-4')} <span data-sw-text="seo_price_l">Typical engagement:</span> {{lookup (lookup @root.item.services @root.page.data.svc_ref) 'price'}}</p>
  <div class="mt-12 grid gap-5 sm:grid-cols-2" data-aos="fade-up">
    <div class="nw-card rounded-3xl border border-base-200 bg-base-100 p-7 shadow-sm"><span class="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-secondary/15 text-primary">${icon('gauge', 'h-5 w-5')}</span><h3 class="mt-4 font-bold tracking-tight" data-sw-text="seo_1t">Core Web Vitals</h3><p class="mt-1.5 text-sm leading-relaxed text-base-content/60" data-sw-text="seo_1b">We tune LCP, CLS, and INP until the scores are green.</p></div>
    <div class="nw-card rounded-3xl border border-base-200 bg-base-100 p-7 shadow-sm"><span class="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-secondary/15 text-primary">${icon('search', 'h-5 w-5')}</span><h3 class="mt-4 font-bold tracking-tight" data-sw-text="seo_2t">Technical SEO</h3><p class="mt-1.5 text-sm leading-relaxed text-base-content/60" data-sw-text="seo_2b">Structured data, sitemaps, and clean, crawlable markup.</p></div>
  </div>
  <div class="mt-12"><a class="btn btn-primary btn-lg gap-2 rounded-full px-8 shadow-lg shadow-primary/25" href="/contact" data-sw-href="href_contact"><span data-sw-text="seo_cta">Start a project</span> ${icon('arrow-right', 'h-5 w-5')}</a></div>
</section>`,
  },

  // ---------------------------------------------------------------- PRICING (Tabs + plans dataset)
  {
    id: 'service-pricing',
    path: 'pricing',
    title: 'Pricing',
    description: 'Honest, fixed-scope pricing for project work and monthly care plans.',
    parent: 'services',
    data: { tab_projects: 'Project work', tab_care: 'Care plans', pr_badge: 'Most popular' },
    source: `<section class="mx-auto max-w-5xl px-6 py-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url parentPage.path}}">${icon('arrow-left', 'h-4 w-4')} {{parentPage.title}}</a>
  <h1 class="mt-8 text-4xl font-bold tracking-tight sm:text-6xl" data-sw-text="pr_h1">Honest, fixed-scope pricing</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-text="pr_intro">No estimates that double mid-project. Pick a package, know the number, get the site.</p>

  <!-- First-party TABS (APG pattern): the runtime builds the tablist from each panel's
       data-sw-title; without JS the panels simply stack — nothing is hidden. -->
  <div class="mt-14" data-sw-component="tabs" data-sw-block="Tabs">
    <div data-sw-part="tablist" role="tablist"></div>
    <div data-sw-part="panel" role="tabpanel" data-sw-title="{{page.data.tab_projects}}">
      <div class="grid items-stretch gap-7 pt-2 md:grid-cols-3">
        {{#each data.plans}}{{#unless monthly}}
        <div class="nw-card relative flex flex-col rounded-3xl bg-base-100 p-8 {{#if featured}}nw-ring shadow-2xl shadow-primary/15{{else}}border border-base-200 shadow-sm{{/if}}">
          {{#if featured}}<span class="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-primary to-secondary px-4 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-lg">{{@root.page.data.pr_badge}}</span>{{/if}}
          <h2 class="text-lg font-bold tracking-tight">{{name}}</h2>
          <p class="mt-3"><span class="text-4xl font-bold tracking-tight {{#if featured}}bg-gradient-to-br from-primary to-secondary bg-clip-text text-transparent{{/if}}">{{display}}</span><span class="ml-1.5 text-sm text-base-content/50">{{period}}</span></p>
          <p class="mt-3 text-sm leading-relaxed text-base-content/60">{{blurb}}</p>
          <ul class="mt-5 list-none space-y-2.5 p-0 text-sm">{{#each features}}<li class="flex items-start gap-2.5"><span class="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-3 w-3')}</span>{{this}}</li>{{/each}}</ul>
        </div>
        {{/unless}}{{/each}}
      </div>
    </div>
    <div data-sw-part="panel" role="tabpanel" data-sw-title="{{page.data.tab_care}}">
      <div class="grid items-stretch gap-7 pt-2 md:grid-cols-2">
        {{#each data.plans}}{{#if monthly}}
        <div class="nw-card relative flex flex-col rounded-3xl bg-base-100 p-8 {{#if featured}}nw-ring shadow-2xl shadow-primary/15{{else}}border border-base-200 shadow-sm{{/if}}">
          {{#if featured}}<span class="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-primary to-secondary px-4 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-lg">{{@root.page.data.pr_badge}}</span>{{/if}}
          <h2 class="text-lg font-bold tracking-tight">{{name}}</h2>
          <p class="mt-3"><span class="text-4xl font-bold tracking-tight {{#if featured}}bg-gradient-to-br from-primary to-secondary bg-clip-text text-transparent{{/if}}">{{display}}</span><span class="ml-1.5 text-sm text-base-content/50">{{period}}</span></p>
          <p class="mt-3 text-sm leading-relaxed text-base-content/60">{{blurb}}</p>
          <ul class="mt-5 list-none space-y-2.5 p-0 text-sm">{{#each features}}<li class="flex items-start gap-2.5"><span class="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-3 w-3')}</span>{{this}}</li>{{/each}}</ul>
        </div>
        {{/if}}{{/each}}
      </div>
    </div>
  </div>

  <p class="mt-10 text-sm text-base-content/50" data-sw-text="pr_note">All prices in USD, excl. tax. Larger scopes are quoted individually — ask us.</p>
  <div class="mt-7 flex flex-wrap gap-3">
    <a class="btn btn-primary btn-lg gap-2 rounded-full px-8 shadow-lg shadow-primary/25" href="/contact" data-sw-href="href_contact"><span data-sw-text="pr_cta">Start a project</span> ${icon('arrow-right', 'h-5 w-5')}</a>
    <a class="btn btn-ghost btn-lg rounded-full px-8" href="/faq" data-sw-href="href_faq" data-sw-text="pr_faq">Read the FAQ</a>
  </div>
</section>`,
  },
  ];
}
