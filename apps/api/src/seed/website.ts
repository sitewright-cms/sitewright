import { GLOBAL_SNIPPET_PARTIALS } from '@sitewright/core';
import { icon } from './helpers.js';
import { CHROME_TRANSLATIONS } from './strings.js';
import { PAGE_TRANSLATIONS } from './page-translations.js';

// ---------------------------------------------------------------- skeleton: nav, footer, motion
//
// The chrome is ONE shared source rendered per page — its UI labels localize through the dedicated
// translation catalog (`website.translations`, see strings.ts). Three forms read it:
// - `T()` emits the EDITABLE `data-sw-translate` directive (a span carrying the key + its EN fallback
//   text) → click-to-edit in the live preview, writing the GLOBAL catalog. Use for chrome TEXT labels.
// - `SL()` the bare subexpression for use inside another helper (`{{sw-url (sw-translate …)}}` — URL
//   attributes must go through sw-url).
// All resolve against the RENDERING page's locale (the projection pre-resolves website.translations →
// website.t per page-locale). Publish strips the directive marker; preview keeps it for the bridge.
const SL = (key: string): string => `(sw-translate "${key}")`;
// `fallback` is interpolated RAW into the slot HTML (the element's authored untranslated text), so it
// MUST be a plain-text literal — never a user/dynamic value (that would be an injection surface).
const T = (key: string, fallback: string): string => `<span data-sw-translate="${key}">${fallback}</span>`;

/** The shared brand mark — the Corporate-Identity icon when one is set (Settings → CI), else a
 *  gradient tile with the Northwind compass glyph. The img is decorative (the company name sits
 *  beside it), so it carries an empty alt + aria-hidden. */
const BRAND_MARK = `{{#if company.icon}}<img class="h-8 w-8 shrink-0 rounded-xl object-cover shadow-md shadow-primary/30" src="{{sw-url company.icon}}" alt="" aria-hidden="true" />{{else}}<span class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-primary via-primary to-secondary text-primary-content shadow-md shadow-primary/30">${icon('compass', 'h-4.5 w-4.5')}</span>{{/if}}`;

