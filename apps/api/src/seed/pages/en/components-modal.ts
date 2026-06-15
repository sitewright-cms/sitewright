import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- MODAL showcase (child of Components)
// The Modal component, authored in the LIGHTER form: id + data-sw-component="modal" on the <dialog>,
// opened by an <a href="#id"> trigger (no wrapper, no data-sw-part). Three live dialogs — a plain one,
// a wider one with rich content + a forced-choice close, and one wrapping the embedded contact Form —
// plus the no-JS story. Sizing is just a max-w-* class on the <dialog>. `<pre><code>` samples stay
// untranslated. (The legacy wrapper form still works; see the component catalog.)
export function pageComponentsModal(): Page {
  return {
    id: 'comp-modal',
    path: 'modal',
    title: 'Modal',
    description: 'A trigger button that opens a native dialog — focus trap, Escape, backdrop, and background inerting come free from the browser; size it with a single class.',
    parent: 'components',
    order: 4,
    data: {
      mod_intro: 'A trigger button and a native <dialog>. The browser gives you the focus trap, Escape-to-close, the dimmed ::backdrop, and inerting of the page behind it — the component just wires the open and close buttons. Size a dialog with one max-w-* class.',
      mod_close: 'Close',
      sec_basic_t: 'Modal — the defaults',
      sec_basic_d: 'A trigger and a dialog — the styled close button (top-right) is added for you. A dialog with no classes uses your site\'s background and text colours, rounded corners and comfortable padding. Escape, the close button, or a backdrop click all dismiss it.',
      mod1_open: 'What happens next?',
      mod1_title: 'What happens next?',
      mod1_body: 'After you reach out we book a short call, scope the work together, and send a fixed quote within two business days — no obligation.',
      sec_wide_t: 'A wider dialog with rich content',
      sec_wide_d: 'The same component, sized up with max-w-2xl. Utility classes on the dialog override every default — background, text, padding, radius. You can also hide the automatic close button with data-closebutton="false" and keep the modal open on a backdrop click with data-backdrop-close="false"; both are set here, so the button below is the only way out.',
      mod2_open: 'See the full process',
      mod2_title: 'How we work',
      mod2_step1: 'Discovery — we learn your goals, audience, and constraints.',
      mod2_step2: 'Design & build — weekly previews, your feedback baked in.',
      mod2_step3: 'Launch & care — we ship, measure, and keep improving.',
      sec_form_t: 'A modal that holds a form',
      sec_form_d: 'Drop the embedded contact Form straight into the dialog — it submits, validates, and shows its success message without ever leaving the page.',
      mod3_open: 'Get in touch',
      mod3_title: 'Send us a message',
      mod3_body: 'We usually reply within a day.',
      sec_nojs_t: 'Without JavaScript & global modals',
      sec_nojs_d: 'With no JS the trigger simply does nothing and the page stays fully usable — so never put essential content only inside a modal. A nav placeholder pointing at a #dialog-id can open one from the menu too.',
    },
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url page.parent.path}}">${icon('arrow-left', 'h-4 w-4')} {{page.parent.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-text="mod_intro">A trigger button and a native dialog.</p>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_basic_t">Modal — the defaults</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_basic_d">A trigger, a dialog, and a close button.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>&lt;a href="#welcome"&gt;…&lt;/a&gt;  +  &lt;dialog id="welcome" data-sw-component="modal"&gt;  (close button automatic)</code></pre>
  <div class="mt-8">
    <a href="#welcome" class="btn btn-primary" data-sw-text="mod1_open">What happens next?</a>
    <dialog id="welcome" data-sw-component="modal" data-close-label="{{page.data.mod_close}}" aria-labelledby="dlg-basic-title">
      <h2 id="dlg-basic-title" class="text-2xl font-bold tracking-tight" data-sw-text="mod1_title">What happens next?</h2>
      <p class="mt-3 leading-relaxed text-base-content/70" data-sw-text="mod1_body">We book a short call and send a fixed quote.</p>
    </dialog>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_wide_t">A wider dialog with rich content</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_wide_d">The same component, sized up with max-w-2xl.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>&lt;dialog id="process" data-sw-component="modal" data-closebutton="false" data-backdrop-close="false"&gt;  +  data-sw-part="close"</code></pre>
  <a href="#process" class="btn btn-outline mt-8" data-sw-text="mod2_open">See the full process</a>
  <dialog id="process" data-sw-component="modal" data-closebutton="false" data-backdrop-close="false" class="max-w-2xl rounded-3xl p-10" aria-labelledby="dlg-wide-title">
    <h2 id="dlg-wide-title" class="text-2xl font-bold tracking-tight" data-sw-text="mod2_title">How we work</h2>
    <ol class="mt-6 space-y-4">
      <li class="flex items-start gap-3"><span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">1</span><span class="text-base-content/70" data-sw-text="mod2_step1">Discovery.</span></li>
      <li class="flex items-start gap-3"><span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">2</span><span class="text-base-content/70" data-sw-text="mod2_step2">Design &amp; build.</span></li>
      <li class="flex items-start gap-3"><span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">3</span><span class="text-base-content/70" data-sw-text="mod2_step3">Launch &amp; care.</span></li>
    </ol>
    <button type="button" data-sw-part="close" class="btn btn-primary mt-8" data-sw-text="mod_close">Close</button>
  </dialog>
</section>

<section class="mx-auto max-w-6xl px-6 pb-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_form_t">A modal that holds a form</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_form_d">Drop the embedded contact Form straight into the dialog.</p>
  <pre class="mt-3 inline-block max-w-full overflow-x-auto text-xs"><code>&lt;dialog id="enquiry" data-sw-component="modal"&gt; &#123;&#123;sw-form "contact"&#125;&#125; &lt;/dialog&gt;</code></pre>
  <div class="mt-8">
    <a href="#enquiry" class="btn btn-primary" data-sw-text="mod3_open">Get in touch</a>
    <dialog id="enquiry" data-sw-component="modal" data-close-label="{{page.data.mod_close}}" class="max-w-lg rounded-3xl p-8" aria-labelledby="dlg-form-title">
      <h2 id="dlg-form-title" class="text-2xl font-bold tracking-tight" data-sw-text="mod3_title">Send us a message</h2>
      <p class="mt-2 text-sm text-base-content/60" data-sw-text="mod3_body">We usually reply within a day.</p>
      <div class="mt-6">{{sw-form "contact"}}</div>
    </dialog>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-28">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="sec_nojs_t">Without JavaScript &amp; global modals</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-text="sec_nojs_d">With no JS the trigger does nothing and the page stays usable — never put essential content only inside a modal.</p>
</section>`,
  };
}
