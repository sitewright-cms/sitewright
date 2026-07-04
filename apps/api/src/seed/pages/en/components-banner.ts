import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- BANNER showcase (child of Components)
// The Banner component is a free-content, dismissible announcement (promos / "see our latest product") —
// NOT the cookie/consent banner (that's the auto-injected Consent Manager). This page is the COMPLETE tour:
// layouts, all placements, frequencies + action buttons, the reveal delay, data-sw-animation entrance effects, and
// rich backgrounds (image / gradient / live shader). The teaching copy localizes; the inline demo banners +
// `<pre><code>` markup stay literal (illustrative). The few LIVE demos are data-position="inline" (in the
// flow, never overlaying) + data-frequency="always" + a plain "dismiss" (so they return on reload).
export function pageComponentsBanner(assets: Record<string, string>): Page {
  return {
    id: 'comp-banner',
    path: 'banner',
    title: 'Banner',
    description:
      'A free-content dismissible announcement — promos, alerts, "see our latest product". The runtime reveals it and remembers the dismissal in localStorage per its frequency. Layouts, placements, frequencies, entrance effects (data-sw-animation), and rich backgrounds. Not the consent banner.',
    parent: 'components',
    order: 5,
    data: {
      bn_bg: assets['blog-design'] ?? '',
      bn_intro:
        'A free-content banner you drop anywhere — the runtime reveals it, then remembers the dismissal in localStorage so it does not nag. You author the body and the action buttons; the placement, frequency, snooze, reveal delay and entrance animation are all attribute switches. It is NOT the cookie banner — that is the auto-injected Consent Manager.',
      sec_layouts_t: 'Layouts',
      sec_layouts_d:
        'The same component, any shape. A full-width bar, a corner card, or a centered card — the content + the data-position decide the look. The three action parts are dismiss (follows the frequency), dismiss-forever ("don\'t show again"), and remind (snooze).',
      sec_place_t: 'Placements',
      sec_place_d:
        'data-position pins it to any edge, corner, or the centre — or inline, in the page flow. (Default: bottom-right.)',
      sec_freq_t: 'How often it returns',
      sec_freq_d:
        'A plain dismiss respects data-frequency; dismiss-forever always hides for good; remind snoozes for data-remind-days. Give each banner a UNIQUE data-sw-banner-id so dismissals are tracked independently.',
      sec_entrance_t: 'Entrance & motion',
      sec_entrance_d:
        'By default a banner fades + rises in (and fades out on dismiss). Add a data-sw-animation effect — fade-up, zoom-in, flip-left, … with data-sw-delay/-duration/-easing — and it uses that for the entrance instead; the dismiss reverses whichever ran. data-delay reveals it after N ms or the first scroll.',
      sec_bg_t: 'Rich backgrounds',
      sec_bg_d:
        'Layer an absolute media element + a scrim under the content for a full-bleed photo, a CSS gradient, or a live WebGL shader (a nested data-sw-component="shader-bg"). The three below are live — dismiss one and reload.',
      sec_nojs_t: 'Without JavaScript',
      sec_nojs_d:
        'No banner appears at all — it ships with the hidden attribute and the runtime is what reveals it, so with scripts disabled the page is simply served as-is.',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url page.parent.path}}">${icon('arrow-left', 'h-4 w-4')} {{page.parent.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-translate="comp_banner.bn_intro">A free-content dismissible banner the runtime reveals, then remembers the dismissal.</p>
</section>

<section class="mx-auto max-w-6xl px-6 pb-16">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_banner.sec_layouts_t">Layouts</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_banner.sec_layouts_d">A full-width bar, a corner card, or a centered card.</p>
  {{!-- Static styled previews (NOT the live component) so the shapes stay visible without dismissing. --}}
  <div class="mt-8 space-y-4">
    <div class="flex flex-wrap items-center gap-3 rounded-xl border border-base-200 bg-base-100 p-4 shadow-sm">
      <span class="text-lg">&#127881;</span><p class="grow text-sm">Free shipping this week — <span class="link link-primary">shop the sale</span>.</p>
      <button type="button" class="btn btn-sm btn-ghost btn-circle">${icon('x', 'h-4 w-4')}</button>
    </div>
    <div class="flex flex-wrap items-center gap-3 rounded-xl border border-base-200 bg-base-100 p-4 shadow-sm sm:max-w-md">
      <div class="grow"><p class="font-semibold">New: dark mode is here</p><p class="text-sm text-base-content/60">Toggle it from the footer.</p></div>
      <button type="button" class="btn btn-sm btn-ghost">Don't show again</button>
    </div>
  </div>
  <pre class="mt-6 max-w-full overflow-x-auto rounded-2xl bg-base-200 p-4 text-xs leading-relaxed"><code>&lt;div data-sw-component="banner" data-sw-banner-id="promo" data-position="bottom-right" data-frequency="once" hidden&gt;
  &lt;div&gt;&lt;p&gt;New: dark mode is here&lt;/p&gt;&lt;/div&gt;
  &lt;button type="button" data-sw-part="dismiss-forever"&gt;Don't show again&lt;/button&gt;  &lt;!-- or "dismiss" / "remind" --&gt;
&lt;/div&gt;</code></pre>
</section>

<section class="mx-auto max-w-6xl px-6 pb-16">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_banner.sec_place_t">Placements</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_banner.sec_place_d">data-position pins it to any edge, corner, or the centre — or inline.</p>
  <div class="relative mt-8 aspect-[2/1] max-w-3xl rounded-2xl border-2 border-dashed border-base-300 bg-base-200/40">
    <span class="absolute left-3 top-3 rounded-md bg-base-100 px-2 py-1 font-mono text-xs shadow">top-left</span>
    <span class="absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-base-100 px-2 py-1 font-mono text-xs shadow">top</span>
    <span class="absolute right-3 top-3 rounded-md bg-base-100 px-2 py-1 font-mono text-xs shadow">top-right</span>
    <span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-primary px-2 py-1 font-mono text-xs text-primary-content shadow">center</span>
    <span class="absolute bottom-3 left-3 rounded-md bg-base-100 px-2 py-1 font-mono text-xs shadow">bottom-left</span>
    <span class="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-base-100 px-2 py-1 font-mono text-xs shadow">bottom</span>
    <span class="absolute bottom-3 right-3 rounded-md bg-base-100 px-2 py-1 font-mono text-xs shadow">bottom-right <span class="opacity-60">(default)</span></span>
  </div>
  <p class="mt-3 text-sm text-base-content/60">…plus <span class="font-mono text-primary">inline</span> — the banner sits in the page flow instead of pinning to the viewport.</p>
</section>

<section class="mx-auto max-w-6xl px-6 pb-16">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_banner.sec_freq_t">How often it returns</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_banner.sec_freq_d">A plain dismiss respects data-frequency; dismiss-forever hides for good; remind snoozes.</p>
  <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <div class="rounded-xl border border-base-300 p-4"><p class="font-mono text-sm font-semibold text-primary">once</p><p class="mt-1 text-sm text-base-content/60">Default — gone for good after a dismiss.</p></div>
    <div class="rounded-xl border border-base-300 p-4"><p class="font-mono text-sm font-semibold text-primary">session</p><p class="mt-1 text-sm text-base-content/60">Returns the next browser session.</p></div>
    <div class="rounded-xl border border-base-300 p-4"><p class="font-mono text-sm font-semibold text-primary">days:N</p><p class="mt-1 text-sm text-base-content/60">Returns after N days.</p></div>
    <div class="rounded-xl border border-base-300 p-4"><p class="font-mono text-sm font-semibold text-primary">always</p><p class="mt-1 text-sm text-base-content/60">Every load until dismissed.</p></div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-16">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_banner.sec_entrance_t">Entrance &amp; motion</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_banner.sec_entrance_d">Fade+rise by default, or any data-sw-animation effect for the entrance — the dismiss reverses it.</p>
  {{!-- LIVE inline demo: a data-sw-animation="fade-up" entrance. Plain "dismiss" + always → it returns on reload. --}}
  <div data-sw-component="banner" data-sw-banner-id="comp-entrance" data-position="inline" data-frequency="always" data-sw-animation="fade-up" data-sw-duration="600" class="mt-6 max-w-xl" hidden>
    <span class="text-lg">&#11088;</span>
    <p class="grow text-sm">This one animates in with <span class="font-mono">data-sw-animation="fade-up"</span> — dismiss + reload to replay.</p>
    <button type="button" class="btn btn-sm btn-ghost btn-circle" data-sw-part="dismiss" aria-label="Dismiss">${icon('x', 'h-4 w-4')}</button>
  </div>
  <pre class="mt-6 max-w-full overflow-x-auto rounded-2xl bg-base-200 p-4 text-xs leading-relaxed"><code>&lt;div data-sw-component="banner" data-sw-banner-id="promo" data-position="top"
     data-sw-animation="fade-up" data-sw-duration="600" data-delay="800" hidden&gt; … &lt;/div&gt;</code></pre>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_banner.sec_bg_t">Rich backgrounds</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_banner.sec_bg_d">A full-bleed photo, a CSS gradient, or a live WebGL shader.</p>
  <div class="mt-8 space-y-4">
    {{!-- Image: an inline banner is position:static, so the absolute media must sit in an INNER relative wrapper. --}}
    <div data-sw-component="banner" data-sw-banner-id="comp-bg-image" data-position="inline" data-frequency="always" class="overflow-hidden border-0 bg-gradient-to-br from-primary to-secondary p-0 text-white" hidden>
      <div class="relative flex w-full flex-wrap items-center gap-3 p-4">
        <div data-sw-bg="bn_bg" class="absolute inset-0 bg-cover bg-center"></div>
        <div class="absolute inset-0 bg-gradient-to-r from-black/70 via-black/45 to-black/15"></div>
        <div class="relative grow"><p class="font-semibold">Full background image</p><p class="text-sm text-white/85">A photo layer (data-sw-bg, editable) + a left-to-right scrim keeps the text legible.</p></div>
        <button type="button" class="btn btn-sm btn-ghost relative text-white" data-sw-part="dismiss" aria-label="Dismiss">${icon('x', 'h-4 w-4')}</button>
      </div>
    </div>
    <div data-sw-component="banner" data-sw-banner-id="comp-bg-gradient" data-position="inline" data-frequency="always" class="border-0 bg-gradient-to-r from-fuchsia-600 via-purple-600 to-indigo-600 text-white" hidden>
      <span class="text-lg">&#10024;</span><p class="grow font-medium">A pure-CSS gradient — no image request, instant paint.</p>
      <button type="button" class="btn btn-sm btn-ghost text-white" data-sw-part="dismiss" aria-label="Dismiss">${icon('x', 'h-4 w-4')}</button>
    </div>
    <div data-sw-component="banner" data-sw-banner-id="comp-bg-shader" data-position="inline" data-frequency="always" class="overflow-hidden border-0 p-0 text-white" hidden>
      <div class="relative flex w-full flex-wrap items-center gap-3 p-4">
        <div data-sw-component="shader-bg" data-preset="silk-flow" class="absolute inset-0"></div>
        <div class="absolute inset-0 bg-black/25"></div>
        <div class="relative grow"><p class="font-semibold">Live WebGL shader</p><p class="text-sm text-white/85">A nested data-sw-component="shader-bg" paints a live canvas behind the content.</p></div>
        <button type="button" class="btn btn-sm btn-ghost relative text-white" data-sw-part="dismiss" aria-label="Dismiss">${icon('x', 'h-4 w-4')}</button>
      </div>
    </div>
  </div>
  <pre class="mt-6 max-w-full overflow-x-auto rounded-2xl bg-base-200 p-4 text-xs leading-relaxed"><code>&lt;div data-sw-component="banner" data-position="inline" class="overflow-hidden border-0 p-0 text-white" hidden&gt;
  &lt;div class="relative flex w-full items-center gap-3 p-4"&gt;            &lt;!-- inner positioning context --&gt;
    &lt;div data-sw-component="shader-bg" data-preset="silk-flow" class="absolute inset-0"&gt;&lt;/div&gt;
    &lt;div class="absolute inset-0 bg-black/25"&gt;&lt;/div&gt;                  &lt;!-- legibility scrim --&gt;
    &lt;div class="relative grow"&gt;…content…&lt;/div&gt;
  &lt;/div&gt;
&lt;/div&gt;</code></pre>
</section>

<section class="mx-auto max-w-6xl px-6 pb-28">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_banner.sec_nojs_t">Without JavaScript</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_banner.sec_nojs_d">No banner appears at all — there is nothing to reveal.</p>
</section>`,
  };
}
