import type { CorporateIdentity, Page, WebsiteSettings } from '@sitewright/schema';

// ---------------------------------------------------------------------------------------------------
// A second, focused showcase project: "ScrollSpy Demo". It demonstrates BOTH ScrollSpy surfaces in one
// small, monolingual (EN) site so a fresh instance ships a ready-to-explore example:
//   • the SITE-WIDE toggle (website.effects.scrollSpy) governing the main + mobile nav, whose links
//     MIX in-page section anchors (/#features …) with a real route link (/docs); and
//   • a per-element data-sw-scrollspy on a custom on-page table of contents (the /docs page).
// It pairs ScrollSpy with the box-solid nav effect (so the active link is visibly filled) and a pinned
// sticky header (so the nav stays visible and the --sw-header-h offset applies). Copy is inline English
// (no page.data) — the project is single-locale, so the i18n parity guard does not apply.

export const SCROLLSPY_DEMO_IDENTITY: CorporateIdentity = {
  name: 'ScrollSpy Demo',
  slogan: 'Navigation that follows the scroll',
  colors: { primary: '#7c3aed', secondary: '#0ea5e9' },
};

// Mixed-link main navigation: a brand (outside the menu, so the nav effect leaves it alone), then a
// .menu of section anchors + a route link. Site-wide ScrollSpy governs every .menu inside #main-nav, so
// BOTH the desktop bar and the mobile menu below highlight in sync. The Home/Docs links carry
// {{sw-active}} so route highlighting still works where ScrollSpy is dormant (the /docs page).
const MAIN_NAV = `<div class="navbar mx-auto max-w-6xl px-4">
  <div class="flex-1">
    <a href="/" class="text-lg font-bold tracking-tight text-primary">ScrollSpy<span class="text-base-content">Demo</span></a>
  </div>
  <div class="hidden flex-none lg:block">
    <ul class="menu menu-horizontal gap-1 font-medium">
      <li><a href="/" class="{{#if (sw-active "/" exact=true)}}active{{/if}}">Home</a></li>
      <li><a href="/#features">Features</a></li>
      <li><a href="/#pricing">Pricing</a></li>
      <li><a href="/#faq">FAQ</a></li>
      <li><a href="/docs" class="{{#if (sw-active "/docs")}}active{{/if}}">Docs</a></li>
    </ul>
  </div>
</div>
<div class="border-t border-base-200 lg:hidden">
  <ul class="menu menu-horizontal w-full justify-center gap-1 overflow-x-auto px-2 text-sm font-medium">
    <li><a href="/" class="{{#if (sw-active "/" exact=true)}}active{{/if}}">Home</a></li>
    <li><a href="/#features">Features</a></li>
    <li><a href="/#pricing">Pricing</a></li>
    <li><a href="/#faq">FAQ</a></li>
    <li><a href="/docs" class="{{#if (sw-active "/docs")}}active{{/if}}">Docs</a></li>
  </ul>
</div>`;

// The skeleton wraps this slot in the <footer id="footer"> landmark, so the slot content must NOT
// contain its own <footer> (the same rule as <nav> for the main-nav slot).
const FOOTER = `<div class="border-t border-base-200 bg-base-200/40">
  <div class="mx-auto flex max-w-6xl flex-col items-center gap-2 px-6 py-10 text-center text-sm text-base-content/60">
    <p class="font-semibold text-base-content">ScrollSpy Demo</p>
    <p>A Sitewright showcase of scroll-driven navigation highlighting.</p>
  </div>
</div>`;

export const SCROLLSPY_DEMO_WEBSITE: WebsiteSettings = {
  mainNav: MAIN_NAV,
  footer: FOOTER,
  // ScrollSpy on, site-wide → governs #main-nav. box-solid makes the active link visibly filled; a
  // pinned sticky header keeps the nav on screen and supplies the --sw-header-h offset ScrollSpy reads.
  effects: { scrollSpy: true, navEffect: 'box-solid', stickyHeader: 'pinned' },
};

