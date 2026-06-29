import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- BANNER showcase (child of Components)
// The Banner component is a free-content, dismissible announcement (promos / "see our latest product") —
// NOT the cookie/consent banner (that's the auto-injected Consent Manager). The server ships it hidden and
// the runtime reveals it, then remembers the dismissal in localStorage per its frequency. This page
// DOCUMENTS it — a static styled preview, the real markup, and the frequency / no-JS story — rather than
// adding a live banner that would nag on every visit. `<pre><code>` samples stay untranslated.
export function pageComponentsBanner(): Page {
  return {
    id: 'comp-banner',
    path: 'banner',
    title: 'Banner',
    description:
      'A free-content dismissible announcement — promos, alerts, "see our latest product". The runtime reveals it and remembers the dismissal in localStorage per its frequency. Not the consent banner.',
    parent: 'components',
    order: 5,
    data: {
      bn_intro:
        'A free-content banner you drop anywhere — the runtime reveals it, then remembers the dismissal in localStorage so it does not nag. You author the body and the action buttons; the frequency, position and snooze are attribute switches. It is NOT the cookie banner — that is the auto-injected Consent Manager.',
      sec_preview_t: 'What it looks like',
      sec_preview_d:
        'A static preview of a corner promo card (shown here so it is visible without dismissing a live one). The real banner is fixed to the chosen corner and fades in on reveal.',
      bn_text: 'To see our latest product, take a look at the shop.',
      bn_dismiss: 'Don’t show again',
      sec_how_t: 'How it works',
      sec_how_d:
        'Author it once in a slot or page body with the hidden attribute. The runtime reveals it, and the dismiss buttons remember the choice: data-sw-part="dismiss" follows data-frequency (once / session / days:N / always), "dismiss-forever" hides it permanently, and "remind" snoozes for data-remind-days. Give each banner a UNIQUE data-sw-banner-id so dismissals are tracked independently. data-position places it (corners / top / bottom / center / inline) and data-delay reveals it after N ms or the first scroll.',
      sec_nojs_t: 'Without JavaScript',
      sec_nojs_d:
        'No banner appears at all — it ships with the hidden attribute and the runtime is what reveals it, so with scripts disabled the page is simply served as-is.',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url page.parent.path}}">${icon('arrow-left', 'h-4 w-4')} {{page.parent.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-translate="comp_banner.bn_intro">A free-content dismissible banner the runtime reveals, then remembers the dismissal.</p>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_banner.sec_preview_t">What it looks like</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_banner.sec_preview_d">A static preview of a corner promo card.</p>
  {{!-- Static visual preview — NOT the live component (the real one reveals + remembers its dismissal). --}}
  <div class="mt-8 flex flex-col items-start gap-4 rounded-2xl border border-base-200 bg-base-100 p-6 shadow-lg sm:max-w-md">
    <p class="grow text-sm leading-relaxed text-base-content/70" data-sw-translate="comp_banner.bn_text">To see our latest product, take a look at the shop.</p>
    <button type="button" class="btn btn-sm btn-ghost" data-sw-translate="comp_banner.bn_dismiss">Don’t show again</button>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_banner.sec_how_t">How it works</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_banner.sec_how_d">Author it hidden; the runtime reveals it and the dismiss buttons remember the choice.</p>
  <pre class="mt-4 max-w-full overflow-x-auto rounded-2xl bg-base-200 p-4 text-xs leading-relaxed"><code>&lt;div data-sw-component="banner" data-sw-banner-id="promo" data-position="bottom-right" data-frequency="once" hidden&gt;
  &lt;p&gt;To see our latest product, &lt;a class="link" href="/shop"&gt;click here&lt;/a&gt;.&lt;/p&gt;
  &lt;button type="button" class="btn btn-sm btn-ghost" data-sw-part="dismiss-forever"&gt;Don't show again&lt;/button&gt;
&lt;/div&gt;</code></pre>
</section>

<section class="mx-auto max-w-6xl px-6 pb-28">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_banner.sec_nojs_t">Without JavaScript</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_banner.sec_nojs_d">No banner appears at all — there is nothing to reveal.</p>
</section>`,
  };
}
