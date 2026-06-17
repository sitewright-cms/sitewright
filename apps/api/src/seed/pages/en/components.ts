import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- COMPONENTS HUB (+ children)
// A nav DROPDOWN parent (dropdown:true) over one page PER first-party interactive component —
// Sliders and Lightbox so far. The hub itself is a thin index: the cards are built from
// `page.children` (each child's own translated title + description), so adding a component page
// makes it appear here with zero extra wiring or translation keys. The deep showcases live in
// the children: components-slider.ts and components-lightbox.ts.
export function pageComponents(): Page {
  return {
    id: 'components',
    path: 'components',
    title: 'Components',
    description: 'The first-party interactive components this site is built with — sliders, lightbox galleries, tabs, modals, cookie consent, and forms — each in every variant the platform ships.',
    parent: 'home',
    // dropdown:true folds the child pages under "Components" in the header nav + the editor tree.
    nav: { title: 'Components', slots: ['header'], order: 8, dropdown: true },
    data: {
      a_view: 'Explore',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <div class="nw-rise max-w-2xl">
    <span class="text-sm font-semibold uppercase tracking-[0.18em] text-primary" data-sw-translate="components.comp_eyebrow">Showcase</span>
    <h1 class="mt-4 text-4xl font-bold tracking-tight sm:text-6xl" data-sw-translate="components.comp_h1">Interactive components</h1>
    <p class="mt-5 text-lg leading-relaxed text-base-content/60" data-sw-translate="components.comp_intro">The first-party components this site is built with, each shown in every configuration — defaults first, then each option. Everything works with keyboard, touch, and without JavaScript.</p>
  </div>
</section>
<section class="mx-auto max-w-6xl px-6 pb-28">
  <div class="grid gap-6 sm:grid-cols-2" data-aos="fade-up">
    {{#each page.children}}
    <a class="nw-card group flex flex-col rounded-3xl border border-base-200 bg-base-100 p-8 no-underline shadow-sm hover:border-primary/30 hover:shadow-xl hover:shadow-primary/5" href="{{sw-url path}}">
      <h2 class="text-2xl font-bold tracking-tight">{{title}}</h2>
      <p class="mt-2 grow leading-relaxed text-base-content/60">{{description}}</p>
      <span class="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">{{@root.page.data.a_view}} ${icon('arrow-right', 'h-4 w-4 transition-transform group-hover:translate-x-1')}</span>
    </a>
    {{/each}}
  </div>
</section>`,
  };
}
