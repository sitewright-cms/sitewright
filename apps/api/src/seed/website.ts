import { icon } from './helpers.js';
import { CHROME_STRINGS } from './strings.js';

// ---------------------------------------------------------------- skeleton: nav, footer, motion
//
// The chrome is ONE shared source rendered per page — its UI labels localize through the
// `website.data.strings` double-lookup (see strings.ts). `S()` emits the lookup interpolation,
// `SL()` the bare subexpression for use inside another helper (e.g. `{{sw-url (lookup …)}}` —
// URL attributes must go through sw-url). Both resolve against the RENDERING page's locale.
const SL = (key: string): string => `(lookup (lookup @root.website.data.strings @root.page.locale) '${key}')`;
const S = (key: string): string => `{{lookup (lookup @root.website.data.strings @root.page.locale) '${key}'}}`;

/** The shared brand mark — a gradient tile with the Northwind compass-N cut as pure CSS borders. */
const BRAND_MARK = `<span class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-primary via-primary to-secondary text-primary-content shadow-md shadow-primary/30">${icon('compass', 'h-4.5 w-4.5')}</span>`;

export const EXAMPLE_WEBSITE = {
  // Desktop header (≥lg) — the mobile slot below covers smaller screens.
  topNav: `<div class="navbar sticky top-0 z-30 hidden border-b border-base-200/70 bg-base-100/70 px-4 backdrop-blur-xl lg:flex sm:px-8">
  <div class="navbar-start">
    <a class="btn btn-ghost gap-2.5 px-2 text-lg font-bold tracking-tight" href="{{sw-url ${SL('href_home')}}}">
      ${BRAND_MARK}
      {{ company.name }}
    </a>
  </div>
  <div class="navbar-center">
    <ul class="menu menu-horizontal gap-1 px-1 font-medium">{{#each nav.header}}{{#if children}}<li class="dropdown dropdown-hover"><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}} ${icon('chevron-down', 'h-4 w-4 opacity-60')}</a><ul class="dropdown-content menu z-30 w-52 rounded-2xl border border-base-200/70 bg-base-100/95 p-2 shadow-xl backdrop-blur-xl">{{#each children}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}}</a></li>{{/each}}</ul></li>{{else}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}}</a></li>{{/if}}{{/each}}</ul>
  </div>
  <div class="navbar-end gap-2.5">
    {{#if page.translations}}<div class="flex items-center gap-0.5 rounded-full bg-base-200/70 p-0.5" aria-label="${S('aria_language')}">{{#each page.translations}}<a class="btn btn-ghost btn-xs gap-1.5 rounded-full px-2 font-semibold uppercase" href="{{sw-url path}}" hreflang="{{locale}}">{{sw-flag (lookup @root.website.data.locale_flags locale) "h-3.5 w-5 rounded-sm"}}{{locale}}</a>{{/each}}</div>{{/if}}
    <a class="btn btn-primary btn-sm gap-1.5 rounded-full px-4 shadow-lg shadow-primary/25 waves-effect waves-light" href="{{sw-url ${SL('href_contact')}}}">${S('nav_cta')} ${icon('arrow-right', 'h-4 w-4')}</a>
  </div>
</div>`,
  // Mobile header (<lg) — its own skeleton slot. The menu is a NATIVE <details> dropdown
  // (CSS/HTML only, so it works in the script-blocked editor preview AND with JS disabled),
  // listing the same per-locale auto-nav the desktop header uses.
  mobileNav: `<div class="navbar sticky top-0 z-30 border-b border-base-200/70 bg-base-100/85 px-3 backdrop-blur-xl lg:hidden">
  <div class="navbar-start gap-1">
    <details class="dropdown">
      <summary class="btn btn-ghost btn-square" aria-label="${S('mobile_menu')}">${icon('menu', 'h-6 w-6')}</summary>
      <ul class="menu dropdown-content z-30 mt-2 w-64 rounded-2xl border border-base-200/70 bg-base-100/95 p-2 shadow-2xl backdrop-blur-xl">
        {{#each nav.header}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}}</a>{{#if children}}<ul>{{#each children}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}}</a></li>{{/each}}</ul>{{/if}}</li>{{/each}}
        {{#if page.translations}}<li class="mt-1 border-t border-base-200 pt-2"><div class="flex gap-1 px-1" aria-label="${S('aria_language')}">{{#each page.translations}}<a class="btn btn-ghost btn-xs gap-1.5 rounded-full px-2 font-semibold uppercase" href="{{sw-url path}}" hreflang="{{locale}}">{{sw-flag (lookup @root.website.data.locale_flags locale) "h-3.5 w-5 rounded-sm"}}{{locale}}</a>{{/each}}</div></li>{{/if}}
      </ul>
    </details>
    <a class="btn btn-ghost gap-2 px-2 text-lg font-bold tracking-tight" href="{{sw-url ${SL('href_home')}}}">
      ${BRAND_MARK}
      {{ company.shortName }}
    </a>
  </div>
  <div class="navbar-end">
    <a class="btn btn-primary btn-sm gap-1.5 rounded-full px-4 waves-effect waves-light" href="{{sw-url ${SL('href_contact')}}}">${S('nav_cta')}</a>
  </div>
</div>`,
  footer: `<div class="relative bg-neutral text-neutral-content">
  <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent"></div>
  <div class="mx-auto grid max-w-6xl gap-x-8 gap-y-12 px-6 py-20 sm:grid-cols-2 lg:grid-cols-6">
    <div class="sm:col-span-2">
      <p class="flex items-center gap-2.5 text-lg font-bold tracking-tight">${BRAND_MARK}{{ company.name }}</p>
      <p class="mt-4 max-w-xs text-sm leading-relaxed text-neutral-content/60">{{ company.slogan }}</p>
      <ul class="mt-6 flex list-none flex-wrap gap-2.5 p-0">{{#each company.social}}<li><a class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-content/15 text-neutral-content/60 transition hover:border-primary hover:bg-primary hover:text-primary-content" href="{{sw-url link}}" aria-label="{{name}}" target="_blank" rel="noopener">{{sw-icon icon "h-4 w-4"}}</a></li>{{/each}}</ul>
    </div>
    <div>
      <h6 class="text-sm font-semibold uppercase tracking-wider text-neutral-content/40">${S('footer_studio')}</h6>
      <ul class="mt-4 list-none space-y-2.5 p-0 text-sm text-neutral-content/65">{{#each nav.header}}<li><a class="no-underline transition hover:text-neutral-content {{#if (sw-active path)}}font-semibold text-neutral-content{{/if}}" href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}}{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}}</a></li>{{/each}}</ul>
    </div>
    <div>
      <h6 class="text-sm font-semibold uppercase tracking-wider text-neutral-content/40">${S('footer_legal')}</h6>
      <ul class="mt-4 list-none space-y-2.5 p-0 text-sm text-neutral-content/65">{{#each nav.footer}}<li><a class="no-underline transition hover:text-neutral-content {{#if (sw-active path)}}font-semibold text-neutral-content{{/if}}" href="{{sw-url path}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}}</a></li>{{/each}}</ul>
    </div>
    <div>
      <h6 class="text-sm font-semibold uppercase tracking-wider text-neutral-content/40">${S('footer_contact')}</h6>
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
      <h6 class="text-sm font-semibold uppercase tracking-wider text-neutral-content/40">${S('footer_news_title')}</h6>
      <p class="mt-4 text-sm leading-relaxed text-neutral-content/60">${S('footer_news')}</p>
      <a class="btn btn-outline btn-sm mt-5 rounded-full border-neutral-content/25 text-neutral-content hover:border-primary hover:bg-primary hover:text-primary-content" href="{{sw-url ${SL('href_contact')}}}">${S('footer_btn')}</a>
    </div>
  </div>
  <div class="border-t border-neutral-content/10">
    <p class="mx-auto max-w-6xl px-6 py-6 text-center text-xs text-neutral-content/40">© {{ company.legalName }} · ${S('footer_built')}</p>
  </div>
</div>`,
  // Site-wide bottom slot: the COOKIE-CONSENT banner (first-party component — localStorage state;
  // server HTML ships it `hidden` and the runtime reveals it only without prior consent, so a
  // no-JS visitor or the sandboxed preview never sees a stuck banner). The component's own CSS
  // positions/styles it; the copy localizes via the strings lookup.
  bottom: `<div data-sw-component="cookie-consent" data-sw-block="CookieConsent" hidden>
  <p>${S('cookie_text')} <a class="link" href="{{sw-url ${SL('href_privacy')}}}">${S('cookie_more')}</a></p>
  <button type="button" data-sw-part="accept">${S('cookie_accept')}</button>
</div>`,
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
  // Drawer strings localize per page via {{sw-cart}} hash overrides fed from page.data (shop page).
  // The WhatsApp + email channels collect buyer details (`fields`) before the link opens; the cart
  // appends them as "Label: value" lines below the order (email also opens with a brand greeting).
  shop: {
    currency: { code: 'USD', symbol: '$', position: 'before', decimals: 2 },
    channels: [
      {
        kind: 'whatsapp',
        number: '+14155550123',
        label: 'Order on WhatsApp',
        intro: 'Hi Northwind — I’d like to order:',
        fields: [
          { label: 'Your name', required: true },
          { label: 'Delivery address', type: 'textarea', required: true },
          { label: 'Phone', type: 'tel' },
        ],
      },
      {
        kind: 'mailto',
        email: 'hello@northwindstudio.com',
        subject: 'Northwind merch order',
        fields: [
          { label: 'Your name', required: true },
          { label: 'Delivery address', type: 'textarea', required: true },
        ],
      },
      { kind: 'payment', provider: 'paypal', urlTemplate: 'https://paypal.me/northwind/{total}', label: 'Pay with PayPal' },
    ],
  },
  // A language→country map for the nav switcher's flags (sw-flag takes a COUNTRY code, not a
  // language — so en→gb), plus the per-locale chrome strings (see strings.ts).
  data: { locale_flags: { en: 'gb', de: 'de', es: 'es' }, strings: CHROME_STRINGS },
  // Site-wide nav/button effect schemes (CI-themed, contrast-safe). The active nav item is marked
  // `.active` (below); `sw-nav-pill` fills it with the brand primary + its WCAG-derived foreground.
  theme: { navEffect: 'pill', buttonEffect: 'lift' },
};
