import type { Page, Dataset, Entry, Form } from '@sitewright/schema';
import { iconBody } from '@sitewright/blocks';

/**
 * Inline one of the platform's built-in icons (the curated Lucide set in `@sitewright/blocks`) as
 * an SVG, matching the `Icon` block's wrapper so code-first pages share the same icon vocabulary.
 * `cls` controls the size/color (Tailwind, e.g. `h-5 w-5 text-primary`). Unknown names render
 * nothing. The markup is a build-time constant (no interpolation) so it passes the no-JS validator.
 */
function icon(name: string, cls: string): string {
  const body = iconBody(name);
  if (!body) return '';
  return (
    `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
  );
}

/** Five filled stars — a rating row, built from the icon set. */
const STARS = Array.from({ length: 5 }, () => icon('star', 'h-4 w-4 fill-current')).join('');

/**
 * Content for the seeded demo project — "Northwind Web Studio", a complete, realistic corporate
 * site that exercises the whole platform: a themed Corporate Identity, the shared skeleton
 * (sticky navbar + rich footer with the auto-menu), CSS-driven motion, four CMS datasets
 * (services / work / team / testimonials) bound into code-first DaisyUI pages, client-editable
 * `data-sw-text` regions (→ page.data), real imagery, and a working contact form. It is deliberately polished so an
 * operator immediately sees what a finished Sitewright site looks like — then deletes it.
 *
 * Constraints honored so it renders identically in the in-container `/sites/<slug>/` preview AND
 * on an exported static host:
 *   - Motion is CSS-only (the preview CSP blocks inline JS); images are LOCAL media assets
 *     (generated + filed into folders by seed-assets.ts) referenced via `/media/...` URLs that
 *     publish rewrites to `_assets/...` — no remote image hosts.
 *   - Page bodies pass the no-JS template validator (values only in text / quoted attrs; the
 *     `{{sw-url …}}` helper for interpolated src/href).
 */

// ---------------------------------------------------------------- corporate identity
export const EXAMPLE_IDENTITY = {
  name: 'Northwind Web Studio',
  legalName: 'Northwind Web Studio Ltd.',
  shortName: 'Northwind',
  slogan: 'Websites that mean business.',
  description:
    'A boutique web studio that designs and builds fast, beautiful, conversion-focused websites for ambitious brands.',
  businessType: 'ProfessionalService',
  email: 'hello@northwindstudio.com',
  telephone: '+1 (415) 555-0142',
  address: {
    street: '548 Market Street, Suite 200',
    locality: 'San Francisco',
    region: 'CA',
    country: 'USA',
    postalCode: '94104',
  },
  social: [
    { link: 'https://twitter.com/northwindstudio', name: 'X', icon: 'brand:x' },
    { link: 'https://www.linkedin.com/company/northwindstudio', name: 'LinkedIn', icon: 'linkedin' },
    { link: 'https://dribbble.com/northwindstudio', name: 'Dribbble', icon: 'brand:dribbble' },
  ],
  // The six mandatory brand tokens → DaisyUI/Tailwind theme colors (the -content foregrounds are
  // auto-derived for contrast). `base-100`/`base-content` are the page Background/Text colors.
  colors: {
    primary: '#4f46e5',
    secondary: '#0ea5e9',
    accent: '#f59e0b',
    neutral: '#171627',
    'base-100': '#ffffff',
    'base-content': '#1a1a23',
  },
} as const;

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
    <ul class="menu menu-horizontal gap-1 px-1 font-medium">{{#each nav.header}}{{#if children}}<li class="dropdown dropdown-hover"><a href="{{sw-url path}}">{{label}} ${icon('chevron-down', 'h-4 w-4 opacity-60')}</a><ul class="dropdown-content menu z-30 mt-1 w-52 rounded-box bg-base-100 p-2 shadow-lg">{{#each children}}<li><a href="{{sw-url path}}">{{label}}</a></li>{{/each}}</ul></li>{{else}}<li><a href="{{sw-url path}}">{{label}}</a></li>{{/if}}{{/each}}</ul>
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
      <ul class="mt-3 space-y-2 text-sm text-neutral-content/70">{{#each nav.header}}<li><a class="hover:text-neutral-content" href="{{sw-url path}}">{{label}}</a></li>{{/each}}</ul>
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
};

// ---------------------------------------------------------------- datasets (the CMS)
export const EXAMPLE_DATASETS: Dataset[] = [
  {
    id: 'services',
    name: 'Services',
    slug: 'services',
    fields: [
      { name: 'icon', type: 'text', required: false, localized: false },
      { name: 'title', type: 'text', required: true, localized: false },
      { name: 'summary', type: 'text', required: false, localized: false },
      { name: 'price', type: 'text', required: false, localized: false },
    ],
  },
  {
    // German variant of `services` (auto-resolved for locale "de" pages via the
    // `<slug>-<locale>` convention — see docs/i18n-content-model.md).
    id: 'services-de',
    name: 'Leistungen (DE)',
    slug: 'services-de',
    fields: [
      { name: 'icon', type: 'text', required: false, localized: false },
      { name: 'title', type: 'text', required: true, localized: false },
      { name: 'summary', type: 'text', required: false, localized: false },
      { name: 'price', type: 'text', required: false, localized: false },
    ],
  },
  {
    id: 'projects',
    name: 'Work',
    slug: 'projects',
    fields: [
      { name: 'title', type: 'text', required: true, localized: false },
      { name: 'client', type: 'text', required: false, localized: false },
      { name: 'category', type: 'text', required: false, localized: false },
      { name: 'summary', type: 'text', required: false, localized: false },
      { name: 'image', type: 'image', required: false, localized: false },
      { name: 'year', type: 'text', required: false, localized: false },
    ],
  },
  {
    id: 'team',
    name: 'Team',
    slug: 'team',
    fields: [
      { name: 'name', type: 'text', required: true, localized: false },
      { name: 'role', type: 'text', required: false, localized: false },
      { name: 'photo', type: 'image', required: false, localized: false },
      { name: 'bio', type: 'text', required: false, localized: false },
    ],
  },
  {
    id: 'testimonials',
    name: 'Testimonials',
    slug: 'testimonials',
    fields: [
      { name: 'quote', type: 'text', required: true, localized: false },
      { name: 'author', type: 'text', required: false, localized: false },
      { name: 'role', type: 'text', required: false, localized: false },
    ],
  },
  {
    // MINI SHOP catalogue — products the front-end cart adds by `sku`. `price` is a number; the
    // cart formats it with the currency in website.shop (display-only, non-authoritative).
    id: 'products',
    name: 'Products',
    slug: 'products',
    fields: [
      { name: 'sku', type: 'text', required: false, localized: false },
      { name: 'name', type: 'text', required: true, localized: false },
      { name: 'price', type: 'number', required: false, localized: false },
      { name: 'image', type: 'image', required: false, localized: false },
      { name: 'description', type: 'text', required: false, localized: false },
    ],
  },
];

const pub = (dataset: string, id: string, values: Record<string, unknown>): Entry => ({
  id,
  dataset,
  status: 'published',
  values,
});

export function exampleEntries(assetMap: Record<string, string>): Entry[] {
  // Missing keys → '' (e.g. unit tests that seed without generating images) so no field ever
  // becomes the literal string "undefined".
  const assets = new Proxy(assetMap, {
    // Named string keys → the URL or '' (so a missing image is never the literal "undefined");
    // symbol keys (coercion/inspection) pass straight through to the target.
    get: (t, k) => (typeof k === 'symbol' ? Reflect.get(t, k) : k in t ? Reflect.get(t, k) : ''),
  }) as Record<string, string>;
  return [
  // --- services ---
  pub('services', 'svc-strategy', { icon: '🧭', title: 'Strategy & UX', summary: 'Research, positioning, and user journeys that turn visitors into customers.', price: 'from $4k' }),
  pub('services', 'svc-design', { icon: '🎨', title: 'Web Design', summary: 'Distinctive, on-brand interfaces designed pixel-perfect for every screen.', price: 'from $8k' }),
  pub('services', 'svc-build', { icon: '⚡', title: 'Development', summary: 'Hand-built, lightning-fast static sites with top Lighthouse scores.', price: 'from $10k' }),
  pub('services', 'svc-brand', { icon: '✨', title: 'Brand Identity', summary: 'Logos, type systems, and visual languages that scale across every touchpoint.', price: 'from $6k' }),
  pub('services', 'svc-seo', { icon: '📈', title: 'SEO & Performance', summary: 'Technical SEO, Core Web Vitals, and analytics wired in from day one.', price: 'from $3k' }),
  pub('services', 'svc-care', { icon: '🛟', title: 'Care Plans', summary: 'Ongoing edits, monitoring, and improvements so your site keeps earning.', price: '$450/mo' }),
  // --- services-de (German variant; auto-resolved on /de pages via `data.services`) ---
  pub('services-de', 'svc-strategy-de', { icon: '🧭', title: 'Strategie & UX', summary: 'Recherche, Positionierung und Nutzerführung, die Besucher zu Kunden machen.', price: 'ab 4.000 €' }),
  pub('services-de', 'svc-design-de', { icon: '🎨', title: 'Webdesign', summary: 'Unverwechselbare, markengerechte Oberflächen – pixelgenau für jedes Display.', price: 'ab 8.000 €' }),
  pub('services-de', 'svc-build-de', { icon: '⚡', title: 'Entwicklung', summary: 'Handgebaute, blitzschnelle statische Websites mit Top-Lighthouse-Werten.', price: 'ab 10.000 €' }),
  pub('services-de', 'svc-brand-de', { icon: '✨', title: 'Markenidentität', summary: 'Logos, Schriftsysteme und Bildsprachen, die über jeden Kanal skalieren.', price: 'ab 6.000 €' }),
  pub('services-de', 'svc-seo-de', { icon: '📈', title: 'SEO & Performance', summary: 'Technisches SEO, Core Web Vitals und Analytics – von Tag eins verdrahtet.', price: 'ab 3.000 €' }),
  pub('services-de', 'svc-care-de', { icon: '🛟', title: 'Wartungspakete', summary: 'Laufende Pflege, Monitoring und Verbesserungen, damit Ihre Website weiter liefert.', price: '450 €/Monat' }),
  // --- projects / work (images are LOCAL assets, seeded into the Projects/ media folder) ---
  pub('projects', 'proj-harbor', { title: 'Harbor & Co.', client: 'Harbor Coffee Roasters', category: 'E-commerce', summary: 'A flavour-led storefront that lifted online orders by 38%.', image: assets['proj-harbor'], year: '2025' }),
  pub('projects', 'proj-vela', { title: 'Vela Health', client: 'Vela', category: 'Healthcare', summary: 'A calm, accessible patient portal and marketing site.', image: assets['proj-vela'], year: '2025' }),
  pub('projects', 'proj-lumen', { title: 'Lumen Capital', client: 'Lumen', category: 'Finance', summary: 'A trustworthy, data-rich site for a boutique investment firm.', image: assets['proj-lumen'], year: '2024' }),
  pub('projects', 'proj-terra', { title: 'Terra Studio', client: 'Terra Architects', category: 'Portfolio', summary: 'An immersive, image-first showcase for an award-winning practice.', image: assets['proj-terra'], year: '2024' }),
  pub('projects', 'proj-flint', { title: 'Flint & Steel', client: 'Flint BBQ', category: 'Hospitality', summary: 'A mouth-watering site with online booking for a fast-growing chain.', image: assets['proj-flint'], year: '2024' }),
  pub('projects', 'proj-aria', { title: 'Aria Festival', client: 'Aria', category: 'Events', summary: 'A bold, high-energy festival site built to survive launch-day traffic.', image: assets['proj-aria'], year: '2023' }),
  // --- team ---
  pub('team', 'team-mara', { name: 'Mara Whitfield', role: 'Founder & Design Director', photo: assets['team-mara'], bio: 'Twelve years shaping brands for studios and startups.' }),
  pub('team', 'team-dev', { name: 'Devon Park', role: 'Lead Engineer', photo: assets['team-devon'], bio: 'Performance obsessive; ships sites that score 100.' }),
  pub('team', 'team-ines', { name: 'Inés Romero', role: 'UX Strategist', photo: assets['team-ines'], bio: 'Turns fuzzy goals into journeys that convert.' }),
  pub('team', 'team-sol', { name: 'Sol Nakamura', role: 'Brand Designer', photo: assets['team-sol'], bio: 'Builds type systems and logos with staying power.' }),
  // --- testimonials ---
  pub('testimonials', 'tst-1', { quote: 'Northwind rebuilt our site in six weeks and our enquiries doubled. They are the rare studio that gets both design and engineering right.', author: 'Priya Anand', role: 'CEO, Harbor Coffee' }),
  pub('testimonials', 'tst-2', { quote: 'The fastest, most thoughtful team we have worked with. Our Lighthouse scores went from the 40s to a perfect 100.', author: 'Marcus Lee', role: 'CMO, Lumen Capital' }),
  pub('testimonials', 'tst-3', { quote: 'They treated our brand like their own. The new site finally looks like the company we are becoming.', author: 'Elena Fischer', role: 'Founder, Terra Architects' }),
  // --- products (MINI SHOP demo: studio merch; `price` is a number, the cart formats it) ---
  pub('products', 'prod-tee', { sku: 'TEE-01', name: 'Studio Tee', price: 29, image: assets['proj-aria'], description: 'Soft heavyweight cotton tee with a subtle Northwind mark.' }),
  pub('products', 'prod-mug', { sku: 'MUG-01', name: 'Ceramic Mug', price: 14, image: assets['proj-flint'], description: 'A 12oz mug for late-night deploys.' }),
  pub('products', 'prod-notebook', { sku: 'NB-01', name: 'Dot-grid Notebook', price: 18, image: assets['proj-terra'], description: 'Lay-flat A5 notebook for sketching layouts.' }),
  pub('products', 'prod-poster', { sku: 'POS-01', name: 'Type Poster', price: 35, image: assets['proj-vela'], description: 'Risograph type-specimen print, A2.' }),
  pub('products', 'prod-stickers', { sku: 'STK-01', name: 'Sticker Pack', price: 8, image: assets['proj-harbor'], description: 'Six die-cut vinyl stickers for your laptop.' }),
  pub('products', 'prod-cap', { sku: 'CAP-01', name: 'Dad Cap', price: 24, image: assets['proj-lumen'], description: 'Low-profile six-panel cap with an embroidered mark.' }),
  ];
}

// ---------------------------------------------------------------- contact form
export const EXAMPLE_FORMS: Form[] = [
  {
    id: 'contact',
    name: 'Project enquiry',
    fields: [
      { name: 'name', label: 'Your name', type: 'text', required: true, placeholder: 'Jane Doe' },
      { name: 'email', label: 'Email', type: 'email', required: true, placeholder: 'jane@company.com' },
      { name: 'company', label: 'Company', type: 'text', required: false, placeholder: 'Acme Inc.' },
      { name: 'budget', label: 'Budget', type: 'select', required: false, options: ['Under $10k', '$10k – $25k', '$25k – $50k', '$50k+'] },
      { name: 'message', label: 'Tell us about your project', type: 'textarea', required: true, placeholder: 'What are you trying to achieve?' },
    ],
    submitLabel: 'Send enquiry',
    successMessage: 'Thanks — we’ve got your enquiry and will reply within one business day.',
    errorMessage: 'Sorry, that didn’t go through. Please email us at hello@northwindstudio.com.',
    recipient: 'hello@northwindstudio.com',
    mode: 'globalSmtp',
    hcaptcha: false,
  },
];

// ---------------------------------------------------------------- pages
const placeholderRoot = { id: 'root', type: 'Section' as const };

export function examplePages(assetMap: Record<string, string>): Page[] {
  // Missing keys → '' so an unreferenced image never renders as `src="undefined"`.
  const assets = new Proxy(assetMap, {
    // Named string keys → the URL or '' (so a missing image is never the literal "undefined");
    // symbol keys (coercion/inspection) pass straight through to the target.
    get: (t, k) => (typeof k === 'symbol' ? Reflect.get(t, k) : k in t ? Reflect.get(t, k) : ''),
  }) as Record<string, string>;
  return [
  // ---------------------------------------------------------------- HOME
  {
    id: 'home',
    path: '',
    title: 'Northwind Web Studio — Websites that mean business',
    root: placeholderRoot,
    nav: { title: 'Home', slots: ['header'], order: 1 },
    // Linked to its German variant (`home-de`) for hreflang + the language switcher.
    translationGroup: 'home',
    source: `<section class="nw-aurora text-white">
  <div class="mx-auto grid max-w-6xl items-center gap-10 px-6 py-24 lg:grid-cols-2 lg:py-32">
    <div class="nw-rise">
      <span class="badge badge-lg border-white/30 bg-white/10 text-white" data-sw-text="hero_eyebrow">Boutique web studio · San Francisco</span>
      <h1 class="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl" data-sw-text="hero_title">Websites that win you more business.</h1>
      <p class="mt-6 max-w-md text-lg text-white/80" data-sw-text="hero_sub">We design and build fast, beautiful sites for ambitious brands — strategy, design, and engineering under one roof.</p>
      <div class="mt-8 flex flex-wrap gap-3">
        <a class="btn btn-lg gap-2 border-0 bg-white text-primary shadow-xl hover:bg-white/90 waves-effect" href="/contact"><span data-sw-text="hero_cta">Start a project</span> ${icon('arrow-right', 'h-5 w-5')}</a>
        <a class="btn btn-lg btn-ghost gap-2 border-white/40 text-white hover:bg-white/10 waves-effect waves-light" href="/work">See our work ${icon('arrow-up-right', 'h-5 w-5')}</a>
      </div>
    </div>
    <div class="nw-float hidden lg:block">
      <div class="overflow-hidden rounded-3xl border border-white/20 shadow-2xl nw-zoom">
        <!-- Lazy-loaded: the URL lives in data-src (no class needed) → the runtime swaps it to src on scroll-in, with a blur-up fade. -->
        <img class="h-full w-full object-cover" data-src="${assets.hero}" alt="A recent Northwind website" />
      </div>
    </div>
  </div>
</section>

<section class="border-y border-base-200 bg-base-100">
  <dl class="nw-stagger mx-auto grid max-w-5xl grid-cols-2 gap-6 px-6 py-12 text-center md:grid-cols-4">
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat1_n">120+</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat1_l">Sites shipped</dd></div>
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat2_n">9</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat2_l">Years in business</dd></div>
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat3_n">100</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat3_l">Avg. Lighthouse score</dd></div>
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat4_n">38%</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat4_l">Avg. lift in enquiries</dd></div>
  </dl>
</section>

<section class="mx-auto max-w-6xl px-6 pt-20">
  <div class="grid gap-10 lg:grid-cols-2 lg:items-center">
    <div>
      <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="why_eyebrow">Why Northwind</span>
      <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="why_title">Senior people, no hand-offs, no surprises</h2>
      <p class="mt-4 text-base-content/60" data-sw-text="why_sub">You work directly with the designers and engineers building your site — start to finish.</p>
    </div>
    <ul class="nw-stagger grid gap-3 sm:grid-cols-2">
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80" data-sw-text="why1">Fixed scope &amp; timeline</span></li>
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80" data-sw-text="why2">Perfect Lighthouse scores</span></li>
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80" data-sw-text="why3">You can edit the content yourself</span></li>
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80" data-sw-text="why4">Accessible &amp; SEO-ready</span></li>
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80" data-sw-text="why5">Hosting-friendly static export</span></li>
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80" data-sw-text="why6">Ongoing care plans</span></li>
    </ul>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 py-20">
  <div class="max-w-2xl">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="svc_title">Everything you need under one roof</h2>
    <p class="mt-3 text-base-content/60" data-sw-text="svc_sub">Strategy, design, and engineering — no hand-offs, no agencies-of-agencies.</p>
  </div>
  <div class="nw-stagger mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {{#each data.services}}
    <div class="card nw-card border border-base-200 bg-base-100 shadow-sm hover:shadow-xl">
      <div class="card-body">
        <div class="text-3xl">{{icon}}</div>
        <h3 class="card-title mt-2">{{title}}</h3>
        <p class="text-base-content/70">{{summary}}</p>
        <p class="mt-2 text-sm font-semibold text-primary">{{price}}</p>
      </div>
    </div>
    {{/each}}
  </div>
</section>

<section class="bg-base-200">
  <div class="mx-auto max-w-6xl px-6 py-20">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="work_title">Selected work</h2>
      <a class="inline-flex items-center gap-1.5 font-medium text-primary nw-underline" href="/work">View all projects ${icon('arrow-right', 'h-4 w-4')}</a>
    </div>
    <div class="nw-stagger mt-12 grid gap-6 md:grid-cols-3">
      {{#each data.projects}}
      <a class="card nw-card overflow-hidden border border-base-200 bg-base-100 shadow-sm hover:shadow-xl nw-zoom" href="/work">
        <figure class="aspect-[4/3] overflow-hidden"><img src="{{sw-url image}}" alt="{{title}}" class="h-full w-full object-cover" loading="lazy" /></figure>
        <div class="card-body">
          <span class="text-xs font-semibold uppercase tracking-wide text-primary">{{category}}</span>
          <h3 class="card-title">{{title}}</h3>
          <p class="text-sm text-base-content/60">{{summary}}</p>
        </div>
      </a>
      {{/each}}
    </div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 py-20">
  <h2 class="text-center text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="tst_title">Loved by the brands we build for</h2>
  <div class="nw-stagger mt-12 grid gap-6 lg:grid-cols-3">
    {{#each data.testimonials}}
    <figure class="card nw-card border border-base-200 bg-base-100 p-2 shadow-sm">
      <div class="card-body">
        <div class="flex gap-0.5 text-accent">${STARS}</div>
        <blockquote class="mt-2 text-base-content/80">{{quote}}</blockquote>
        <figcaption class="mt-4 text-sm"><span class="font-semibold">{{author}}</span><span class="text-base-content/50"> — {{role}}</span></figcaption>
      </div>
    </figure>
    {{/each}}
  </div>
</section>

<section class="bg-neutral text-neutral-content">
  <div class="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="cta_title">Have a project in mind?</h2>
    <p class="max-w-xl text-neutral-content/70" data-sw-text="cta_sub">Tell us where you want to be in twelve months. We’ll show you how the right website gets you there.</p>
    <a class="btn btn-primary btn-lg gap-2 shadow-xl shadow-primary/30" href="/contact">${icon('calendar', 'h-5 w-5')} <span data-sw-text="cta_btn">Book an intro call</span></a>
  </div>
</section>`,
  },

  // ---------------------------------------------------------------- WORK
  {
    id: 'work',
    path: 'work',
    title: 'Our Work',
    root: placeholderRoot,
    parent: 'home', // home is the tree root — every page nests under it
    nav: { title: 'Work', slots: ['header'], order: 2 },
    source: `<section class="mx-auto max-w-6xl px-6 pt-20 pb-6">
  <div class="nw-rise max-w-2xl">
    <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="work_eyebrow">Portfolio</span>
    <h1 class="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="work_h1">Work we’re proud of</h1>
    <p class="mt-4 text-lg text-base-content/60" data-sw-text="work_intro">A selection of recent sites across retail, health, finance, and the arts — each one hand-built and fast.</p>
  </div>
</section>
<section class="mx-auto max-w-6xl px-6 pb-24">
  <div class="nw-stagger grid gap-8 md:grid-cols-2">
    {{#each data.projects}}
    <a class="card nw-card overflow-hidden border border-base-200 bg-base-100 shadow-sm hover:shadow-2xl nw-zoom" href="/contact">
      <figure class="aspect-[16/10] overflow-hidden"><img src="{{sw-url image}}" alt="{{title}}" class="h-full w-full object-cover" loading="lazy" /></figure>
      <div class="card-body">
        <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><span>{{category}}</span><span class="text-base-content/30">·</span><span class="text-base-content/40">{{year}}</span></div>
        <h2 class="card-title text-2xl">{{title}}</h2>
        <p class="text-sm text-base-content/40">{{client}}</p>
        <p class="mt-1 text-base-content/70">{{summary}}</p>
      </div>
    </a>
    {{/each}}
  </div>
</section>`,
  },

  // ---------------------------------------------------------------- SERVICES
  {
    id: 'services',
    path: 'services',
    title: 'Services',
    root: placeholderRoot,
    parent: 'home', // home is the tree root
    // `dropdown: true` folds this page's CHILD pages (parent = 'services') into a
    // nav dropdown — and the editor's pages list nests them under it (the page tree).
    nav: { slots: ['header'], order: 3, dropdown: true },
    // Linked to its German variant (`services-de`) for hreflang + the language switcher.
    translationGroup: 'services',
    source: `<section class="mx-auto max-w-6xl px-6 pt-20 pb-8">
  <div class="nw-rise max-w-2xl">
    <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="srv_eyebrow">What we do</span>
    <h1 class="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="srv_h1">Services built to grow your business</h1>
    <p class="mt-4 text-lg text-base-content/60" data-sw-text="srv_intro">Engage us end-to-end or for a single phase. Either way you work directly with the people doing the work.</p>
  </div>
</section>
<section class="mx-auto max-w-6xl px-6 pb-12">
  <div class="nw-stagger grid gap-px overflow-hidden rounded-3xl border border-base-200 bg-base-200 sm:grid-cols-2">
    {{#each data.services}}
    <div class="bg-base-100 p-8 transition hover:bg-base-200/40">
      <div class="text-3xl">{{icon}}</div>
      <h2 class="mt-3 text-xl font-bold">{{title}}</h2>
      <p class="mt-2 text-base-content/70">{{summary}}</p>
      <p class="mt-4 text-sm font-semibold text-primary">{{price}}</p>
    </div>
    {{/each}}
  </div>
</section>
<section class="mx-auto max-w-5xl px-6 py-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="proc_title">A simple, proven process</h2>
  <ol class="nw-stagger mt-10 grid gap-6 md:grid-cols-4">
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">01</div><h3 class="mt-1 font-semibold" data-sw-text="p1_t">Discover</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p1_b">Goals, audience, and the metrics that matter.</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">02</div><h3 class="mt-1 font-semibold" data-sw-text="p2_t">Design</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p2_b">Interfaces and a brand system, reviewed together.</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">03</div><h3 class="mt-1 font-semibold" data-sw-text="p3_t">Build</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p3_b">Fast, accessible, content-managed, SEO-ready.</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">04</div><h3 class="mt-1 font-semibold" data-sw-text="p4_t">Launch &amp; care</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p4_b">We ship, measure, and keep improving.</p></li>
  </ol>
  <div class="mt-12"><a class="btn btn-primary btn-lg" href="/contact" data-sw-text="srv_cta">Start a project</a></div>
</section>`,
  },

  // -------------------------------------------------- SERVICE DETAIL (sub-pages of /services)
  // Child pages (parent: 'services') — they nest under Services in the nav dropdown AND are
  // indented under it in the editor's pages list. With the parent's dropdown ON they need no
  // own nav slot.
  {
    id: 'service-web-design',
    path: 'web-design',
    title: 'Web Design',
    root: placeholderRoot,
    // A sub-page: it nests under Services (the dropdown label falls back to this title)
    // and is indented under it in the editor's pages list. No own nav slot needed.
    parent: 'services',
    source: `<section class="mx-auto max-w-4xl px-6 py-20">
  <a class="inline-flex items-center gap-1.5 text-sm font-medium text-primary nw-underline" href="/services">${icon('arrow-left', 'h-4 w-4')} <span data-sw-text="back">All services</span></a>
  <span class="mt-6 block text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="wd_eyebrow">Service</span>
  <h1 class="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="wd_h1">Web Design</h1>
  <p class="mt-4 text-lg text-base-content/60" data-sw-text="wd_intro">Distinctive, on-brand interfaces designed pixel-perfect for every screen — from first wireframe to a polished, accessible UI.</p>
  <div class="nw-stagger mt-10 grid gap-4 sm:grid-cols-2">
    <div class="rounded-2xl border border-base-200 bg-base-100 p-6"><h3 class="font-semibold" data-sw-text="wd_1t">Design systems</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="wd_1b">Reusable components and tokens that scale with your brand.</p></div>
    <div class="rounded-2xl border border-base-200 bg-base-100 p-6"><h3 class="font-semibold" data-sw-text="wd_2t">Responsive by default</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="wd_2b">Every layout is crafted for mobile, tablet, and desktop.</p></div>
  </div>
  <div class="mt-10"><a class="btn btn-primary btn-lg" href="/contact" data-sw-text="wd_cta">Start a project</a></div>
</section>`,
  },
  {
    id: 'service-seo',
    path: 'seo',
    title: 'SEO & Performance',
    root: placeholderRoot,
    parent: 'services',
    source: `<section class="mx-auto max-w-4xl px-6 py-20">
  <a class="inline-flex items-center gap-1.5 text-sm font-medium text-primary nw-underline" href="/services">${icon('arrow-left', 'h-4 w-4')} <span data-sw-text="back">All services</span></a>
  <span class="mt-6 block text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="seo_eyebrow">Service</span>
  <h1 class="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="seo_h1">SEO &amp; Performance</h1>
  <p class="mt-4 text-lg text-base-content/60" data-sw-text="seo_intro">Technical SEO, Core Web Vitals, and analytics wired in from day one — so the fast, beautiful site you launch is the one Google rewards.</p>
  <div class="nw-stagger mt-10 grid gap-4 sm:grid-cols-2">
    <div class="rounded-2xl border border-base-200 bg-base-100 p-6"><h3 class="font-semibold" data-sw-text="seo_1t">Core Web Vitals</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="seo_1b">We tune LCP, CLS, and INP until the scores are green.</p></div>
    <div class="rounded-2xl border border-base-200 bg-base-100 p-6"><h3 class="font-semibold" data-sw-text="seo_2t">Technical SEO</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="seo_2b">Structured data, sitemaps, and clean, crawlable markup.</p></div>
  </div>
  <div class="mt-10"><a class="btn btn-primary btn-lg" href="/contact" data-sw-text="seo_cta">Start a project</a></div>
</section>`,
  },

  // ---------------------------------------------------------------- ABOUT
  {
    id: 'about',
    path: 'about',
    title: 'About',
    root: placeholderRoot,
    parent: 'home', // home is the tree root
    nav: { slots: ['header'], order: 4 },
    source: `<section class="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2">
  <div class="nw-rise">
    <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="ab_eyebrow">About us</span>
    <h1 class="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="ab_h1">A small, senior team — by design</h1>
    <p class="mt-5 text-lg text-base-content/70" data-sw-text="ab_p1">Northwind is a boutique studio of designers and engineers who’d rather do a few projects brilliantly than many adequately. No juniors learning on your dime, no layers of account managers — just the people doing the work.</p>
    <p class="mt-4 text-base-content/70" data-sw-text="ab_p2">We believe a great website is the hardest-working member of your team: fast, clear, and quietly persuasive. That belief shapes every decision we make.</p>
  </div>
  <div class="nw-zoom overflow-hidden rounded-3xl border border-base-200 shadow-xl">
    <img src="${assets.studio}" alt="The Northwind studio" class="h-full w-full object-cover" loading="lazy" />
  </div>
</section>

<section class="bg-base-200">
  <div class="mx-auto max-w-6xl px-6 py-20">
    <h2 class="text-3xl font-bold tracking-tight" data-sw-text="val_title">What we value</h2>
    <div class="nw-stagger mt-10 grid gap-6 md:grid-cols-3">
      <div class="rounded-2xl bg-base-100 p-7 shadow-sm"><span class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('star', 'h-5 w-5')}</span><h3 class="mt-4 text-lg font-bold" data-sw-text="v1_t">Craft over churn</h3><p class="mt-2 text-base-content/60" data-sw-text="v1_b">We sweat the details most teams skip — because details are what people feel.</p></div>
      <div class="rounded-2xl bg-base-100 p-7 shadow-sm"><span class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('arrow-up-right', 'h-5 w-5')}</span><h3 class="mt-4 text-lg font-bold" data-sw-text="v2_t">Speed is a feature</h3><p class="mt-2 text-base-content/60" data-sw-text="v2_b">Every site we ship is static, optimized, and built to load instantly.</p></div>
      <div class="rounded-2xl bg-base-100 p-7 shadow-sm"><span class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('check', 'h-5 w-5')}</span><h3 class="mt-4 text-lg font-bold" data-sw-text="v3_t">Plain dealing</h3><p class="mt-2 text-base-content/60" data-sw-text="v3_b">Fixed scopes, clear timelines, and honest advice — even when it costs us the upsell.</p></div>
    </div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 py-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="team_title">The people you’ll work with</h2>
  <div class="nw-stagger mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
    {{#each data.team}}
    <div class="text-center">
      <div class="mx-auto aspect-square w-36 overflow-hidden rounded-full border-4 border-base-100 shadow-lg nw-zoom"><img src="{{sw-url photo}}" alt="{{name}}" class="h-full w-full object-cover" loading="lazy" /></div>
      <h3 class="mt-4 font-bold">{{name}}</h3>
      <p class="text-sm text-primary">{{role}}</p>
      <p class="mt-1 text-sm text-base-content/50">{{bio}}</p>
    </div>
    {{/each}}
  </div>
</section>`,
  },

  // ---------------------------------------------------------------- CONTACT (block-tree: hosts the Form block)
  {
    id: 'contact',
    path: 'contact',
    title: 'Contact',
    parent: 'home', // home is the tree root
    nav: { slots: ['header'], order: 5 },
    root: {
      id: 'contact-root',
      type: 'Section',
      className: 'mx-auto max-w-6xl px-6 py-20',
      children: [
        {
          id: 'c-grid',
          type: 'Grid',
          props: { columns: 2 },
          className: 'gap-10 lg:gap-16 items-start',
          children: [
            {
              id: 'c-info',
              type: 'Card',
              className: 'nw-rise',
              children: [
                { id: 'c-h', type: 'Heading', props: { level: 1, text: 'Let’s build something great' }, className: 'text-4xl font-extrabold tracking-tight' },
                { id: 'c-sub', type: 'RichText', props: { text: 'Tell us about your project and we’ll get back within one business day. Prefer email? Reach us directly — we read every message.' }, className: 'mt-4 text-lg text-base-content/70' },
                {
                  id: 'c-details',
                  type: 'Html',
                  className: 'mt-8',
                  props: {
                    html:
                      '<ul class="space-y-4">' +
                      `<li class="flex items-center gap-3"><span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('mail', 'h-5 w-5')}</span><a class="font-medium text-primary nw-underline" href="mailto:hello@northwindstudio.com">hello@northwindstudio.com</a></li>` +
                      `<li class="flex items-center gap-3"><span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('phone', 'h-5 w-5')}</span><span class="text-base-content/80">+1 (415) 555-0142</span></li>` +
                      `<li class="flex items-center gap-3"><span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('map-pin', 'h-5 w-5')}</span><span class="text-base-content/80">548 Market Street, Suite 200 · San Francisco, CA</span></li>` +
                      `<li class="flex items-center gap-3"><span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('clock', 'h-5 w-5')}</span><span class="text-base-content/80">Mon–Fri, 9–6 PT</span></li>` +
                      '</ul>',
                  },
                },
              ],
            },
            {
              id: 'c-form-card',
              type: 'Card',
              className: 'nw-card rounded-3xl border border-base-200 bg-base-100 p-8 shadow-xl',
              children: [{ id: 'c-form', type: 'Form', props: { formId: 'contact' } }],
            },
          ],
        },
      ],
    },
  },

  // ================================================================ GERMAN (de) VARIANTS
  // Locale-variant PAGES (not field overlays): each is its own page with `locale: 'de'`,
  // its own `/de…` path, and a shared `translationGroup` linking it to the English
  // original for hreflang + the language switcher. The German Services page binds
  // `data.services`, which auto-resolves to the `services-de` dataset for a `de` page.
  // ---------------------------------------------------------------- HOME (de)
  {
    id: 'home-de',
    path: 'de',
    title: 'Northwind Web Studio — Websites, die Geschäft machen',
    root: placeholderRoot,
    locale: 'de',
    translationGroup: 'home',
    parent: 'home', // even a locale variant nests under the (default-locale) home root
    nav: { title: 'Start', slots: ['header'], order: 1 },
    source: `<section class="nw-aurora text-white">
  <div class="mx-auto grid max-w-6xl items-center gap-10 px-6 py-24 lg:grid-cols-2 lg:py-32">
    <div class="nw-rise">
      <span class="badge badge-lg border-white/30 bg-white/10 text-white" data-sw-text="hero_eyebrow">Boutique-Webstudio · San Francisco</span>
      <h1 class="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl" data-sw-text="hero_title">Websites, die Ihnen mehr Geschäft bringen.</h1>
      <p class="mt-6 max-w-md text-lg text-white/80" data-sw-text="hero_sub">Wir gestalten und bauen schnelle, schöne Websites für ambitionierte Marken — Strategie, Design und Entwicklung aus einer Hand.</p>
      <div class="mt-8 flex flex-wrap gap-3">
        <a class="btn btn-lg gap-2 border-0 bg-white text-primary shadow-xl hover:bg-white/90 waves-effect" href="/contact"><span data-sw-text="hero_cta">Projekt starten</span> ${icon('arrow-right', 'h-5 w-5')}</a>
        <a class="btn btn-lg btn-ghost gap-2 border-white/40 text-white hover:bg-white/10 waves-effect waves-light" href="/work">Arbeiten ansehen ${icon('arrow-up-right', 'h-5 w-5')}</a>
      </div>
    </div>
    <div class="nw-float hidden lg:block">
      <div class="overflow-hidden rounded-3xl border border-white/20 shadow-2xl nw-zoom">
        <img class="lazyload h-full w-full object-cover" data-src="${assets.hero}" alt="Eine aktuelle Northwind-Website" />
      </div>
    </div>
  </div>
</section>

<section class="border-y border-base-200 bg-base-100">
  <dl class="nw-stagger mx-auto grid max-w-5xl grid-cols-2 gap-6 px-6 py-12 text-center md:grid-cols-4">
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat1_n">120+</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat1_l">Websites ausgeliefert</dd></div>
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat2_n">9</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat2_l">Jahre am Markt</dd></div>
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat3_n">100</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat3_l">Ø Lighthouse-Score</dd></div>
    <div><dt class="text-4xl font-extrabold text-primary" data-sw-text="stat4_n">38%</dt><dd class="mt-1 text-sm text-base-content/60" data-sw-text="stat4_l">Ø mehr Anfragen</dd></div>
  </dl>
</section>

<section class="mx-auto max-w-6xl px-6 py-20">
  <div class="max-w-2xl">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="svc_title">Alles aus einer Hand</h2>
    <p class="mt-3 text-base-content/60" data-sw-text="svc_sub">Strategie, Design und Entwicklung — keine Übergaben, keine Agentur-Ketten.</p>
  </div>
  <div class="nw-stagger mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {{#each data.services}}
    <div class="card nw-card border border-base-200 bg-base-100 shadow-sm hover:shadow-xl">
      <div class="card-body">
        <div class="text-3xl">{{icon}}</div>
        <h3 class="card-title mt-2">{{title}}</h3>
        <p class="text-base-content/70">{{summary}}</p>
        <p class="mt-2 text-sm font-semibold text-primary">{{price}}</p>
      </div>
    </div>
    {{/each}}
  </div>
</section>

<section class="bg-neutral text-neutral-content">
  <div class="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl" data-sw-text="cta_title">Sie haben ein Projekt im Kopf?</h2>
    <p class="max-w-xl text-neutral-content/70" data-sw-text="cta_sub">Sagen Sie uns, wo Sie in zwölf Monaten stehen wollen — wir zeigen Ihnen, wie die richtige Website Sie dorthin bringt.</p>
    <a class="btn btn-primary btn-lg gap-2 shadow-xl shadow-primary/30" href="/contact">${icon('calendar', 'h-5 w-5')} <span data-sw-text="cta_btn">Kennenlern-Termin buchen</span></a>
  </div>
</section>`,
  },

  // ---------------------------------------------------------------- SERVICES (de)
  {
    id: 'services-de-page',
    path: 'leistungen',
    title: 'Leistungen',
    root: placeholderRoot,
    locale: 'de',
    translationGroup: 'services',
    // Nested under the GERMAN home (`home-de`, slug `de`) → computed route /de/leistungen.
    parent: 'home-de',
    nav: { title: 'Leistungen', slots: ['header'], order: 2 },
    source: `<section class="mx-auto max-w-6xl px-6 pt-20 pb-8">
  <div class="nw-rise max-w-2xl">
    <span class="text-sm font-semibold uppercase tracking-wide text-primary" data-sw-text="srv_eyebrow">Was wir tun</span>
    <h1 class="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl" data-sw-text="srv_h1">Leistungen, die Ihr Geschäft wachsen lassen</h1>
    <p class="mt-4 text-lg text-base-content/60" data-sw-text="srv_intro">Buchen Sie uns durchgängig oder für eine einzelne Phase. So oder so arbeiten Sie direkt mit den Menschen, die die Arbeit machen.</p>
  </div>
</section>
<section class="mx-auto max-w-6xl px-6 pb-12">
  <div class="nw-stagger grid gap-px overflow-hidden rounded-3xl border border-base-200 bg-base-200 sm:grid-cols-2">
    {{#each data.services}}
    <div class="bg-base-100 p-8 transition hover:bg-base-200/40">
      <div class="text-3xl">{{icon}}</div>
      <h2 class="mt-3 text-xl font-bold">{{title}}</h2>
      <p class="mt-2 text-base-content/70">{{summary}}</p>
      <p class="mt-4 text-sm font-semibold text-primary">{{price}}</p>
    </div>
    {{/each}}
  </div>
</section>
<section class="mx-auto max-w-5xl px-6 py-20">
  <h2 class="text-3xl font-bold tracking-tight" data-sw-text="proc_title">Ein einfacher, bewährter Ablauf</h2>
  <ol class="nw-stagger mt-10 grid gap-6 md:grid-cols-4">
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">01</div><h3 class="mt-1 font-semibold" data-sw-text="p1_t">Entdecken</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p1_b">Ziele, Zielgruppe und die Kennzahlen, die zählen.</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">02</div><h3 class="mt-1 font-semibold" data-sw-text="p2_t">Gestalten</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p2_b">Oberflächen und ein Markensystem, gemeinsam abgestimmt.</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">03</div><h3 class="mt-1 font-semibold" data-sw-text="p3_t">Bauen</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p3_b">Schnell, barrierearm, pflegbar, SEO-bereit.</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">04</div><h3 class="mt-1 font-semibold" data-sw-text="p4_t">Launch &amp; Pflege</h3><p class="mt-1 text-sm text-base-content/60" data-sw-text="p4_b">Wir veröffentlichen, messen und verbessern weiter.</p></li>
  </ol>
  <div class="mt-12"><a class="btn btn-primary btn-lg" href="/contact" data-sw-text="srv_cta">Projekt starten</a></div>
</section>`,
  },

  // ---------------------------------------------------------------- BLOG (content-only templates)
  // A page-tree blog: the overview uses global:blog-overview ({{#each page.children}}), each article
  // uses global:blog-article (every field a data-sw-*="data.*" in-preview-editable leaf). No code —
  // the content lives entirely in each page's `data` (page.data), seeded from the template defaults.
  {
    id: 'blog',
    path: 'blog',
    title: 'Blog',
    root: placeholderRoot,
    parent: 'home',
    nav: { title: 'Blog', slots: ['header'], order: 5 },
    template: 'global:blog-overview',
    seo: { description: 'Notes on web design, performance, and building sites that earn their keep.' },
    data: { heading: 'From the studio', intro: 'Notes on web design, performance, and building sites that earn their keep.' },
  },
  {
    id: 'blog-static-speed',
    path: 'why-static-sites-win',
    title: 'Why static sites win on speed',
    root: placeholderRoot,
    parent: 'blog',
    template: 'global:blog-article',
    order: 1,
    seo: { description: 'A static-first build keeps your site fast, cheap to host, and effortless to maintain.' },
    data: {
      article_kicker: 'Performance',
      article_title: 'Why static sites win on speed',
      article_excerpt: 'A static-first build keeps your site fast, cheap to host, and effortless to maintain.',
      article_image: assets['proj-harbor'] ?? '',
      article_body:
        '<p>Every millisecond of load time costs you visitors. A pre-rendered, static site ships plain HTML, CSS, and a sliver of JS — there is no server to wait on, so the page paints almost instantly.</p>' +
        '<h2>Fewer moving parts</h2>' +
        '<p>No database, no runtime, no patching. The whole site is a folder of files any host can serve from a CDN edge near your visitor.</p>' +
        '<ul><li>Top Core Web Vitals out of the box</li><li>Cheap, simple hosting</li><li>A smaller attack surface</li></ul>',
    },
  },
  {
    id: 'blog-design-systems',
    path: 'design-systems-that-scale',
    title: 'Design systems that scale',
    root: placeholderRoot,
    parent: 'blog',
    template: 'global:blog-article',
    order: 2,
    seo: { description: 'Tokens and reusable components keep a growing site consistent — and fast to build.' },
    data: {
      article_kicker: 'Design',
      article_title: 'Design systems that scale',
      article_excerpt: 'Tokens and reusable components keep a growing site consistent — and fast to build.',
      article_image: assets['proj-vela'] ?? '',
      article_body:
        '<p>A design system is the shared vocabulary between design and code: colour tokens, type scales, spacing, and a library of components everyone reaches for.</p>' +
        '<p>The payoff compounds. Once the building blocks exist, new pages are assembled in hours, and a brand tweak ripples everywhere from a single change.</p>',
    },
  },
  {
    id: 'blog-seo-foundations',
    path: 'seo-foundations',
    title: 'SEO foundations, from day one',
    root: placeholderRoot,
    parent: 'blog',
    template: 'global:blog-article',
    order: 3,
    seo: { description: 'Clean markup, structured data, and fast pages are the SEO basics that actually move rankings.' },
    data: {
      article_kicker: 'SEO',
      article_title: 'SEO foundations, from day one',
      article_excerpt: 'Clean markup, structured data, and fast pages are the basics that actually move rankings.',
      article_image: assets['proj-lumen'] ?? '',
      article_body:
        '<p>SEO is not a bolt-on. The fast, accessible, semantically-marked-up site you launch is the one search engines reward.</p>' +
        '<h2>Get the basics right</h2>' +
        '<ul><li>Descriptive titles and meta descriptions</li><li>A clean, crawlable URL structure</li><li>Structured data and an accurate sitemap</li></ul>',
    },
  },
  // MINI SHOP demo: a content-free storefront. global:shop loops the `products` dataset, each card
  // with a {{sw-add-to-cart}} button + the {{sw-cart}} mount. The cart builds an order in the browser
  // and submits it via WhatsApp / email / PayPal (configured in EXAMPLE_WEBSITE.shop). Front-end only.
  {
    id: 'shop',
    path: 'shop',
    title: 'Studio merch — Northwind shop',
    root: placeholderRoot,
    parent: 'home',
    nav: { title: 'Shop', slots: ['header'], order: 6 },
    template: 'global:shop',
    seo: { description: 'Studio merch for fellow web nerds — add to cart and order via WhatsApp, email, or a payment link.' },
    data: {
      heading: 'Studio merch',
      intro: 'A little something for fellow web nerds. Add to cart and check out via WhatsApp, email, or a payment link.',
    },
  },
  ];
}
