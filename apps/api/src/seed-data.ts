import type { Page } from '@sitewright/schema';

/**
 * Content for the seeded "Example Project" — a small, multi-page DaisyUI site that showcases
 * the platform end to end: a brand-themed Corporate Identity, the shared page skeleton
 * (topNav + footer with the auto-menu), and code-first pages with `{{edit}}` regions. It is
 * deliberately ordinary marketing copy so an operator can immediately see what a finished site
 * looks like — and delete the project once they've explored it. Every template is no-JS safe.
 */
export const EXAMPLE_IDENTITY = {
  name: 'Northwind Studio',
  colors: { primary: '#2563eb' },
};

export const EXAMPLE_WEBSITE = {
  topNav: `<div class="navbar bg-base-100 border-b border-base-200">
  <div class="navbar-start"><a class="btn btn-ghost text-xl" href="/">{{ company.name }}</a></div>
  <div class="navbar-end"><ul class="menu menu-horizontal px-1">{{#each nav.header}}<li><a href="{{url path}}">{{label}}</a></li>{{/each}}</ul></div>
</div>`,
  footer: `<footer class="footer footer-center bg-base-200 p-8 text-base-content/70">
  <aside><p class="font-semibold text-base-content">{{ company.name }}</p><p>Built with Sitewright — code-first, no JavaScript required.</p></aside>
</footer>`,
};

const placeholderRoot = { id: 'root', type: 'Section' as const };

export const EXAMPLE_PAGES: Page[] = [
  {
    id: 'home',
    path: '/',
    title: 'Home',
    root: placeholderRoot,
    nav: { slots: ['header'], order: 1 },
    source: `<div class="hero min-h-[60vh] bg-base-200">
  <div class="hero-content text-center"><div class="max-w-2xl">
    <h1 class="text-5xl font-bold tracking-tight">{{edit "hero_title" "We build fast, beautiful websites"}}</h1>
    <p class="py-6 text-lg text-base-content/70">{{edit "hero_sub" "A boutique studio crafting corporate sites that load instantly and rank well."}}</p>
    <a class="btn btn-primary" href="/contact">{{edit "hero_cta" "Start a project"}}</a>
  </div></div>
</div>
<section class="mx-auto max-w-5xl px-6 py-20">
  <div class="grid gap-6 md:grid-cols-3">
    <div class="card bg-base-100 shadow"><div class="card-body"><h3 class="card-title">{{edit "f1_title" "Fast"}}</h3><p class="text-base-content/70">{{edit "f1_body" "Static export, optimized images, top Lighthouse scores."}}</p></div></div>
    <div class="card bg-base-100 shadow"><div class="card-body"><h3 class="card-title">{{edit "f2_title" "Branded"}}</h3><p class="text-base-content/70">{{edit "f2_body" "Your colours and type, themed across every component."}}</p></div></div>
    <div class="card bg-base-100 shadow"><div class="card-body"><h3 class="card-title">{{edit "f3_title" "Editable"}}</h3><p class="text-base-content/70">{{edit "f3_body" "Clients edit the words; the design stays yours."}}</p></div></div>
  </div>
</section>`,
  },
  {
    id: 'about',
    path: '/about',
    title: 'About',
    root: placeholderRoot,
    nav: { slots: ['header'], order: 2 },
    source: `<section class="mx-auto max-w-3xl px-6 py-20">
  <h1 class="text-4xl font-bold">About {{ company.name }}</h1>
  <p class="mt-6 text-lg text-base-content/70">{{edit "about_body" "We are a small, senior team. We have shipped sites for clients across retail, services, and tech — each one hand-built, fast, and easy to maintain."}}</p>
  <a class="btn btn-primary mt-8" href="/contact">{{edit "about_cta" "Work with us"}}</a>
</section>`,
  },
  {
    id: 'contact',
    path: '/contact',
    title: 'Contact',
    root: placeholderRoot,
    nav: { slots: ['header'], order: 3 },
    source: `<section class="mx-auto max-w-2xl px-6 py-20 text-center">
  <h1 class="text-4xl font-bold">{{edit "contact_title" "Let’s talk"}}</h1>
  <p class="mt-4 text-base-content/70">{{edit "contact_body" "Tell us about your project and we’ll get back within a day."}}</p>
  <p class="mt-8 text-lg font-medium">{{edit "contact_email" "hello@northwind.example"}}</p>
</section>`,
  },
];
