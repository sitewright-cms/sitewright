import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- SERVICES (+ 3 children)
// The Services hub is a nav DROPDOWN parent (its children fold under it); the detail pages use
// {{parentPage.*}} back-links and keyed {{item.services.…}} price lookups; the NEW pricing page
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
    source: `<section class="mx-auto max-w-6xl px-6 pt-20 pb-8">
  <div class="nw-rise max-w-2xl">
    <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="srv_eyebrow">What we do</span>
    <h1 class="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="srv_h1">Services built to grow your business</h1>
    <p class="mt-4 text-lg text-base-content/60" data-sw-text="srv_intro">Engage us end-to-end or for a single phase. Either way you work directly with the people doing the work.</p>
  </div>
</section>
<section class="mx-auto max-w-6xl px-6 pb-12">
  <div class="grid gap-px overflow-hidden rounded-3xl border border-base-200 bg-base-200 sm:grid-cols-2" data-aos="fade-up">
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
  <h2 class="text-3xl font-bold tracking-tight" data-aos="fade-up" data-sw-text="proc_title">A simple, proven process</h2>
  <ol class="mt-10 grid gap-6 md:grid-cols-4">
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6" data-aos="fade-up"><div class="text-sm font-bold text-primary">01</div><h3 class="mt-1 font-semibold" data-sw-text="p1_t">Discover</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p1_b">Goals, audience, and the metrics that matter.</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6" data-aos="fade-up" data-aos-delay="100"><div class="text-sm font-bold text-primary">02</div><h3 class="mt-1 font-semibold" data-sw-text="p2_t">Design</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p2_b">Interfaces and a brand system, reviewed together.</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6" data-aos="fade-up" data-aos-delay="200"><div class="text-sm font-bold text-primary">03</div><h3 class="mt-1 font-semibold" data-sw-text="p3_t">Build</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p3_b">Fast, accessible, content-managed, SEO-ready.</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6" data-aos="fade-up" data-aos-delay="300"><div class="text-sm font-bold text-primary">04</div><h3 class="mt-1 font-semibold" data-sw-text="p4_t">Launch &amp; care</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p4_b">We ship, measure, and keep improving.</p></li>
  </ol>
  <div class="mt-12"><a class="btn btn-primary btn-lg" href="/contact" data-sw-href="href_contact" data-sw-text="srv_cta">Start a project</a></div>
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
    source: `<section class="mx-auto max-w-4xl px-6 py-20">
  <a class="inline-flex items-center gap-1.5 text-sm font-medium text-primary nw-underline" href="{{sw-url parentPage.path}}">${icon('arrow-left', 'h-4 w-4')} {{parentPage.title}}</a>
  <span class="mt-6 block text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="wd_eyebrow">Service</span>
  <h1 class="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="wd_h1">Web Design</h1>
  <p class="mt-4 text-lg text-base-content/60" data-sw-text="wd_intro">Distinctive, on-brand interfaces designed pixel-perfect for every screen — from first wireframe to a polished, accessible UI.</p>
  <p class="mt-3 text-sm font-semibold text-primary"><span data-sw-text="wd_price_l">Typical engagement:</span> {{lookup (lookup @root.item.services @root.page.data.svc_ref) 'price'}}</p>
  <div class="mt-10 grid gap-4 sm:grid-cols-2" data-aos="fade-up">
    <div class="rounded-2xl border border-base-200 bg-base-100 p-6"><h3 class="font-semibold" data-sw-text="wd_1t">Design systems</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="wd_1b">Reusable components and tokens that scale with your brand.</p></div>
    <div class="rounded-2xl border border-base-200 bg-base-100 p-6"><h3 class="font-semibold" data-sw-text="wd_2t">Responsive by default</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="wd_2b">Every layout is crafted for mobile, tablet, and desktop.</p></div>
  </div>
  <div class="mt-10"><a class="btn btn-primary btn-lg" href="/contact" data-sw-href="href_contact" data-sw-text="wd_cta">Start a project</a></div>
