import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- SCROLLSPY showcase (child of Components)
// A custom on-page nav (a table of contents) marked with `data-sw-scrollspy`: the runtime highlights the
// TOC link whose `<section id>` is currently scrolled into view, toggling the platform active convention
// (`.active` + `aria-current="true"`) — so it composes with a nav effect (here `sw-nav-line-bottom`) for the
// visible underline. The trigger line auto-offsets by the sticky header (`--sw-header-h`). No-JS / reduced
// motion → the links still jump to their sections, just with no live highlight. Copy is bound via
// data-sw-text/page.data so the de/es variants translate; section ids + the attribute stay as-is.
export function pageComponentsScrollSpy(): Page {
  return {
    id: 'comp-scrollspy',
    path: 'scrollspy',
    title: 'ScrollSpy',
    description:
      'Highlight the nav link whose in-page section is scrolled into view. Add data-sw-scrollspy to any on-page nav (here a sticky table of contents) — it toggles .active + aria-current as you scroll, offset by the sticky header, and pairs with any nav effect for the visible state.',
    parent: 'components',
    order: 11,
    data: {
      ss_intro:
        'Give a long, single page a live table of contents. Add data-sw-scrollspy to a nav and link each item to a section by id — the runtime highlights the link whose section is currently in view as you scroll, offset by the sticky header. It toggles the same active state the nav already uses (.active + aria-current), so it inherits whatever active styling you have. Scroll the sections on the right and watch the menu follow.',
      toc_eyebrow: 'On this page',
      nav_overview: 'Overview',
      nav_how: 'How it works',
      nav_anchors: 'Anchors & site-wide',
      nav_a11y: 'Accessibility',
      overview_t: 'A live table of contents',
      overview_d:
        'This sticky menu carries data-sw-scrollspy. Each link points at a section below it by id (a link to #how targets the section with id="how"). As that section scrolls into view its link gets the active state — exactly one at a time. The menu that owns in-page sections takes over its own highlighting; a menu with none is left to ordinary route highlighting.',
      how_t: 'How it works',
      how_d:
        'The runtime finds the last section whose top has crossed a trigger line near the top of the viewport, offset by the fixed header so the active section is the one you can actually read. At the very bottom of the page the final section wins — so a short last section still activates — and above the first section nothing (or a Home link) is highlighted. It runs off a passive, throttled scroll listener; no heavy work per frame.',
      anchors_t: 'Path-prefixed anchors & the site-wide toggle',
      anchors_d:
        'Links resolve to a section only when that section exists on the current page, so path-prefixed anchors work too: a global header can link to /#pricing from any page — it just navigates home, and once there, spies the section. Prefer not to touch markup? Turn on ScrollSpy in Website settings and the main + mobile navigation are spied site-wide.',
      a11y_t: 'Accessible & resilient',
      a11y_d:
        'The active link is marked aria-current="true" for assistive tech, and auto-highlighting never steals focus. Without JavaScript the links still jump to their sections; only the live highlight is skipped. Under reduced motion it keeps highlighting — it toggles classes, not motion. ScrollSpy decorates navigation; it never replaces it.',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-4 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url page.parent.path}}">${icon('arrow-left', 'h-4 w-4')} {{page.parent.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-text="ss_intro">Give a long page a live table of contents.</p>
  <pre class="mt-4 inline-block max-w-full overflow-x-auto text-xs"><code>&lt;ul class="menu sw-nav-line-bottom" data-sw-scrollspy&gt;…&lt;a href="#how"&gt;…  ·  &lt;section id="how"&gt;…</code></pre>
</section>

<div class="mx-auto grid max-w-6xl gap-10 px-6 pb-28 lg:grid-cols-[210px_1fr]">
  <!-- The on-page nav (table of contents). data-sw-scrollspy spies its #anchor links; sw-nav-line-bottom
       gives a.active the visible underline. Sticky below the site header via the --sw-header-h offset. -->
  <div class="top-[calc(var(--sw-header-h,1rem)+1rem)] h-max lg:sticky">
    <p class="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-base-content/40" data-sw-text="toc_eyebrow">On this page</p>
    <ul class="menu menu-horizontal w-full gap-1 overflow-x-auto sw-nav-line-bottom lg:menu-vertical lg:overflow-visible" data-sw-scrollspy aria-label="On this page">
      <li><a href="#overview" data-sw-text="nav_overview">Overview</a></li>
      <li><a href="#how" data-sw-text="nav_how">How it works</a></li>
      <li><a href="#anchors" data-sw-text="nav_anchors">Anchors &amp; site-wide</a></li>
      <li><a href="#a11y" data-sw-text="nav_a11y">Accessibility</a></li>
    </ul>
  </div>

  <div class="min-w-0">
    <section id="overview" class="flex min-h-[78vh] flex-col border-b border-base-200 py-10">
      <h2 class="text-3xl font-bold tracking-tight" data-sw-text="overview_t">A live table of contents</h2>
      <p class="mt-3 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="overview_d">This sticky menu carries data-sw-scrollspy.</p>
    </section>
    <section id="how" class="flex min-h-[78vh] flex-col border-b border-base-200 py-10">
      <h2 class="text-3xl font-bold tracking-tight" data-sw-text="how_t">How it works</h2>
      <p class="mt-3 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="how_d">The runtime finds the section under the header offset.</p>
    </section>
    <section id="anchors" class="flex min-h-[78vh] flex-col border-b border-base-200 py-10">
      <h2 class="text-3xl font-bold tracking-tight" data-sw-text="anchors_t">Path-prefixed anchors &amp; the site-wide toggle</h2>
      <p class="mt-3 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="anchors_d">Links resolve only to sections on the current page.</p>
    </section>
    <section id="a11y" class="flex min-h-[78vh] flex-col py-10">
      <h2 class="text-3xl font-bold tracking-tight" data-sw-text="a11y_t">Accessible &amp; resilient</h2>
      <p class="mt-3 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="a11y_d">The active link is marked aria-current; focus is never stolen.</p>
    </section>
  </div>
</div>`,
  };
}
