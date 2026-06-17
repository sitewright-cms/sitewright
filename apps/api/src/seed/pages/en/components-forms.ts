import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- FORM showcase (child of Components)
// The Form component is an EMBED: {{sw-form "id"}} (or data-sw-form="id") expands the stored form
// definition into the full markup at render, and the form-embed pass injects the endpoint + anti-spam.
// Two live embeds of the example's `contact` form (helper, then the attribute form in a styled card)
// + the anti-spam / locale-aware / no-JS story. The form's own fields/labels come from the (localized)
// form definition, so they need no page.data keys here. `<pre><code>` samples stay untranslated.
export function pageComponentsForms(): Page {
  return {
    id: 'comp-forms',
    path: 'forms',
    title: 'Forms',
    description: 'Embed a configured form anywhere with one tag — fields, validation, anti-spam, and inline success all generated for you, and the right language picked automatically.',
    parent: 'components',
    order: 6,
    data: {
      frm_intro: 'Build a form once in the Forms tab, then embed it anywhere — {{sw-form "id"}} or data-sw-form="id" expands the whole thing at render: fields, labels, validation, a honeypot, and an inline success message. There is no markup to hand-author and nothing to wire up.',
      sec_helper_t: 'Embed with the helper',
      sec_helper_d: 'The simplest form: one helper call expands the stored “contact” definition. Add a class= to style the wrapper.',
      sec_attr_t: 'Embed by attribute, in your own layout',
      sec_attr_d: 'Prefer to place it by hand? An empty element carrying data-sw-form="contact" is filled with the same markup — drop it into any container you’ve styled, like this card.',
      sec_about_t: 'Anti-spam, locale-aware, no-JS',
      sec_about_d: 'Every embed gets a hidden honeypot, a submit time-trap, and optional hCaptcha; it posts JSON to the injected endpoint and shows its success or error inline. On a translated page “contact” resolves to the matching localized form automatically. With no JavaScript the form has no action and won’t submit — anti-spam by design.',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url page.parent.path}}">${icon('arrow-left', 'h-4 w-4')} {{page.parent.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-translate="comp_forms.frm_intro">Build a form once, embed it anywhere with one tag.</p>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_forms.sec_helper_t">Embed with the helper</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_forms.sec_helper_d">One helper call expands the stored “contact” definition.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>&#123;&#123;sw-form "contact"&#125;&#125;</code></pre>
  <div class="mt-8 max-w-xl">{{sw-form "contact"}}</div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_forms.sec_attr_t">Embed by attribute, in your own layout</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_forms.sec_attr_d">An empty form carrying data-sw-form="contact" is filled with the same markup.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>&lt;form data-sw-form="contact"&gt;&lt;/form&gt;</code></pre>
  <div class="mt-8 max-w-xl rounded-3xl border border-base-200 bg-base-100 p-8 shadow-sm">
    <form data-sw-form="contact"></form>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-28">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_forms.sec_about_t">Anti-spam, locale-aware, no-JS</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_forms.sec_about_d">Honeypot, time-trap, optional hCaptcha; JSON submit with inline success; the localized form is chosen automatically.</p>
</section>`,
  };
}