</section>`,
  },
  {
    id: 'service-seo',
    path: 'seo',
    title: 'SEO & Performance',
    parent: 'services',
    data: { svc_ref: 'svc-seo' },
    source: `<section class="mx-auto max-w-4xl px-6 py-20">
  <a class="inline-flex items-center gap-1.5 text-sm font-medium text-primary nw-underline" href="{{sw-url parentPage.path}}">${icon('arrow-left', 'h-4 w-4')} {{parentPage.title}}</a>
  <span class="mt-6 block text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="seo_eyebrow">Service</span>
  <h1 class="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="seo_h1">SEO &amp; Performance</h1>
  <p class="mt-4 text-lg text-base-content/60" data-sw-text="seo_intro">Technical SEO, Core Web Vitals, and analytics wired in from day one — so the fast, beautiful site you launch is the one Google rewards.</p>
  <p class="mt-3 text-sm font-semibold text-primary"><span data-sw-text="seo_price_l">Typical engagement:</span> {{lookup (lookup @root.item.services @root.page.data.svc_ref) 'price'}}</p>
  <div class="mt-10 grid gap-4 sm:grid-cols-2" data-aos="fade-up">
    <div class="rounded-2xl border border-base-200 bg-base-100 p-6"><h3 class="font-semibold" data-sw-text="seo_1t">Core Web Vitals</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="seo_1b">We tune LCP, CLS, and INP until the scores are green.</p></div>
    <div class="rounded-2xl border border-base-200 bg-base-100 p-6"><h3 class="font-semibold" data-sw-text="seo_2t">Technical SEO</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="seo_2b">Structured data, sitemaps, and clean, crawlable markup.</p></div>
  </div>
  <div class="mt-10"><a class="btn btn-primary btn-lg" href="/contact" data-sw-href="href_contact" data-sw-text="seo_cta">Start a project</a></div>
</section>`,
  },

  // ---------------------------------------------------------------- PRICING (Tabs + plans dataset)
  {
    id: 'service-pricing',
    path: 'pricing',
    title: 'Pricing',
    description: 'Honest, fixed-scope pricing for project work and monthly care plans.',
    parent: 'services',
    data: { tab_projects: 'Project work', tab_care: 'Care plans' },
    source: `<section class="mx-auto max-w-5xl px-6 py-20">
  <a class="inline-flex items-center gap-1.5 text-sm font-medium text-primary nw-underline" href="{{sw-url parentPage.path}}">${icon('arrow-left', 'h-4 w-4')} {{parentPage.title}}</a>
  <h1 class="mt-6 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="pr_h1">Honest, fixed-scope pricing</h1>
  <p class="mt-4 max-w-2xl text-lg text-base-content/60" data-sw-text="pr_intro">No estimates that double mid-project. Pick a package, know the number, get the site.</p>

  <!-- First-party TABS (APG pattern): the runtime builds the tablist from each panel's
       data-sw-title; without JS the panels simply stack — nothing is hidden. -->
  <div class="mt-12" data-sw-component="tabs" data-sw-block="Tabs">
    <div data-sw-part="tablist" role="tablist"></div>
    <div data-sw-part="panel" role="tabpanel" data-sw-title="{{page.data.tab_projects}}">
      <div class="grid gap-6 md:grid-cols-3">
        {{#each data.plans}}{{#unless monthly}}
        <div class="card border bg-base-100 shadow-sm {{#if featured}}border-2 border-primary shadow-xl{{else}}border-base-200{{/if}}">
          <div class="card-body">
            <h2 class="card-title">{{name}}</h2>
            <p class="text-3xl font-extrabold text-primary">{{@root.website.shop.currency.symbol}}{{price}}<span class="ml-1 text-sm font-normal text-base-content/50">{{period}}</span></p>
            <p class="text-sm text-base-content/60">{{blurb}}</p>
            <ul class="mt-3 space-y-1.5 text-sm">{{#each features}}<li class="flex items-start gap-2"><span class="mt-0.5 text-primary">${icon('check', 'h-4 w-4')}</span>{{this}}</li>{{/each}}</ul>
          </div>
        </div>
        {{/unless}}{{/each}}
      </div>
    </div>
    <div data-sw-part="panel" role="tabpanel" data-sw-title="{{page.data.tab_care}}">
      <div class="grid gap-6 md:grid-cols-2">
        {{#each data.plans}}{{#if monthly}}
        <div class="card border bg-base-100 shadow-sm {{#if featured}}border-2 border-primary shadow-xl{{else}}border-base-200{{/if}}">
          <div class="card-body">
            <h2 class="card-title">{{name}}</h2>
            <p class="text-3xl font-extrabold text-primary">{{@root.website.shop.currency.symbol}}{{price}}<span class="ml-1 text-sm font-normal text-base-content/50">{{period}}</span></p>
            <p class="text-sm text-base-content/60">{{blurb}}</p>
            <ul class="mt-3 space-y-1.5 text-sm">{{#each features}}<li class="flex items-start gap-2"><span class="mt-0.5 text-primary">${icon('check', 'h-4 w-4')}</span>{{this}}</li>{{/each}}</ul>
          </div>
        </div>
        {{/if}}{{/each}}
      </div>
    </div>
  </div>

  <p class="mt-10 text-sm text-base-content/50" data-sw-text="pr_note">All prices in USD, excl. tax. Larger scopes are quoted individually — ask us.</p>
  <div class="mt-6 flex flex-wrap gap-3">
    <a class="btn btn-primary btn-lg" href="/contact" data-sw-href="href_contact" data-sw-text="pr_cta">Start a project</a>
    <a class="btn btn-ghost btn-lg" href="/faq" data-sw-href="href_faq" data-sw-text="pr_faq">Read the FAQ</a>
  </div>
</section>`,
  },
  ];
}
