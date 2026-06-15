import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- COOKIE CONSENT showcase (child of Components)
// The CookieConsent component is inherently SITE-WIDE + once-per-session: the server ships it hidden
// and the runtime reveals it only until consent is stored in localStorage. This site already runs one
// (the bottom skeleton slot), so this page DOCUMENTS it — a static styled preview of its appearance
// (so it's visible even after you've accepted), the real markup, and the localStorage/no-JS story —
// rather than adding a second live banner. `<pre><code>` samples stay untranslated.
export function pageComponentsCookieConsent(): Page {
  return {
    id: 'comp-cookie',
    path: 'cookie-consent',
    title: 'Cookie consent',
    description: 'A consent banner stored in localStorage — shipped hidden, revealed once on the first visit, and dismissed for good when accepted. It’s a skeleton-slot component, live site-wide.',
    parent: 'components',
    order: 5,
    data: {
      cc_intro: 'A small consent banner the runtime reveals only until the visitor accepts — the choice is remembered in localStorage, so it shows once and never again. It lives in a skeleton slot so it’s present on every page; you saw the real one at the bottom of your first visit.',
      sec_preview_t: 'What it looks like',
      sec_preview_d: 'A static preview of the banner (shown here so it’s visible even after you’ve accepted the real one). The live banner is fixed to the bottom of the viewport and slides in on a first visit.',
      cc_text: 'We use a few essential cookies to make this site work and anonymous analytics to improve it.',
      cc_more: 'Learn more',
      cc_accept: 'OK, got it',
      sec_how_t: 'How it works',
      sec_how_d: 'Author it once in a skeleton slot (the Footer or a dedicated slot). The server renders it with a hidden attribute; the runtime checks localStorage and reveals it only when no choice is stored, then hides it permanently when the accept button is pressed. The marker, not authored HTML, carries the behaviour.',
      sec_nojs_t: 'Without JavaScript',
      sec_nojs_d: 'No banner appears at all — and with scripts disabled there is nothing to set or store, so the page is simply served as-is.',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url page.parent.path}}">${icon('arrow-left', 'h-4 w-4')} {{page.parent.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-text="cc_intro">A small consent banner the runtime reveals only until accepted.</p>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_preview_t">What it looks like</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_preview_d">A static preview of the banner.</p>
  {{!-- Static visual preview — NOT the live component (the real one is the site-wide bottom-slot banner). --}}
  <div class="mt-8 flex flex-col items-start gap-4 rounded-2xl border border-base-200 bg-base-100 p-6 shadow-lg sm:flex-row sm:items-center">
    <p class="grow text-sm leading-relaxed text-base-content/70"><span data-sw-text="cc_text">We use a few essential cookies.</span> <span class="font-semibold text-primary underline" data-sw-text="cc_more">Learn more</span></p>
    <button type="button" class="btn btn-primary btn-sm shrink-0" data-sw-text="cc_accept">OK, got it</button>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_how_t">How it works</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_how_d">The server renders it hidden; the runtime reveals it only when no choice is stored.</p>
  <pre class="mt-4 max-w-full overflow-x-auto rounded-2xl bg-base-200 p-4 text-xs leading-relaxed"><code>&lt;div data-sw-component="cookie-consent" hidden&gt;
  &lt;p&gt;We use a few essential cookies. &lt;a class="link" href="/privacy"&gt;Learn more&lt;/a&gt;&lt;/p&gt;
  &lt;button type="button" data-sw-part="accept"&gt;OK, got it&lt;/button&gt;
&lt;/div&gt;</code></pre>
</section>

<section class="mx-auto max-w-6xl px-6 pb-28">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_nojs_t">Without JavaScript</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_nojs_d">No banner appears at all — there is nothing to set or store.</p>
</section>`,
  };
}