export const EXAMPLE_WEBSITE = {
  // Main Navigation — the platform DEFAULT (the nav-header recipe): a data-driven desktop bar +
  // a pure-CSS mobile drawer. This trilingual demo auto-shows the language dropdown; the theme
  // toggle appears because themes are on. Edit it like any slot in Website settings.
  mainNav: GLOBAL_SNIPPET_PARTIALS['nav-header'] ?? '',
  footer: `<div class="relative bg-neutral text-neutral-content">
  <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent"></div>
  <div class="mx-auto grid max-w-6xl gap-x-8 gap-y-12 px-6 py-20 sm:grid-cols-2 lg:grid-cols-6">
    <div class="sm:col-span-2">
      <p class="flex items-center gap-2.5 text-lg font-bold tracking-tight">${BRAND_MARK}{{ company.name }}</p>
      <p class="mt-4 max-w-xs text-sm leading-relaxed text-neutral-content/60">{{ company.slogan }}</p>
      <ul class="mt-6 flex list-none flex-wrap gap-2.5 p-0">{{#each company.social}}<li><a class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-content/15 text-neutral-content/60 transition hover:border-primary hover:bg-primary hover:text-primary-content" href="{{sw-url link}}" aria-label="{{name}}" target="_blank" rel="noopener">{{sw-icon icon "h-4 w-4"}}</a></li>{{/each}}</ul>
    </div>
    <div>
      <h6 class="text-sm font-semibold uppercase tracking-wider text-neutral-content/40">${T('footer_studio', 'Studio')}</h6>
      <ul class="mt-4 list-none space-y-2.5 p-0 text-sm text-neutral-content/65">{{#each nav.header}}<li><a class="no-underline transition hover:text-neutral-content {{#if (sw-active path)}}font-semibold text-neutral-content{{/if}}" href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}}{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}}</a></li>{{/each}}</ul>
    </div>
    <div>
      <h6 class="text-sm font-semibold uppercase tracking-wider text-neutral-content/40">${T('footer_legal', 'Legal')}</h6>
      <ul class="mt-4 list-none space-y-2.5 p-0 text-sm text-neutral-content/65">{{#each nav.footer}}<li><a class="no-underline transition hover:text-neutral-content {{#if (sw-active path)}}font-semibold text-neutral-content{{/if}}" href="{{sw-url path}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}}</a></li>{{/each}}{{#if website.consent.enabled}}<li>{{sw-consent-settings class="appearance-none cursor-pointer border-0 bg-transparent p-0 text-neutral-content/65 transition hover:text-neutral-content"}}</li>{{/if}}</ul>
    </div>
    <div>
      <h6 class="text-sm font-semibold uppercase tracking-wider text-neutral-content/40">${T('footer_contact', 'Contact')}</h6>
      <ul class="mt-4 list-none space-y-2.5 p-0 text-sm text-neutral-content/65">
        <!-- The mailto target is a LITERAL: the template validator only allows an interpolated
             URL attribute behind a slash/hash/https prefix (a mailto: prefix is not on that
             list) — keep this address in sync with EXAMPLE_IDENTITY.email. -->
        <li class="flex items-start gap-2.5">${icon('mail', 'mt-0.5 h-4 w-4 shrink-0 opacity-50')}<a class="break-all no-underline transition hover:text-neutral-content" href="mailto:hello@northwindstudio.com">{{ company.email }}</a></li>
        <li class="flex items-start gap-2.5">${icon('phone', 'mt-0.5 h-4 w-4 shrink-0 opacity-50')}{{ company.telephone }}</li>
        <li class="flex items-start gap-2.5">${icon('map-pin', 'mt-0.5 h-4 w-4 shrink-0 opacity-50')}{{ company.address.locality }}, {{ company.address.region }}</li>
      </ul>
    </div>
    <div>
      <h6 class="text-sm font-semibold uppercase tracking-wider text-neutral-content/40">${T('footer_news_title', 'Newsletter')}</h6>
      <p class="mt-4 text-sm leading-relaxed text-neutral-content/60">${T('footer_news', 'Occasional notes on web craft. No spam.')}</p>
      <a class="btn btn-outline mt-5" href="{{sw-url ${SL('href_contact')}}}">${T('footer_btn', 'Get in touch')}</a>
    </div>
  </div>
  <div class="border-t border-neutral-content/10">
    <p class="mx-auto max-w-6xl px-6 py-6 text-center text-xs text-neutral-content/40">© {{ company.legalName }} · ${T('footer_built', 'Built with Sitewright — code-first, instantly fast.')}</p>
  </div>
</div>`,
  // The CONSENT MANAGER banner is AUTO-INJECTED site-wide when website.consent.enabled (above) — no bottom
  // slot / {{sw-consent}} placeholder needed. Its copy localizes per page-locale from the reserved consent_*
  // catalog keys, and it gates the third-party integrations.
  // RAW slot (not validated, not escaped): CSS-only motion + the demo's design-system utilities,
  // so the site looks alive in the JS-blocked preview AND on export. Scroll-reveal sections use
  // the first-party data-aos runtime (PE: fully visible without JS); these utilities cover the
  // rest — the dark aurora field, the blueprint grid texture, card lift/zoom, the gradient ring,
  // and the nw-rise hero intro.
  criticalCss: `:root{scroll-behavior:smooth}
@keyframes nw-rise{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
@keyframes nw-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@media (prefers-reduced-motion:no-preference){
  .nw-rise{animation:nw-rise .7s cubic-bezier(.22,1,.36,1) both}
  .nw-rise-1{animation:nw-rise .7s cubic-bezier(.22,1,.36,1) .12s both}
  .nw-rise-2{animation:nw-rise .7s cubic-bezier(.22,1,.36,1) .24s both}
  .nw-float{animation:nw-float 6s ease-in-out infinite}
}
.nw-aurora{background:radial-gradient(at 18% 12%,rgba(99,102,241,.55) 0,transparent 52%),radial-gradient(at 85% 8%,rgba(14,165,233,.4) 0,transparent 50%),radial-gradient(at 62% 95%,rgba(168,85,247,.35) 0,transparent 55%),#0b0a18}
.nw-grid-bg{background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:56px 56px}
.nw-card{transition:transform .35s cubic-bezier(.22,1,.36,1),box-shadow .35s,border-color .35s}
.nw-card:hover{transform:translateY(-6px)}
.nw-zoom img{transition:transform .6s cubic-bezier(.22,1,.36,1)}
.nw-zoom:hover img{transform:scale(1.06)}
.nw-underline{background-image:linear-gradient(currentColor,currentColor);background-size:0% 2px;background-position:0 100%;background-repeat:no-repeat;transition:background-size .3s}
.nw-underline:hover{background-size:100% 2px}
.nw-ring{border:2px solid transparent;background:linear-gradient(var(--sw-color-base-100,#ffffff),var(--sw-color-base-100,#ffffff)) padding-box,linear-gradient(135deg,#6366f1,#0ea5e9) border-box}`,
  // MINI SHOP — front-end cart config for the demo Shop page. Currency + the three deep-link channels
  // (WhatsApp, email, PayPal.me payment link). The cart is front-end only and prices are
  // NON-AUTHORITATIVE — the cart submits an order inquiry; Northwind confirms + collects payment.
  // Drawer strings + the add-to-cart label auto-localize from the translation catalog (reserved cart_*
  // keys in website.translations, resolved per page-locale) — bare {{sw-cart}}/{{sw-add-to-cart}}.
  // The WhatsApp + email channels collect buyer details (`fields`) before the link opens; the cart
  // appends them as "Label: value" lines below the order (email also opens with a brand greeting).
  shop: {
    // Master switch: the example ships with the shop ON (a fresh project starts OFF — the operator opts
    // in with the "Enable shop" toggle). With this false/absent the cart helpers render nothing.
    enabled: true,
    // Currency FORMATTING only (USD is before/2 = the schema defaults → no `currency` object needed). The
    // symbol/code are translatable (catalog: cart_currency_symbol/code, seeded in strings.ts).
    // Channels carry a stable `key`; their button LABELS + the field labels live in the catalog under
    // `shop.<key>` (seeded in page-translations.ts), resolved per locale by the cart helper.
    channels: [
      {
        kind: 'whatsapp',
        key: 'whatsapp',
        number: '+14155550123',
        intro: 'Hi Northwind — I’d like to order:',
        fields: [
          { key: 'name', required: true },
          { key: 'address', type: 'textarea', required: true },
          { key: 'phone', type: 'tel' },
        ],
      },
      {
        kind: 'mailto',
        key: 'email',
        email: 'hello@northwindstudio.com',
        subject: 'Northwind merch order',
        fields: [
          { key: 'name', required: true },
          { key: 'address', type: 'textarea', required: true },
        ],
      },
      { kind: 'payment', key: 'pay', provider: 'paypal', urlTemplate: 'https://paypal.me/northwind/{total}' },
    ],
  },
  // CONSENT MANAGER — the demo enables it to showcase the feature: a cookie banner with per-category
  // preferences (auto-injected site-wide when enabled) that gates a placeholder Google Analytics tracker, and
  // derives the site Content-Security-Policy from it. The banner copy localizes from the reserved consent_*
  // keys (seeded in strings.ts, en/de/es). A fresh project starts OFF — the operator opts in.
  consent: {
    enabled: true,
    integrations: [{ id: 'analytics', name: 'Google Analytics', category: 'analytics', preset: 'ga4', measurementId: 'G-DEMO0000' }],
  },
  // A language→country map for the nav switcher's flags (sw-flag takes a COUNTRY code, not a
  // language — so en→gb). This is project DATA (a config map), not translatable text.
  data: { locale_flags: { en: 'gb', de: 'de', es: 'es' } },
  // The dedicated i18n catalog (NOT website.data): the per-locale CHROME UI strings (flat keys, read by
  // the slots via {{sw-translate "key"}} — see strings.ts) PLUS the SCOPED page-content strings the pages
  // bind via data-sw-translate="<scope>.<key>" (page-translations.ts). One table, grouped by scope.
  translations: { ...CHROME_TRANSLATIONS, ...PAGE_TRANSLATIONS },
  // Site-wide nav/button effect schemes (CI-themed, contrast-safe). The active nav item is marked
  // `.active` (below); `sw-nav-box-solid` fills it with the brand primary + its WCAG-derived foreground.
  effects: { navEffect: 'box-solid', buttonEffect: 'lift', preloaderEffect: 'logo-pulse' },
  // Opt-in light/dark themes — the flagship showcases the feature: it starts in LIGHT and the
  // {{sw-theme-toggle}} in the header (navbar-end) lets visitors switch to dark (their choice persists).
  enableThemes: true,
  defaultTheme: 'light',
};
