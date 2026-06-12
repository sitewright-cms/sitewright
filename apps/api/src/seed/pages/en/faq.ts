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
    source: `<section class="mx-auto max-w-3xl px-6 py-20">
  <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="faq_eyebrow">Good to know</span>
  <h1 class="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="faq_h1">Frequently asked questions</h1>
  <p class="mt-4 text-lg text-base-content/60" data-sw-text="faq_intro">The questions every project starts with — answered plainly. Anything missing? Just ask.</p>

  <div class="mt-12" data-sw-block="Accordion">
    {{#each data.faq}}
    <details data-sw-block="AccordionItem" class="bg-base-100"{{#if @first}} open{{/if}}>
      <summary>{{question}}</summary>
      <div data-sw-part="content" class="prose prose-sm max-w-none text-base-content/70">{{sw-rich answer}}</div>
    </details>
    {{/each}}
  </div>

  <div class="mt-12 rounded-3xl bg-base-200 p-8 text-center" data-aos="fade-up">
    <p class="font-semibold" data-sw-text="faq_cta_t">Still curious?</p>
    <a class="btn btn-primary mt-4 gap-2" href="/contact" data-sw-href="href_contact"><span data-sw-text="faq_cta">Ask us anything</span> ${icon('arrow-right', 'h-4 w-4')}</a>
  </div>
</section>`,
  };
}
