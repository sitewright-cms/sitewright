import type { Page } from '@sitewright/schema';
import { icon } from './helpers.js';

export function pagesDe(assets: Record<string, string>): Page[] {
  return [
  // ================================================================ GERMAN (de) VARIANTS
  // Locale-variant PAGES (not field overlays): each is its own page with `locale: 'de'`,
  // its own `/de…` path, and a shared `translationGroup` linking it to the English
  // original for hreflang + the language switcher. The German Services page binds
  // `data.services`, which auto-resolves to the `services-de` dataset for a `de` page.
  // ---------------------------------------------------------------- HOME (de)
  {
    id: 'home-de',
    path: 'de',
    title: 'Northwind Web Studio — Websites, die Geschäft machen',
    locale: 'de',
    translationGroup: 'home',
    parent: 'home', // even a locale variant nests under the (default-locale) home root
    nav: { title: 'Start', slots: ['header'], order: 1 },
    source: `<section class="nw-aurora text-white">
  <div class="mx-auto grid max-w-6xl items-center gap-10 px-6 py-24 lg:grid-cols-2 lg:py-32">
    <div class="nw-rise">
      <span class="badge badge-lg border-white/30 bg-white/10 text-white" data-sw-text="hero_eyebrow">Boutique-Webstudio · San Francisco</span>
      <h1 class="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl" data-sw-text="hero_title">Websites, die Ihnen mehr Geschäft bringen.</h1>
      <p class="mt-6 max-w-md text-lg text-white/80" data-sw-text="hero_sub">Wir gestalten und bauen schnelle, schöne Websites für ambitionierte Marken — Strategie, Design und Entwicklung aus einer Hand.</p>
      <div class="mt-8 flex flex-wrap gap-3">
        <a class="btn btn-lg gap-2 border-0 bg-white text-primary shadow-xl hover:bg-white/90 waves-effect" href="/contact"><span data-sw-text="hero_cta">Projekt starten</span> ${icon('arrow-right', 'h-5 w-5')}</a>
        <a class="btn btn-lg btn-ghost gap-2 border-white/40 text-white hover:bg-white/10 waves-effect waves-light" href="/work">Arbeiten ansehen ${icon('arrow-up-right', 'h-5 w-5')}</a>
      </div>
    </div>
    <div class="nw-float hidden lg:block">
      <div class="overflow-hidden rounded-3xl border border-white/20 shadow-2xl nw-zoom">
        <img class="lazyload h-full w-full object-cover" data-src="${assets.hero}" alt="Eine aktuelle Northwind-Website" />
      </div>
    </div>
  </div>
</section>

<section class="border-y border-base-200 bg-base-100">
  <dl class="nw-stagger mx-auto grid max-w-5xl grid-cols-2 gap-6 px-6 py-12 text-center md:grid-cols-4">
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat1_n">120+</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat1_l">Websites ausgeliefert</dd></div>
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat2_n">9</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat2_l">Jahre am Markt</dd></div>
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat3_n">100</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat3_l">Ø Lighthouse-Score</dd></div>
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat4_n">38%</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat4_l">Ø mehr Anfragen</dd></div>
  </dl>
</section>

<section class="mx-auto max-w-6xl px-6 py-20">
  <div class="max-w-2xl">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="svc_title">Alles aus einer Hand</h2>
    <p class="mt-3 text-base-content/60" data-sw-text="svc_sub">Strategie, Design und Entwicklung — keine Übergaben, keine Agentur-Ketten.</p>
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

<section class="bg-neutral text-neutral-content">
  <div class="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="cta_title">Sie haben ein Projekt im Kopf?</h2>
    <p class="max-w-xl text-neutral-content/70" data-sw-text="cta_sub">Sagen Sie uns, wo Sie in zwölf Monaten stehen wollen — wir zeigen Ihnen, wie die richtige Website Sie dorthin bringt.</p>
    <a class="btn btn-primary btn-lg gap-2 shadow-xl shadow-primary/30" href="/contact">${icon('calendar', 'h-5 w-5')} <span data-sw-text="cta_btn">Kennenlern-Termin buchen</span></a>
  </div>
</section>`,
  },

  // ---------------------------------------------------------------- SERVICES (de)
  {
    id: 'services-de-page',
    path: 'leistungen',
    title: 'Leistungen',
    locale: 'de',
    translationGroup: 'services',
    // Nested under the GERMAN home (`home-de`, slug `de`) → computed route /de/leistungen.
    parent: 'home-de',
    nav: { title: 'Leistungen', slots: ['header'], order: 2 },
    source: `<section class="mx-auto max-w-6xl px-6 pt-20 pb-8">
  <div class="nw-rise max-w-2xl">
    <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="srv_eyebrow">Was wir tun</span>
    <h1 class="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="srv_h1">Leistungen, die Ihr Geschäft wachsen lassen</h1>
    <p class="mt-4 text-lg text-base-content/60" data-sw-text="srv_intro">Buchen Sie uns durchgängig oder für eine einzelne Phase. So oder so arbeiten Sie direkt mit den Menschen, die die Arbeit machen.</p>
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
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="proc_title">Ein einfacher, bewährter Ablauf</h2>
  <ol class="nw-stagger mt-10 grid gap-6 md:grid-cols-4">
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">01</div><h3 class="mt-1 font-semibold" data-sw-text="p1_t">Entdecken</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p1_b">Ziele, Zielgruppe und die Kennzahlen, die zählen.</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">02</div><h3 class="mt-1 font-semibold" data-sw-text="p2_t">Gestalten</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p2_b">Oberflächen und ein Markensystem, gemeinsam abgestimmt.</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">03</div><h3 class="mt-1 font-semibold" data-sw-text="p3_t">Bauen</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p3_b">Schnell, barrierearm, pflegbar, SEO-bereit.</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">04</div><h3 class="mt-1 font-semibold" data-sw-text="p4_t">Launch &amp; Pflege</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p4_b">Wir veröffentlichen, messen und verbessern weiter.</p></li>
  </ol>
  <div class="mt-12"><a class="btn btn-primary btn-lg" href="/contact" data-sw-text="srv_cta">Projekt starten</a></div>
</section>`,
  },
  ];
}
