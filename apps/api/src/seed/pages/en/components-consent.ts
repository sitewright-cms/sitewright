import type { Page } from '@sitewright/schema';
import { icon } from '../../helpers.js';

// ---------------------------------------------------------------- CONSENT MANAGER showcase (child of Components)
// The Consent Manager (website.consent) helps a site meet GDPR (Art. 6/7 — a lawful basis + freely-given,
// informed consent) and the ePrivacy "Cookie Law" (Art. 5(3) — PRIOR consent before storing/reading cookies
// or trackers on a device). It auto-injects the banner site-wide, BLOCKS third-party embeds + scripts by
// category until the visitor consents, and derives the per-page CSP. This page proves it with a REAL YouTube
// embed that stays held (zero requests to Google, zero cookies) until you allow it, a re-open button, and a
// test recipe. The example project already has consent enabled, so the iframe below is auto-gated.
export function pageComponentsConsent(): Page {
  return {
    id: 'comp-consent',
    path: 'consent',
    title: 'Consent manager',
    description:
      'GDPR / ePrivacy consent for third-party content: a real YouTube embed is BLOCKED (no request to Google, no cookies) until the visitor gives prior, informed, granular consent. The Consent Manager auto-injects the banner, gates embeds + scripts by category, and derives the per-page CSP.',
    parent: 'components',
    order: 6, // right after Banner (both are site notices); forms→7, datetimepicker→8 to make room
    data: {}, // translation-only page — the copy lives in website.translations (comp_consent.* in page-translations.ts)
    source: `<section class="mx-auto max-w-6xl px-6 pb-8 pt-24">
  <a class="nw-underline inline-flex items-center gap-1.5 text-sm font-semibold text-primary no-underline" href="{{sw-url page.parent.path}}">${icon('arrow-left', 'h-4 w-4')} {{page.parent.title}}</a>
  <h1 class="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{{page.title}}</h1>
  <p class="mt-5 max-w-2xl text-lg leading-relaxed text-base-content/60" data-sw-translate="comp_consent.cn_intro">The Consent Manager helps you meet GDPR and the ePrivacy "Cookie Law": third-party embeds + scripts are blocked until the visitor gives prior, informed, granular consent by category.</p>
</section>

<section class="mx-auto max-w-6xl px-6 pb-16">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_consent.sec_embed_t">A gated YouTube embed</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_consent.sec_embed_d">The video is held until you allow it — no request to YouTube, no cookies, until consent.</p>
  <div class="mt-8 max-w-2xl">
    {{!-- A real YouTube embed; loading="lazy" is omitted on purpose — the gate strips src until consent, so it would be inert. --}}
    <iframe src="https://www.youtube.com/embed/jNQXAC9IVRw" data-sw-consent="marketing" title="Me at the zoo — the first video on YouTube (2005)" class="aspect-video w-full rounded-xl border border-base-200 shadow-sm" allow="fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 pb-16">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_consent.cn_reopen_t">Change your mind any time</h2>
  <p class="mt-2 max-w-2xl leading-relaxed text-base-content/60" data-sw-translate="comp_consent.cn_reopen_d">GDPR requires that withdrawing consent be as easy as giving it.</p>
  <a class="btn btn-primary mt-6" href="#sw-consent"><span data-sw-translate="comp_consent.cn_reopen_btn">Cookie settings</span></a>
</section>

<section class="mx-auto max-w-6xl px-6 pb-28">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-translate="comp_consent.sec_test_t">How to test it</h2>
  <ol class="mt-6 max-w-2xl list-decimal space-y-4 pl-6 leading-relaxed text-base-content/70 marker:font-semibold marker:text-primary">
    <li data-sw-translate="comp_consent.cn_test_1">First visit: the video is held. Open the Network panel and reload — zero requests to youtube.com and no cookies until consent.</li>
    <li data-sw-translate="comp_consent.cn_test_2">Allow it: "Allow once" / "Always allow" on the placeholder, or "Accept all" in the banner. It is in the Marketing category, so accepting only Functional keeps it held.</li>
    <li data-sw-translate="comp_consent.cn_test_3">Withdraw: open "Cookie settings", choose "Reject all", reload — the video is held again.</li>
  </ol>
</section>`,
  };
}
