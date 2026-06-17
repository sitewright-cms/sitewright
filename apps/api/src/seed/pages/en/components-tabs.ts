import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- TABS showcase (child of Components)
// The Tabs component: content panels behind an APG tablist the runtime builds from each panel's
// data-sw-title. Two live tab sets (plain prose, then rich markup) + the no-JS/keyboard story.
// Panel TITLES are bound via page.data (data-sw-title="{{sw-translate "comp_tabs.tab1"}}") — NOT static literals —
// so they translate (the seed-content i18n guard requires it). `<pre><code>` samples stay untranslated.
export function pageComponentsTabs(): Page {
  return {
    id: 'comp-tabs',
    path: 'tabs',
    title: 'Tabs',
    description: 'Content panels behind an accessible tablist — arrow-key navigation, the tab buttons built from each panel title, and a no-JS fallback that stacks every panel.',
    parent: 'components',
    order: 3,
    data: {
      tab_intro: 'One component, any content. A tabs root with a tablist slot and a panel per tab — the runtime reads each panel’s title and builds the buttons, wires roving-tabindex arrow keys, and falls back to a readable stack without JavaScript.',
      sec_basic_t: 'Tab labels — plain or rich',
      sec_basic_d: 'Each panel gets a label: a plain data-sw-title, or an optional data-sw-part="tabtitle" child for an icon or other HTML. It’s per tab, so you can mix them — here the first two tabs are rich and the third is plain. Click a tab, or focus one and use the arrow keys.',
      body1: 'Tabs group related content into one compact area — the visitor sees one panel at a time and switches between them without leaving the page.',
      body2: 'Give each panel a title and its content. The runtime generates the accessible tablist, links each button to its panel, and moves focus with the arrow keys (Home and End jump to the first and last).',
      body3: 'The markup follows the WAI-ARIA tabs pattern: a tablist of buttons, each controlling a labelled tabpanel. Roving tabindex means Tab enters the active panel rather than walking every button.',
      sec_rich_t: 'Panels hold any markup',
      sec_rich_d: 'A panel is just a container — put a list, a stat grid, an image, or a call to action inside. Here one panel is a checklist and the next is a set of figures.',
      rli1: 'Unlimited panels, each with its own title and content',
      rli2: 'Keyboard, touch, and screen-reader support out of the box',
      rli3: 'No custom JavaScript — just declarative markup',
      rstat1_n: '0',
      rstat1_l: 'lines of JavaScript you write',
      rstat2_n: '100%',
      rstat2_l: 'usable with the keyboard alone',
      sec_nojs_t: 'Without JavaScript',
      sec_nojs_d: 'If scripts don’t run, the tablist stays hidden and every panel renders stacked, one after another — so all the content is still there and readable. Never hide essential content behind a tab that only appears with JS.',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url page.parent.path}}">${icon('arrow-left', 'h-4 w-4')} {{page.parent.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-translate="comp_tabs.tab_intro">One component, any content.</p>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_tabs.sec_basic_t">Tabs — the defaults</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_tabs.sec_basic_d">A panel per tab; the runtime builds the buttons from each panel’s title.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>per panel: data-sw-title="…" (plain)  —or—  a &lt;span data-sw-part="tabtitle"&gt; child (HTML)</code></pre>
  <!-- Mixed labels: tabs 1 & 2 use a data-sw-part="tabtitle" child (icon + text) the runtime
       moves into the button; tab 3 has no tabtitle, so it falls back to its data-sw-title text.
       data-sw-title also stays as the accessible name for the rich tabs. -->
  <div class="mt-8" data-sw-component="tabs">
    <div data-sw-part="panel" data-sw-title="{{sw-translate "comp_tabs.tab1"}}" class="pt-2">
      <span data-sw-part="tabtitle">${icon('book-open', 'h-4 w-4')} {{sw-translate "comp_tabs.tab1"}}</span>
      <p class="leading-relaxed text-base-content/70" data-sw-translate="comp_tabs.body1">Tabs group related content into one compact area.</p>
    </div>
    <div data-sw-part="panel" data-sw-title="{{sw-translate "comp_tabs.tab2"}}" class="pt-2">
      <span data-sw-part="tabtitle">${icon('settings', 'h-4 w-4')} {{sw-translate "comp_tabs.tab2"}}</span>
      <p class="leading-relaxed text-base-content/70" data-sw-translate="comp_tabs.body2">Give each panel a title and its content.</p>
    </div>
    <div data-sw-part="panel" data-sw-title="{{sw-translate "comp_tabs.tab3"}}" class="pt-2">
      <p class="leading-relaxed text-base-content/70" data-sw-translate="comp_tabs.body3">The markup follows the WAI-ARIA tabs pattern.</p>
    </div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_tabs.sec_rich_t">Panels hold any markup</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_tabs.sec_rich_d">A panel is just a container — put a list, a stat grid, an image, or a call to action inside.</p>
  <!-- Optional: author the tablist to style the tab bar (here a segmented-control track).
       The runtime still fills it with the buttons + the floating selector pill. -->
  <div class="mt-8 rounded-3xl border border-base-200 bg-base-100 p-3 shadow-sm" data-sw-component="tabs">
    <div data-sw-part="tablist" class="rounded-2xl bg-base-200/50 px-2 py-2"></div>
    <div data-sw-part="panel" data-sw-title="{{sw-translate "comp_tabs.rtab1"}}" class="p-6">
      <ul class="space-y-3">
        <li class="flex items-start gap-3"><span class="mt-0.5 text-primary">${icon('check', 'h-5 w-5')}</span><span class="text-base-content/70" data-sw-translate="comp_tabs.rli1">Unlimited panels.</span></li>
        <li class="flex items-start gap-3"><span class="mt-0.5 text-primary">${icon('check', 'h-5 w-5')}</span><span class="text-base-content/70" data-sw-translate="comp_tabs.rli2">Keyboard + screen-reader support.</span></li>
        <li class="flex items-start gap-3"><span class="mt-0.5 text-primary">${icon('check', 'h-5 w-5')}</span><span class="text-base-content/70" data-sw-translate="comp_tabs.rli3">No custom JavaScript.</span></li>
      </ul>
    </div>
    <div data-sw-part="panel" data-sw-title="{{sw-translate "comp_tabs.rtab2"}}" class="p-6">
      <div class="grid grid-cols-2 gap-6">
        <div><div class="text-4xl font-bold tracking-tight text-primary" data-sw-text="rstat1_n">0</div><div class="mt-1 text-sm text-base-content/60" data-sw-translate="comp_tabs.rstat1_l">lines of JavaScript you write</div></div>
        <div><div class="text-4xl font-bold tracking-tight text-primary" data-sw-text="rstat2_n">100%</div><div class="mt-1 text-sm text-base-content/60" data-sw-translate="comp_tabs.rstat2_l">usable with the keyboard alone</div></div>
      </div>
    </div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-28">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_tabs.sec_nojs_t">Without JavaScript</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_tabs.sec_nojs_d">The tablist stays hidden and every panel renders stacked — all the content is still there and readable.</p>
</section>`,
  };
}
