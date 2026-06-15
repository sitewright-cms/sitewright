import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- CONTACT (code-first)
// The working contact page: info cards, the platform FORM embedded by reference — {{sw-form
// "contact"}} resolves the locale's own definition (contact / contact-de) and the render pass
// injects the submission endpoint, honeypot, and messages — plus a native-<dialog> MODAL
// ("what to expect on the intro call") opened by a plain button, no custom JS.
export function pageContact(): Page {
  return {
    id: 'contact',
    path: 'contact',
    title: 'Contact',
    description: 'Tell us about your project — we reply within one business day.',
    parent: 'home', // home is the tree root
    nav: { slots: ['header'], order: 6 },
    data: { c_close: 'Close' },
    source: `<section class="mx-auto max-w-6xl px-6 py-24">
  <div class="grid items-start gap-12 lg:grid-cols-2 lg:gap-20">
    <div class="nw-rise">
      <h1 class="text-4xl font-bold tracking-tight sm:text-5xl" data-sw-translate="contact.headline">Let’s build something great</h1>
      <p class="mt-5 text-lg leading-relaxed text-base-content/70" data-sw-translate="contact.subhead">Tell us about your project and we’ll get back within one business day. Prefer email? Reach us directly — we read every message.</p>
      <ul class="mt-10 list-none space-y-4 p-0">
        <li class="flex items-center gap-4"><span class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-secondary/15 text-primary">${icon('mail', 'h-5 w-5')}</span><a class="nw-underline font-semibold text-primary no-underline" href="mailto:hello@northwindstudio.com">{{company.email}}</a></li>
        <li class="flex items-center gap-4"><span class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-secondary/15 text-primary">${icon('phone', 'h-5 w-5')}</span><span class="font-medium text-base-content/80">{{company.telephone}}</span></li>
        <li class="flex items-center gap-4"><span class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-secondary/15 text-primary">${icon('map-pin', 'h-5 w-5')}</span><span class="font-medium text-base-content/80">{{company.address.street}} · {{company.address.locality}}, {{company.address.region}}</span></li>
        <li class="flex items-center gap-4"><span class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-secondary/15 text-primary">${icon('clock', 'h-5 w-5')}</span><span class="font-medium text-base-content/80" data-sw-text="c_hours">Mon–Fri, 9–6 PT</span></li>
      </ul>

      <!-- A native-<dialog> MODAL: the runtime wires the open button to showModal() (focus trap,
           Esc, backdrop for free). Without JS the button simply does nothing — the page still works. -->
      <div class="mt-12" data-sw-component="modal" data-sw-block="Modal" data-close-label="{{page.data.c_close}}">
        <button type="button" data-sw-part="open" class="btn btn-outline gap-2 rounded-full px-6">${icon('calendar', 'h-5 w-5')} <span data-sw-text="c_modal_btn">What happens on the intro call?</span></button>
        <dialog data-sw-part="dialog" class="max-w-md rounded-3xl">
          <h2 class="text-xl font-bold tracking-tight" data-sw-text="c_modal_t">A 20-minute conversation, no pitch</h2>
          <div class="mt-3 space-y-2 text-sm leading-relaxed text-base-content/70" data-sw-html="c_modal_b"><p>We ask about your goals, your timeline, and what “working” looks like in a year. You ask us anything.</p><p>If we’re a fit, you get a fixed quote within two days. If we’re not, we’ll say so and point you somewhere good.</p></div>
        </dialog>
      </div>
    </div>

    <div class="nw-card relative rounded-3xl border border-base-200 bg-base-100 p-8 shadow-2xl shadow-neutral/10" data-aos="fade-up">
      <div class="absolute inset-x-0 top-0 h-1.5 rounded-t-3xl bg-gradient-to-r from-primary to-secondary" aria-hidden="true"></div>
      <h2 class="text-lg font-bold tracking-tight" data-sw-text="c_form_t">Project enquiry</h2>
      {{sw-form "contact" class="mt-4"}}
    </div>
  </div>
</section>`,
  };
}