export const SCROLLSPY_DEMO_SETTINGS = { defaultLocale: 'en', locales: ['en'] } as const;

// No scroll-margin on the sections: the sticky header already sets `scroll-padding-top:var(--sw-header-h)`
// on the scroll container, so an anchor jump / smooth-scroll lands the section snug below the fixed header.
const SECTION = 'flex min-h-[88vh] flex-col justify-center px-6 py-12';

export function scrollspyDemoPages(): Page[] {
  return [
    {
      id: 'home',
      path: '',
      title: 'ScrollSpy Demo',
      description:
        'A one-page site whose main navigation highlights the section in view as you scroll, mixing in-page section anchors with a route link to the docs page.',
      source: `<section class="sw-top-padding mx-auto flex min-h-[80vh] max-w-4xl flex-col items-center justify-center px-6 text-center">
  <span class="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">Site-wide ScrollSpy</span>
  <h1 class="mt-5 text-4xl font-bold tracking-tight sm:text-6xl">Navigation that follows the scroll</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60">The header above is spied site-wide. As each section scrolls into view its link fills in — and the links mix in-page anchors (Features, Pricing, FAQ) with a real route link (Docs). Scroll down.</p>
  <div class="mt-8 flex flex-wrap justify-center gap-3">
    <a href="#features" class="btn btn-primary">See features</a>
    <a href="/docs" class="btn btn-ghost">Read the docs</a>
  </div>
</section>

<section id="features" class="${SECTION} bg-base-200/40">
  <div class="mx-auto max-w-4xl">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl">Features</h2>
    <p class="mt-4 max-w-2xl leading-relaxed text-base-content/60">As this section enters the viewport the “Features” link in the header lights up. ScrollSpy offsets the trigger by the pinned header height, so the active section is always the one you can actually read.</p>
    <div class="mt-8 grid gap-4 sm:grid-cols-3">
      <div class="rounded-2xl border border-base-200 bg-base-100 p-6 shadow-sm"><b class="text-primary">No code</b><p class="mt-1 text-sm text-base-content/60">One toggle in Website settings.</p></div>
      <div class="rounded-2xl border border-base-200 bg-base-100 p-6 shadow-sm"><b class="text-primary">Composable</b><p class="mt-1 text-sm text-base-content/60">Pairs with any nav effect.</p></div>
      <div class="rounded-2xl border border-base-200 bg-base-100 p-6 shadow-sm"><b class="text-primary">Accessible</b><p class="mt-1 text-sm text-base-content/60">Sets aria-current; never steals focus.</p></div>
    </div>
  </div>
</section>

<section id="pricing" class="${SECTION}">
  <div class="mx-auto max-w-4xl">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl">Pricing</h2>
    <p class="mt-4 max-w-2xl leading-relaxed text-base-content/60">Keep scrolling and the header follows you here. Exactly one link is active at a time — at the very top, the Home link; at the very bottom, the last section.</p>
    <div class="mt-8 grid gap-4 sm:grid-cols-2">
      <div class="rounded-2xl border border-base-200 bg-base-100 p-7 shadow-sm"><b class="text-2xl">Starter</b><p class="mt-2 text-base-content/60">Everything to launch a one-page site.</p></div>
      <div class="rounded-2xl border-2 border-primary bg-base-100 p-7 shadow-md"><b class="text-2xl text-primary">Studio</b><p class="mt-2 text-base-content/60">Multi-page, datasets, and the full effect library.</p></div>
    </div>
  </div>
</section>

<section id="faq" class="${SECTION} bg-base-200/40">
  <div class="mx-auto max-w-4xl">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl">FAQ</h2>
    <div class="mt-6 space-y-4">
      <div class="rounded-2xl border border-base-200 bg-base-100 p-6"><b>Does the mobile menu highlight too?</b><p class="mt-1 text-base-content/60">Yes — site-wide ScrollSpy governs every menu inside the header, desktop and mobile, so both stay in sync.</p></div>
      <div class="rounded-2xl border border-base-200 bg-base-100 p-6"><b>What about the Docs link?</b><p class="mt-1 text-base-content/60">It is a real route link. On this page it just navigates; on the Docs page the header has no in-page sections, so ScrollSpy stays out of the way and normal route highlighting takes over.</p></div>
    </div>
    <p class="mt-8"><a href="/docs" class="btn btn-primary">Open the Docs page →</a></p>
  </div>
</section>`,
    },
    {
      id: 'docs',
      path: 'docs',
      title: 'Docs',
      description:
        'A long page with a custom on-page table of contents marked data-sw-scrollspy — it highlights the section in view independently of the site-wide main nav.',
      source: `<div class="mx-auto max-w-6xl px-6 pb-24 pt-24">
  <h1 class="text-4xl font-bold tracking-tight sm:text-5xl">Docs</h1>
  <p class="mt-4 max-w-2xl text-lg leading-relaxed text-base-content/60">This page carries its own table of contents marked with data-sw-scrollspy. The main navigation has no in-page sections here, so it stays dormant (the Docs link keeps its route highlight) while this sidebar drives its own active state.</p>

  <div class="mt-10 grid gap-10 lg:grid-cols-[200px_1fr]">
    <div class="top-[calc(var(--sw-header-h,1rem)+1rem)] h-max lg:sticky">
      <p class="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-base-content/40">On this page</p>
      <ul class="menu menu-horizontal w-full gap-1 overflow-x-auto sw-nav-line-bottom lg:menu-vertical lg:overflow-visible" data-sw-scrollspy aria-label="On this page">
        <li><a href="#install">Install</a></li>
        <li><a href="#usage">Usage</a></li>
        <li><a href="#anchors">Anchors</a></li>
        <li><a href="#api">Reference</a></li>
      </ul>
    </div>
    <div class="min-w-0">
      <section id="install" class="flex min-h-[80vh] flex-col justify-center border-b border-base-200 py-10">
        <h2 class="text-3xl font-bold tracking-tight">Install</h2>
        <p class="mt-3 max-w-2xl leading-relaxed text-base-content/60">Drop data-sw-scrollspy on any nav and link its items to sections by id. The platform ships the tiny runtime only when it is used.</p>
      </section>
      <section id="usage" class="flex min-h-[80vh] flex-col justify-center border-b border-base-200 py-10">
        <h2 class="text-3xl font-bold tracking-tight">Usage</h2>
        <p class="mt-3 max-w-2xl leading-relaxed text-base-content/60">As each section scrolls past the header line, its link in this menu becomes active. Exactly one is active at a time; at the bottom of the page the last one wins.</p>
      </section>
      <section id="anchors" class="flex min-h-[80vh] flex-col justify-center border-b border-base-200 py-10">
        <h2 class="text-3xl font-bold tracking-tight">Anchors</h2>
        <p class="mt-3 max-w-2xl leading-relaxed text-base-content/60">A link is spied only when its section exists on the current page, so a global header can use path-prefixed anchors like /#features and they spy only on the page that has them.</p>
      </section>
      <section id="api" class="flex min-h-[80vh] flex-col justify-center py-10">
        <h2 class="text-3xl font-bold tracking-tight">Reference</h2>
        <p class="mt-3 max-w-2xl leading-relaxed text-base-content/60">ScrollSpy toggles .active + aria-current and offsets by the sticky header. Without JavaScript the links still jump; under reduced motion it still highlights (it toggles classes, not motion).</p>
        <p class="mt-6"><a href="/" class="btn btn-ghost">← Back to the one-page demo</a></p>
      </section>
    </div>
  </div>
</div>`,
    },
  ];
}
