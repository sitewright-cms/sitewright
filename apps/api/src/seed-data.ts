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
 * `{{edit}}` regions, real imagery, and a working contact form. It is deliberately polished so an
 * operator immediately sees what a finished Sitewright site looks like — then deletes it.
 *
 * Constraints honored so it renders identically in the in-container `/sites/<slug>/` preview AND
 * on an exported static host:
 *   - Motion is CSS-only (the preview CSP blocks inline JS); images use https URLs (allowed).
 *   - Page bodies pass the no-JS template validator (values only in text / quoted attrs; the
 *     `{{url …}}` helper for interpolated src/href).
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
    'https://twitter.com/northwindstudio',
    'https://www.linkedin.com/company/northwindstudio',
    'https://dribbble.com/northwindstudio',
  ],
  // Brand palette → DaisyUI theme tokens (the -content foregrounds are auto-derived for contrast).
  // Only single-word keys are valid; the neutral/base surfaces use DaisyUI's light-theme defaults.
  colors: {
    primary: '#4f46e5',
    secondary: '#0ea5e9',
    accent: '#f59e0b',
    neutral: '#171627',
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
    <ul class="menu menu-horizontal gap-1 px-1 font-medium">{{#each nav.header}}{{#if children}}<li><details><summary>{{label}}</summary><ul class="z-30 rounded-box bg-base-100 p-2 shadow-lg">{{#each children}}<li><a href="{{url path}}">{{label}}</a></li>{{/each}}</ul></details></li>{{else}}<li><a href="{{url path}}">{{label}}</a></li>{{/if}}{{/each}}</ul>
  </div>
  <div class="navbar-end gap-2">
    <a class="btn btn-primary btn-sm gap-1.5 shadow-lg shadow-primary/20 waves-effect waves-light" href="/contact">Start a project ${icon('arrow-right', 'h-4 w-4')}</a>
  </div>
</div>`,
  footer: `<footer class="bg-neutral text-neutral-content">
  <div class="mx-auto grid max-w-6xl gap-10 px-6 py-16 sm:grid-cols-2 lg:grid-cols-4">
    <div class="sm:col-span-2 lg:col-span-1">
      <p class="flex items-center gap-2 text-lg font-extrabold"><span class="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-content">N</span>{{ company.name }}</p>
      <p class="mt-4 max-w-xs text-sm text-neutral-content/70">{{ company.slogan }}</p>
    </div>
    <nav>
      <h6 class="footer-title opacity-100">Studio</h6>
      <ul class="mt-3 space-y-2 text-sm text-neutral-content/70">{{#each nav.header}}<li><a class="hover:text-neutral-content" href="{{url path}}">{{label}}</a></li>{{/each}}</ul>
    </nav>
    <nav>
      <h6 class="footer-title opacity-100">Contact</h6>
      <ul class="mt-3 space-y-2 text-sm text-neutral-content/70">
        <li class="flex items-center gap-2">${icon('mail', 'h-4 w-4 shrink-0 opacity-60')}{{ company.email }}</li>
        <li class="flex items-center gap-2">${icon('phone', 'h-4 w-4 shrink-0 opacity-60')}{{ company.telephone }}</li>
        <li class="flex items-center gap-2">${icon('map-pin', 'h-4 w-4 shrink-0 opacity-60')}{{ company.address.locality }}, {{ company.address.region }}</li>
      </ul>
    </nav>
    <div>
      <h6 class="footer-title opacity-100">Newsletter</h6>
      <p class="mt-3 text-sm text-neutral-content/70">{{edit "footer_news" "Occasional notes on web craft. No spam."}}</p>
      <a class="btn btn-outline btn-sm mt-4 border-neutral-content/30 text-neutral-content hover:border-primary hover:bg-primary hover:text-primary-content" href="/contact">Get in touch</a>
    </div>
  </div>
  <div class="border-t border-neutral-content/10">
    <p class="mx-auto max-w-6xl px-6 py-5 text-center text-xs text-neutral-content/50">© {{ company.legalName }} · Built with Sitewright — code-first, instantly fast.</p>
  </div>
</footer>`,
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
];

const pub = (dataset: string, id: string, values: Record<string, unknown>): Entry => ({
  id,
  dataset,
  status: 'published',
  values,
});

export const EXAMPLE_ENTRIES: Entry[] = [
  // --- services ---
  pub('services', 'svc-strategy', { icon: '🧭', title: 'Strategy & UX', summary: 'Research, positioning, and user journeys that turn visitors into customers.', price: 'from $4k' }),
  pub('services', 'svc-design', { icon: '🎨', title: 'Web Design', summary: 'Distinctive, on-brand interfaces designed pixel-perfect for every screen.', price: 'from $8k' }),
  pub('services', 'svc-build', { icon: '⚡', title: 'Development', summary: 'Hand-built, lightning-fast static sites with top Lighthouse scores.', price: 'from $10k' }),
  pub('services', 'svc-brand', { icon: '✨', title: 'Brand Identity', summary: 'Logos, type systems, and visual languages that scale across every touchpoint.', price: 'from $6k' }),
  pub('services', 'svc-seo', { icon: '📈', title: 'SEO & Performance', summary: 'Technical SEO, Core Web Vitals, and analytics wired in from day one.', price: 'from $3k' }),
  pub('services', 'svc-care', { icon: '🛟', title: 'Care Plans', summary: 'Ongoing edits, monitoring, and improvements so your site keeps earning.', price: '$450/mo' }),
  // --- projects / work (picsum seeded URLs always resolve) ---
  pub('projects', 'proj-harbor', { title: 'Harbor & Co.', client: 'Harbor Coffee Roasters', category: 'E-commerce', summary: 'A flavour-led storefront that lifted online orders by 38%.', image: 'https://picsum.photos/seed/nw-harbor/900/650', year: '2025' }),
  pub('projects', 'proj-vela', { title: 'Vela Health', client: 'Vela', category: 'Healthcare', summary: 'A calm, accessible patient portal and marketing site.', image: 'https://picsum.photos/seed/nw-vela/900/650', year: '2025' }),
  pub('projects', 'proj-lumen', { title: 'Lumen Capital', client: 'Lumen', category: 'Finance', summary: 'A trustworthy, data-rich site for a boutique investment firm.', image: 'https://picsum.photos/seed/nw-lumen/900/650', year: '2024' }),
  pub('projects', 'proj-terra', { title: 'Terra Studio', client: 'Terra Architects', category: 'Portfolio', summary: 'An immersive, image-first showcase for an award-winning practice.', image: 'https://picsum.photos/seed/nw-terra/900/650', year: '2024' }),
  pub('projects', 'proj-flint', { title: 'Flint & Steel', client: 'Flint BBQ', category: 'Hospitality', summary: 'A mouth-watering site with online booking for a fast-growing chain.', image: 'https://picsum.photos/seed/nw-flint/900/650', year: '2024' }),
  pub('projects', 'proj-aria', { title: 'Aria Festival', client: 'Aria', category: 'Events', summary: 'A bold, high-energy festival site built to survive launch-day traffic.', image: 'https://picsum.photos/seed/nw-aria/900/650', year: '2023' }),
  // --- team ---
  pub('team', 'team-mara', { name: 'Mara Whitfield', role: 'Founder & Design Director', photo: 'https://picsum.photos/seed/nw-mara/400/400', bio: 'Twelve years shaping brands for studios and startups.' }),
  pub('team', 'team-dev', { name: 'Devon Park', role: 'Lead Engineer', photo: 'https://picsum.photos/seed/nw-devon/400/400', bio: 'Performance obsessive; ships sites that score 100.' }),
  pub('team', 'team-ines', { name: 'Inés Romero', role: 'UX Strategist', photo: 'https://picsum.photos/seed/nw-ines/400/400', bio: 'Turns fuzzy goals into journeys that convert.' }),
  pub('team', 'team-sol', { name: 'Sol Nakamura', role: 'Brand Designer', photo: 'https://picsum.photos/seed/nw-sol/400/400', bio: 'Builds type systems and logos with staying power.' }),
  // --- testimonials ---
  pub('testimonials', 'tst-1', { quote: 'Northwind rebuilt our site in six weeks and our enquiries doubled. They are the rare studio that gets both design and engineering right.', author: 'Priya Anand', role: 'CEO, Harbor Coffee' }),
  pub('testimonials', 'tst-2', { quote: 'The fastest, most thoughtful team we have worked with. Our Lighthouse scores went from the 40s to a perfect 100.', author: 'Marcus Lee', role: 'CMO, Lumen Capital' }),
  pub('testimonials', 'tst-3', { quote: 'They treated our brand like their own. The new site finally looks like the company we are becoming.', author: 'Elena Fischer', role: 'Founder, Terra Architects' }),
];

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

export const EXAMPLE_PAGES: Page[] = [
  // ---------------------------------------------------------------- HOME
  {
    id: 'home',
    path: '/',
    title: 'Northwind Web Studio — Websites that mean business',
    root: placeholderRoot,
    nav: { title: 'Home', slots: ['header'], order: 1 },
    source: `<section class="nw-aurora text-white">
  <div class="mx-auto grid max-w-6xl items-center gap-10 px-6 py-24 lg:grid-cols-2 lg:py-32">
    <div class="nw-rise">
      <span class="badge badge-lg border-white/30 bg-white/10 text-white">{{edit "hero_eyebrow" "Boutique web studio · San Francisco"}}</span>
      <h1 class="mt-6 text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">{{edit "hero_title" "Websites that win you more business."}}</h1>
      <p class="mt-6 max-w-md text-lg text-white/80">{{edit "hero_sub" "We design and build fast, beautiful sites for ambitious brands — strategy, design, and engineering under one roof."}}</p>
      <div class="mt-8 flex flex-wrap gap-3">
        <a class="btn btn-lg gap-2 border-0 bg-white text-primary shadow-xl hover:bg-white/90 waves-effect" href="/contact">{{edit "hero_cta" "Start a project"}} ${icon('arrow-right', 'h-5 w-5')}</a>
        <a class="btn btn-lg btn-ghost gap-2 border-white/40 text-white hover:bg-white/10 waves-effect waves-light" href="/work">See our work ${icon('arrow-up-right', 'h-5 w-5')}</a>
      </div>
    </div>
    <div class="nw-float hidden lg:block">
      <div class="overflow-hidden rounded-3xl border border-white/20 shadow-2xl nw-zoom">
        <!-- Lazy-loaded (vanilla-lazyload vocabulary): the runtime swaps data-src → src on scroll-in, with a blur-up fade. -->
        <img class="lazyload h-full w-full object-cover" data-src="https://picsum.photos/seed/nw-hero/900/700" alt="A recent Northwind website" />
      </div>
    </div>
  </div>
</section>

<section class="border-y border-base-200 bg-base-100">
  <dl class="nw-stagger mx-auto grid max-w-5xl grid-cols-2 gap-6 px-6 py-12 text-center md:grid-cols-4">
    <div><dt class="text-4xl font-extrabold text-primary">{{edit "stat1_n" "120+"}}</dt><dd class="mt-1 text-sm text-base-content/60">{{edit "stat1_l" "Sites shipped"}}</dd></div>
    <div><dt class="text-4xl font-extrabold text-primary">{{edit "stat2_n" "9"}}</dt><dd class="mt-1 text-sm text-base-content/60">{{edit "stat2_l" "Years in business"}}</dd></div>
    <div><dt class="text-4xl font-extrabold text-primary">{{edit "stat3_n" "100"}}</dt><dd class="mt-1 text-sm text-base-content/60">{{edit "stat3_l" "Avg. Lighthouse score"}}</dd></div>
    <div><dt class="text-4xl font-extrabold text-primary">{{edit "stat4_n" "38%"}}</dt><dd class="mt-1 text-sm text-base-content/60">{{edit "stat4_l" "Avg. lift in enquiries"}}</dd></div>
  </dl>
</section>

<section class="mx-auto max-w-6xl px-6 pt-20">
  <div class="grid gap-10 lg:grid-cols-2 lg:items-center">
    <div>
      <span class="text-sm font-semibold uppercase tracking-wide text-primary">{{edit "why_eyebrow" "Why Northwind"}}</span>
      <h2 class="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{{edit "why_title" "Senior people, no hand-offs, no surprises"}}</h2>
      <p class="mt-4 text-base-content/60">{{edit "why_sub" "You work directly with the designers and engineers building your site — start to finish."}}</p>
    </div>
    <ul class="nw-stagger grid gap-3 sm:grid-cols-2">
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80">{{edit "why1" "Fixed scope & timeline"}}</span></li>
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80">{{edit "why2" "Perfect Lighthouse scores"}}</span></li>
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80">{{edit "why3" "You can edit the content yourself"}}</span></li>
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80">{{edit "why4" "Accessible & SEO-ready"}}</span></li>
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80">{{edit "why5" "Hosting-friendly static export"}}</span></li>
      <li class="flex items-start gap-3"><span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">${icon('check', 'h-4 w-4')}</span><span class="text-base-content/80">{{edit "why6" "Ongoing care plans"}}</span></li>
    </ul>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 py-20">
  <div class="max-w-2xl">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl">{{edit "svc_title" "Everything you need under one roof"}}</h2>
    <p class="mt-3 text-base-content/60">{{edit "svc_sub" "Strategy, design, and engineering — no hand-offs, no agencies-of-agencies."}}</p>
  </div>
  <div class="nw-stagger mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {{#each data.services}}
    <div class="card nw-card border border-base-200 bg-base-100 shadow-sm hover:shadow-xl">
      <div class="card-body">
        <div class="text-3xl">{{values.icon}}</div>
        <h3 class="card-title mt-2">{{values.title}}</h3>
        <p class="text-base-content/70">{{values.summary}}</p>
        <p class="mt-2 text-sm font-semibold text-primary">{{values.price}}</p>
      </div>
    </div>
    {{/each}}
  </div>
</section>

<section class="bg-base-200">
  <div class="mx-auto max-w-6xl px-6 py-20">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <h2 class="text-3xl font-bold tracking-tight sm:text-4xl">{{edit "work_title" "Selected work"}}</h2>
      <a class="inline-flex items-center gap-1.5 font-medium text-primary nw-underline" href="/work">View all projects ${icon('arrow-right', 'h-4 w-4')}</a>
    </div>
    <div class="nw-stagger mt-12 grid gap-6 md:grid-cols-3">
      {{#each data.projects}}
      <a class="card nw-card overflow-hidden border border-base-200 bg-base-100 shadow-sm hover:shadow-xl nw-zoom" href="/work">
        <figure class="aspect-[4/3] overflow-hidden"><img src="{{url values.image}}" alt="{{values.title}}" class="h-full w-full object-cover" loading="lazy" /></figure>
        <div class="card-body">
          <span class="text-xs font-semibold uppercase tracking-wide text-primary">{{values.category}}</span>
          <h3 class="card-title">{{values.title}}</h3>
          <p class="text-sm text-base-content/60">{{values.summary}}</p>
        </div>
      </a>
      {{/each}}
    </div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 py-20">
  <h2 class="text-center text-3xl font-bold tracking-tight sm:text-4xl">{{edit "tst_title" "Loved by the brands we build for"}}</h2>
  <div class="nw-stagger mt-12 grid gap-6 lg:grid-cols-3">
    {{#each data.testimonials}}
    <figure class="card nw-card border border-base-200 bg-base-100 p-2 shadow-sm">
      <div class="card-body">
        <div class="flex gap-0.5 text-accent">${STARS}</div>
        <blockquote class="mt-2 text-base-content/80">{{values.quote}}</blockquote>
        <figcaption class="mt-4 text-sm"><span class="font-semibold">{{values.author}}</span><span class="text-base-content/50"> — {{values.role}}</span></figcaption>
      </div>
    </figure>
    {{/each}}
  </div>
</section>

<section class="bg-neutral text-neutral-content">
  <div class="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 py-20 text-center">
    <h2 class="text-3xl font-bold tracking-tight sm:text-4xl">{{edit "cta_title" "Have a project in mind?"}}</h2>
    <p class="max-w-xl text-neutral-content/70">{{edit "cta_sub" "Tell us where you want to be in twelve months. We’ll show you how the right website gets you there."}}</p>
    <a class="btn btn-primary btn-lg gap-2 shadow-xl shadow-primary/30" href="/contact">${icon('calendar', 'h-5 w-5')} {{edit "cta_btn" "Book an intro call"}}</a>
  </div>
</section>`,
  },

  // ---------------------------------------------------------------- WORK
  {
    id: 'work',
    path: '/work',
    title: 'Our Work',
    root: placeholderRoot,
    nav: { title: 'Work', slots: ['header'], order: 2 },
    source: `<section class="mx-auto max-w-6xl px-6 pt-20 pb-6">
  <div class="nw-rise max-w-2xl">
    <span class="text-sm font-semibold uppercase tracking-wide text-primary">{{edit "work_eyebrow" "Portfolio"}}</span>
    <h1 class="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl">{{edit "work_h1" "Work we’re proud of"}}</h1>
    <p class="mt-4 text-lg text-base-content/60">{{edit "work_intro" "A selection of recent sites across retail, health, finance, and the arts — each one hand-built and fast."}}</p>
  </div>
</section>
<section class="mx-auto max-w-6xl px-6 pb-24">
  <div class="nw-stagger grid gap-8 md:grid-cols-2">
    {{#each data.projects}}
    <a class="card nw-card overflow-hidden border border-base-200 bg-base-100 shadow-sm hover:shadow-2xl nw-zoom" href="/contact">
      <figure class="aspect-[16/10] overflow-hidden"><img src="{{url values.image}}" alt="{{values.title}}" class="h-full w-full object-cover" loading="lazy" /></figure>
      <div class="card-body">
        <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><span>{{values.category}}</span><span class="text-base-content/30">·</span><span class="text-base-content/40">{{values.year}}</span></div>
        <h2 class="card-title text-2xl">{{values.title}}</h2>
        <p class="text-sm text-base-content/40">{{values.client}}</p>
        <p class="mt-1 text-base-content/70">{{values.summary}}</p>
      </div>
    </a>
    {{/each}}
  </div>
</section>`,
  },

  // ---------------------------------------------------------------- SERVICES
  {
    id: 'services',
    path: '/services',
    title: 'Services',
    root: placeholderRoot,
    nav: { slots: ['header'], order: 3 },
    source: `<section class="mx-auto max-w-6xl px-6 pt-20 pb-8">
  <div class="nw-rise max-w-2xl">
    <span class="text-sm font-semibold uppercase tracking-wide text-primary">{{edit "srv_eyebrow" "What we do"}}</span>
    <h1 class="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl">{{edit "srv_h1" "Services built to grow your business"}}</h1>
    <p class="mt-4 text-lg text-base-content/60">{{edit "srv_intro" "Engage us end-to-end or for a single phase. Either way you work directly with the people doing the work."}}</p>
  </div>
</section>
<section class="mx-auto max-w-6xl px-6 pb-12">
  <div class="nw-stagger grid gap-px overflow-hidden rounded-3xl border border-base-200 bg-base-200 sm:grid-cols-2">
    {{#each data.services}}
    <div class="bg-base-100 p-8 transition hover:bg-base-200/40">
      <div class="text-3xl">{{values.icon}}</div>
      <h2 class="mt-3 text-xl font-bold">{{values.title}}</h2>
      <p class="mt-2 text-base-content/70">{{values.summary}}</p>
      <p class="mt-4 text-sm font-semibold text-primary">{{values.price}}</p>
    </div>
    {{/each}}
  </div>
</section>
<section class="mx-auto max-w-5xl px-6 py-20">
  <h2 class="text-3xl font-bold tracking-tight">{{edit "proc_title" "A simple, proven process"}}</h2>
  <ol class="nw-stagger mt-10 grid gap-6 md:grid-cols-4">
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">01</div><h3 class="mt-1 font-semibold">{{edit "p1_t" "Discover"}}</h3><p class="mt-1 text-sm text-base-content/60">{{edit "p1_b" "Goals, audience, and the metrics that matter."}}</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">02</div><h3 class="mt-1 font-semibold">{{edit "p2_t" "Design"}}</h3><p class="mt-1 text-sm text-base-content/60">{{edit "p2_b" "Interfaces and a brand system, reviewed together."}}</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">03</div><h3 class="mt-1 font-semibold">{{edit "p3_t" "Build"}}</h3><p class="mt-1 text-sm text-base-content/60">{{edit "p3_b" "Fast, accessible, content-managed, SEO-ready."}}</p></li>
    <li class="rounded-2xl border border-base-200 bg-base-100 p-6"><div class="text-sm font-bold text-primary">04</div><h3 class="mt-1 font-semibold">{{edit "p4_t" "Launch & care"}}</h3><p class="mt-1 text-sm text-base-content/60">{{edit "p4_b" "We ship, measure, and keep improving."}}</p></li>
  </ol>
  <div class="mt-12"><a class="btn btn-primary btn-lg" href="/contact">{{edit "srv_cta" "Start a project"}}</a></div>
</section>`,
  },

  // ---------------------------------------------------------------- ABOUT
  {
    id: 'about',
    path: '/about',
    title: 'About',
    root: placeholderRoot,
    nav: { slots: ['header'], order: 4 },
    source: `<section class="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2">
  <div class="nw-rise">
    <span class="text-sm font-semibold uppercase tracking-wide text-primary">{{edit "ab_eyebrow" "About us"}}</span>
    <h1 class="mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl">{{edit "ab_h1" "A small, senior team — by design"}}</h1>
    <p class="mt-5 text-lg text-base-content/70">{{edit "ab_p1" "Northwind is a boutique studio of designers and engineers who’d rather do a few projects brilliantly than many adequately. No juniors learning on your dime, no layers of account managers — just the people doing the work."}}</p>
    <p class="mt-4 text-base-content/70">{{edit "ab_p2" "We believe a great website is the hardest-working member of your team: fast, clear, and quietly persuasive. That belief shapes every decision we make."}}</p>
  </div>
  <div class="nw-zoom overflow-hidden rounded-3xl border border-base-200 shadow-xl">
    <img src="https://picsum.photos/seed/nw-studio/800/700" alt="The Northwind studio" class="h-full w-full object-cover" loading="lazy" />
  </div>
</section>

<section class="bg-base-200">
  <div class="mx-auto max-w-6xl px-6 py-20">
    <h2 class="text-3xl font-bold tracking-tight">{{edit "val_title" "What we value"}}</h2>
    <div class="nw-stagger mt-10 grid gap-6 md:grid-cols-3">
      <div class="rounded-2xl bg-base-100 p-7 shadow-sm"><span class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('star', 'h-5 w-5')}</span><h3 class="mt-4 text-lg font-bold">{{edit "v1_t" "Craft over churn"}}</h3><p class="mt-2 text-base-content/60">{{edit "v1_b" "We sweat the details most teams skip — because details are what people feel."}}</p></div>
      <div class="rounded-2xl bg-base-100 p-7 shadow-sm"><span class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('arrow-up-right', 'h-5 w-5')}</span><h3 class="mt-4 text-lg font-bold">{{edit "v2_t" "Speed is a feature"}}</h3><p class="mt-2 text-base-content/60">{{edit "v2_b" "Every site we ship is static, optimized, and built to load instantly."}}</p></div>
      <div class="rounded-2xl bg-base-100 p-7 shadow-sm"><span class="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">${icon('check', 'h-5 w-5')}</span><h3 class="mt-4 text-lg font-bold">{{edit "v3_t" "Plain dealing"}}</h3><p class="mt-2 text-base-content/60">{{edit "v3_b" "Fixed scopes, clear timelines, and honest advice — even when it costs us the upsell."}}</p></div>
    </div>
  </div>
</section>

<section class="mx-auto max-w-6xl px-6 py-20">
  <h2 class="text-3xl font-bold tracking-tight">{{edit "team_title" "The people you’ll work with"}}</h2>
  <div class="nw-stagger mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
    {{#each data.team}}
    <div class="text-center">
      <div class="mx-auto aspect-square w-36 overflow-hidden rounded-full border-4 border-base-100 shadow-lg nw-zoom"><img src="{{url values.photo}}" alt="{{values.name}}" class="h-full w-full object-cover" loading="lazy" /></div>
      <h3 class="mt-4 font-bold">{{values.name}}</h3>
      <p class="text-sm text-primary">{{values.role}}</p>
      <p class="mt-1 text-sm text-base-content/50">{{values.bio}}</p>
    </div>
    {{/each}}
  </div>
</section>`,
  },

  // ---------------------------------------------------------------- CONTACT (block-tree: hosts the Form block)
  {
    id: 'contact',
    path: '/contact',
    title: 'Contact',
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
];
