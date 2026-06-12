import { icon } from './helpers.js';

// ---------------------------------------------------------------- skeleton: nav, footer, motion
export const EXAMPLE_WEBSITE = {
  topNav: `<div class="navbar sticky top-0 z-30 border-b border-base-200 bg-base-100/80 px-4 backdrop-blur-xl sm:px-8">
  <div class="navbar-start">
    <a class="btn btn-ghost gap-2 px-2 text-lg font-extrabold tracking-tight" href="/">
      <span class="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-content">N</span>
      {{ company.name }}
    </a>
  </div>
  <div class="navbar-center hidden lg:flex">
    <ul class="menu menu-horizontal gap-1 px-1 font-medium">{{#each nav.header}}{{#if children}}<li class="dropdown dropdown-hover"><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}} ${icon('chevron-down', 'h-4 w-4 opacity-60')}</a><ul class="dropdown-content menu z-30 mt-1 w-52 rounded-box bg-base-100 p-2 shadow-lg">{{#each children}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}}</a></li>{{/each}}</ul></li>{{else}}<li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}"{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}}</a></li>{{/if}}{{/each}}</ul>
  </div>
  <div class="navbar-end gap-2">
    {{#if page.translations}}<div class="hidden items-center gap-0.5 rounded-lg border border-base-200 p-0.5 sm:flex" aria-label="Language">{{#each page.translations}}<a class="btn btn-ghost btn-xs gap-1.5 px-2 font-semibold uppercase" href="{{sw-url path}}" hreflang="{{locale}}">{{sw-flag (lookup @root.website.data.locale_flags locale) "h-3.5 w-5 rounded-sm"}}{{locale}}</a>{{/each}}</div>{{/if}}
    <a class="btn btn-primary btn-sm gap-1.5 shadow-lg shadow-primary/20 waves-effect waves-light" href="/contact">Start a project ${icon('arrow-right', 'h-4 w-4')}</a>
  </div>
</div>`,
  footer: `<div class="bg-neutral text-neutral-content">
  <div class="mx-auto grid max-w-6xl gap-10 px-6 py-16 sm:grid-cols-2 lg:grid-cols-4">
    <div class="sm:col-span-2 lg:col-span-1">
      <p class="flex items-center gap-2 text-lg font-extrabold"><span class="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-content">N</span>{{ company.name }}</p>
      <p class="mt-4 max-w-xs text-sm text-neutral-content/70">{{ company.slogan }}</p>
      <ul class="mt-5 flex flex-wrap gap-3">{{#each company.social}}<li><a class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-content/20 text-neutral-content/70 transition hover:border-primary hover:bg-primary hover:text-primary-content" href="{{sw-url link}}" aria-label="{{name}}" target="_blank" rel="noopener">{{sw-icon icon "h-4 w-4"}}</a></li>{{/each}}</ul>
    </div>
    <div>
      <h6 class="footer-title opacity-100">Studio</h6>
      <ul class="mt-3 space-y-2 text-sm text-neutral-content/70">{{#each nav.header}}<li><a class="transition hover:text-neutral-content {{#if (sw-active path)}}font-semibold text-neutral-content{{/if}}" href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}}{{#if (sw-active path exact=true)}} aria-current="page"{{/if}}>{{sw-label}}</a></li>{{/each}}</ul>
    </div>
    <div>
      <h6 class="footer-title opacity-100">Contact</h6>
      <ul class="mt-3 space-y-2 text-sm text-neutral-content/70">
        <li class="flex items-center gap-2">${icon('mail', 'h-4 w-4 shrink-0 opacity-60')}{{ company.email }}</li>
        <li class="flex items-center gap-2">${icon('phone', 'h-4 w-4 shrink-0 opacity-60')}{{ company.telephone }}</li>
        <li class="flex items-center gap-2">${icon('map-pin', 'h-4 w-4 shrink-0 opacity-60')}{{ company.address.locality }}, {{ company.address.region }}</li>
      </ul>
    </div>
    <div>
      <h6 class="footer-title opacity-100">Newsletter</h6>
      <p class="mt-3 text-sm text-neutral-content/70" data-sw-text="footer_news">Occasional notes on web craft. No spam.</p>
      <a class="btn btn-outline btn-sm mt-4 border-neutral-content/30 text-neutral-content hover:border-primary hover:bg-primary hover:text-primary-content" href="/contact">Get in touch</a>
    </div>
  </div>
  <div class="border-t border-neutral-content/10">
    <p class="mx-auto max-w-6xl px-6 py-5 text-center text-xs text-neutral-content/50">© {{ company.legalName }} · Built with Sitewright — code-first, instantly fast.</p>
  </div>
</div>`,
  // RAW slot (not validated, not escaped): CSS-only motion + a few polish touches so the demo
  // looks alive in the JS-blocked preview AND on export.
  criticalCss: `:root{scroll-behavior:smooth}
@keyframes nw-rise{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
@keyframes nw-pan{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes nw-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@media (prefers-reduced-motion:no-preference){
  .nw-rise{animation:nw-rise .7s cubic-bezier(.22,1,.36,1) both}
  .nw-stagger>*{animation:nw-rise .7s cubic-bezier(.22,1,.36,1) both}
  .nw-stagger>*:nth-child(2){animation-delay:.08s}
  .nw-stagger>*:nth-child(3){animation-delay:.16s}
  .nw-stagger>*:nth-child(4){animation-delay:.24s}
  .nw-stagger>*:nth-child(5){animation-delay:.32s}
  .nw-stagger>*:nth-child(6){animation-delay:.40s}
  .nw-float{animation:nw-float 6s ease-in-out infinite}
}
.nw-aurora{background:linear-gradient(120deg,#4f46e5,#0ea5e9,#a855f7,#f59e0b);background-size:300% 300%;animation:nw-pan 14s ease infinite}
.nw-card{transition:transform .35s cubic-bezier(.22,1,.36,1),box-shadow .35s}
.nw-card:hover{transform:translateY(-6px)}
.nw-zoom img{transition:transform .6s cubic-bezier(.22,1,.36,1)}
.nw-zoom:hover img{transform:scale(1.06)}
.nw-underline{background-image:linear-gradient(currentColor,currentColor);background-size:0% 2px;background-position:0 100%;background-repeat:no-repeat;transition:background-size .3s}
.nw-underline:hover{background-size:100% 2px}`,
  // MINI SHOP — front-end cart config for the demo Shop page. Currency + the three deep-link channels
  // (WhatsApp, email, PayPal.me payment link). The cart is front-end only and prices are
  // NON-AUTHORITATIVE — the cart submits an order inquiry; Northwind confirms + collects payment.
  shop: {
    currency: { code: 'USD', symbol: '$', position: 'before', decimals: 2 },
    channels: [
      { kind: 'whatsapp', number: '+14155550123', label: 'Order on WhatsApp', intro: 'Hi Northwind — I’d like to order:' },
      { kind: 'mailto', email: 'hello@northwindstudio.com', subject: 'Northwind merch order' },
      { kind: 'payment', provider: 'paypal', urlTemplate: 'https://paypal.me/northwind/{total}', label: 'Pay with PayPal' },
    ],
  },
  // A language→country map for the nav switcher's flags (sw-flag takes a COUNTRY code, not a
  // language — so en→gb). Looked up per locale: {{sw-flag (lookup website.data.locale_flags locale)}}.
  data: { locale_flags: { en: 'gb', de: 'de' } },
  // Site-wide nav/button effect schemes (CI-themed, contrast-safe). The active nav item is marked
  // `.active` (below); `sw-nav-pill` fills it with the brand primary + its WCAG-derived foreground.
  theme: { navEffect: 'pill', buttonEffect: 'lift' },
};
