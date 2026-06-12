import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- FAQ (footer nav slot)
// The first-party ACCORDION: native <details>/<summary> styled by the platform's
// data-sw-block="AccordionItem" hooks — zero JavaScript, fully interactive even in the
// script-blocked editor preview. Questions/answers come from the `faq` dataset (auto-resolved
// per locale); answers are RICHTEXT rendered through {{sw-rich}} (sanitized).
export function pageFaq(): Page {
  return {
    id: 'faq',
    path: 'faq',
    title: 'FAQ',
    description: 'Answers to the questions every project starts with: timelines, cost, editing, hosting.',
    parent: 'home',
    nav: { slots: ['footer'], order: 1 },
    source: `<section class="mx-auto max-w-3xl px-6 py-24">
  <span class="text-sm font-semibold uppercase tracking-[0.18em] text-primary" data-sw-text="faq_eyebrow">Good to know</span>
  <h1 class="mt-4 text-4xl font-bold tracking-tight sm:text-6xl" data-sw-text="faq_h1">Frequently asked questions</h1>
  <p class="mt-5 text-lg leading-relaxed text-base-content/60" data-sw-text="faq_intro">The questions every project starts with — answered plainly. Anything missing? Just ask.</p>

  <div class="mt-14 overflow-hidden rounded-3xl border border-base-200 shadow-sm" data-sw-block="Accordion">
    {{#each data.faq}}
    <details data-sw-block="AccordionItem" class="bg-base-100"{{#if @first}} open{{/if}}>
      <summary>{{question}}</summary>
      <div data-sw-part="content" class="prose prose-sm max-w-none text-base-content/70">{{sw-rich answer}}</div>
    </details>
    {{/each}}
  </div>

  <div class="relative mt-14 overflow-hidden rounded-3xl bg-neutral p-10 text-center text-neutral-content" data-aos="fade-up">
    <div class="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-secondary/20 blur-3xl" aria-hidden="true"></div>
    <p class="relative text-xl font-bold tracking-tight" data-sw-text="faq_cta_t">Still curious?</p>
    <a class="btn btn-primary relative mt-5 gap-2 rounded-full px-7 shadow-lg shadow-primary/30" href="/contact" data-sw-href="href_contact"><span data-sw-text="faq_cta">Ask us anything</span> ${icon('arrow-right', 'h-4 w-4')}</a>
  </div>
</section>`,
  };
}
