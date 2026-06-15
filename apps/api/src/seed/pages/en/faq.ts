import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- FAQ (footer nav slot)
// An accordion as the PLATFORM PATTERN prescribes it: native <details>/<summary> styled with
// DaisyUI's collapse classes (themed by the brand tokens) — zero JavaScript, fully interactive
// even in the script-blocked editor preview. There is deliberately NO accordion component
// (DaisyUI collapse covers it). Questions/answers come from the `faq` dataset (auto-resolved
// per locale); answers are RICHTEXT rendered through {{sw-html}} (sanitized).
export function pageFaq(): Page {
  return {
    id: 'faq',
    path: 'faq',
    title: 'FAQ',
    description: 'Answers to the questions every project starts with: timelines, cost, editing, hosting.',
    parent: 'home',
    nav: { slots: ['footer'], order: 1 },
    source: `<section class="mx-auto max-w-3xl px-6 py-24">
  <span class="text-sm font-semibold uppercase tracking-[0.18em] text-primary" data-sw-translate="faq.eyebrow">Good to know</span>
  <h1 class="mt-4 text-4xl font-bold tracking-tight sm:text-6xl" data-sw-translate="faq.headline">Frequently asked questions</h1>
  <p class="mt-5 text-lg leading-relaxed text-base-content/60" data-sw-translate="faq.intro">The questions every project starts with — answered plainly. Anything missing? Just ask.</p>

  <div class="join join-vertical mt-14 w-full rounded-3xl shadow-sm">
    {{#each dataset.faq}}
    <details class="collapse collapse-plus join-item border border-base-200 bg-base-100"{{#if @first}} open{{/if}}>
      <summary class="collapse-title font-semibold">{{question}}</summary>
      <div class="collapse-content prose prose-sm max-w-none text-base-content/70">{{sw-html answer}}</div>
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
