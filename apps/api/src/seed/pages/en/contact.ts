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
    source: `<section class="mx-auto max-w-6xl px-6 py-20">
  <div class="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
    <div class="nw-rise">
      <h1 class="text-4xl font-extrabold tracking-tight" data-sw-text="c_h1">Let’s build something great</h1>
      <p class="mt-4 text-lg text-base-content/70" data-sw-text="c_sub">Tell us about your project and we’ll get back within one business day. Prefer email? Reach us directly — we read every message.</p>
      <ul class="mt-8 space-y-4">
        <li class="flex items-center gap-3"><span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('mail', 'h-5 w-5')}</span><a class="font-medium text-primary nw-underline" href="mailto:hello@northwindstudio.com">{{company.email}}</a></li>
        <li class="flex items-center gap-3"><span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('phone', 'h-5 w-5')}</span><span class="text-base-content/80">{{company.telephone}}</span></li>
        <li class="flex items-center gap-3"><span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('map-pin', 'h-5 w-5')}</span><span class="text-base-content/80">{{company.address.streetAddress}} · {{company.address.locality}}, {{company.address.region}}</span></li>
        <li class="flex items-center gap-3"><span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('clock', 'h-5 w-5')}</span><span class="text-base-content/80" data-sw-text="c_hours">Mon–Fri, 9–6 PT</span></li>
      </ul>

      <!-- A native-<dialog> MODAL: the runtime wires the open button to showModal() (focus trap,
           Esc, backdrop for free). Without JS the button simply does nothing — the page still works. -->
      <div class="mt-10" data-sw-component="modal" data-sw-block="Modal">
        <button type="button" data-sw-part="open" class="btn btn-outline gap-2">${icon('calendar', 'h-5 w-5')} <span data-sw-text="c_modal_btn">What happens on the intro call?</span></button>
        <dialog data-sw-part="dialog" class="max-w-md rounded-3xl">
          <button type="button" data-sw-part="close" aria-label="{{page.data.c_close}}">×</button>
          <h2 class="text-xl font-bold" data-sw-text="c_modal_t">A 20-minute conversation, no pitch</h2>
          <div class="mt-3 space-y-2 text-sm text-base-content/70" data-sw-html="c_modal_b"><p>We ask about your goals, your timeline, and what “working” looks like in a year. You ask us anything.</p><p>If we’re a fit, you get a fixed quote within two days. If we’re not, we’ll say so and point you somewhere good.</p></div>
        </dialog>
      </div>
    </div>

    <div class="nw-card rounded-3xl border border-base-200 bg-base-100 p-8 shadow-xl" data-aos="fade-up">
      <h2 class="text-lg font-bold" data-sw-text="c_form_t">Project enquiry</h2>
      {{sw-form "contact" class="mt-4"}}
    </div>
  </div>
</section>`,
  };
}
