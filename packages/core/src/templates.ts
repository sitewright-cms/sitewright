// CODE-FIRST page templates: a page referencing a template renders the
// TEMPLATE's Handlebars source (its own {{edit}} content fills the regions).
// The legacy block-tree template model (Outlet wrap) is retired.
import type { Template } from '@sitewright/schema';
import { TemplateResolutionError } from './errors.js';

/** Prefix marking a built-in platform template reference (`Page.template`). */
export const GLOBAL_TEMPLATE_PREFIX = 'global:';

/**
 * Built-in page templates, referenced as `global:<key>` — available to every
 * project without setup. Sources follow the same authoring rules as pages
 * (validated Handlebars + Tailwind/DaisyUI, no scripts) and expose their text
 * through {{edit}} regions so a referencing page stays fully content-editable.
 */
export const GLOBAL_TEMPLATES: readonly Template[] = [
  {
    id: 'global:landing',
    name: 'Landing page (global)',
    source: `<div class="hero min-h-[60vh] bg-base-200">
  <div class="hero-content text-center">
    <div class="max-w-xl">
      <h1 class="text-5xl font-bold" data-aos="fade-up" data-sw-text="headline">A clear, bold promise</h1>
      <p class="py-6 text-base-content/70" data-aos="fade-up" data-aos-delay="150" data-sw-text="subline">One supporting sentence that earns the click.</p>
      <a class="btn btn-primary" href="{{sw-url "/contact"}}" data-sw-text="cta">Get in touch</a>
    </div>
  </div>
</div>
<section class="mx-auto grid max-w-5xl gap-6 px-6 py-16 md:grid-cols-3">
  <div class="card bg-base-100 shadow-sm" data-aos="fade-up"><div class="card-body"><h2 class="card-title" data-sw-text="f1_title">First benefit</h2><p data-sw-text="f1_text">Why it matters to the visitor.</p></div></div>
  <div class="card bg-base-100 shadow-sm" data-aos="fade-up" data-aos-delay="100"><div class="card-body"><h2 class="card-title" data-sw-text="f2_title">Second benefit</h2><p data-sw-text="f2_text">Why it matters to the visitor.</p></div></div>
  <div class="card bg-base-100 shadow-sm" data-aos="fade-up" data-aos-delay="200"><div class="card-body"><h2 class="card-title" data-sw-text="f3_title">Third benefit</h2><p data-sw-text="f3_text">Why it matters to the visitor.</p></div></div>
</section>`,
  },
  {
    id: 'global:text',
    name: 'Text page (global)',
    source: `<article class="prose mx-auto max-w-3xl px-6 py-16">
  <h1 data-sw-text="heading">Page heading</h1>
  <p data-sw-text="body">Write the page text here. This simple template suits legal pages, about pages, and announcements.</p>
</article>`,
  },
  {
    // A content-only BLOG ARTICLE: every field is an in-preview-editable `data-sw-*="page.data.<key>"`
    // leaf bound to the page's own page.data, seeded from `data` below when the template is enabled.
    id: 'global:blog-article',
    name: 'Blog article (global)',
    source: `<article class="prose mx-auto max-w-3xl px-6 py-16">
  <p class="not-prose mb-2 text-sm uppercase tracking-wide text-base-content/50" data-sw-text="page.data.article_kicker">Article</p>
  <h1 data-sw-text="page.data.article_title">Your article title</h1>
  <p class="lead text-base-content/70" data-sw-text="page.data.article_excerpt">A one-sentence summary that draws the reader in.</p>
  <div class="not-prose my-6 aspect-video w-full overflow-hidden rounded-2xl bg-base-200 bg-cover bg-center" data-sw-bg="page.data.article_image"></div>
  <div data-sw-html="page.data.article_body"><p>Write the article here. Use the toolbar to format.</p></div>
</article>`,
    data: {
      article_kicker: 'Article',
      article_title: 'Your article title',
      article_excerpt: 'A one-sentence summary that draws the reader in.',
      article_image: '',
      article_body: '<p>Write the article here. Use the toolbar to format.</p>',
    },
  },
  {
    // A BLOG OVERVIEW: lists this page's child pages (the articles) as a card grid. Reads each
    // child's flattened fields + its own page.data (excerpt). The two headings are editable leaves.
    id: 'global:blog-overview',
    name: 'Blog overview (global)',
    source: `<section class="mx-auto max-w-5xl px-6 py-20">
  <h1 class="mb-3 text-4xl font-bold tracking-tight sm:text-5xl" data-sw-text="page.data.heading">From the blog</h1>
  <p class="mb-12 max-w-2xl text-lg text-base-content/60" data-sw-text="page.data.intro">News, guides, and updates.</p>
  <div class="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
    {{#each page.children}}
    <a class="card group overflow-hidden border border-base-200 bg-base-100 no-underline shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl" href="{{sw-url path}}">
      {{#if data.article_image}}<figure class="overflow-hidden"><img src="{{sw-url data.article_image}}" alt="{{title}}" class="aspect-video w-full object-cover transition-transform duration-500 group-hover:scale-105"></figure>{{/if}}
      <div class="card-body">
        {{#if data.article_date}}<time class="font-mono text-xs text-base-content/40">{{sw-date data.article_date}}</time>{{/if}}
        <h2 class="card-title tracking-tight">{{title}}</h2>
        <p class="text-sm leading-relaxed text-base-content/60">{{sw-truncate data.article_excerpt 120}}</p>
      </div>
    </a>
    {{/each}}
  </div>
</section>`,
    data: {
      heading: 'From the blog',
      intro: 'News, guides, and updates.',
    },
  },
  {
    // A MINI SHOP storefront: a product grid from the `products` dataset, each card with a first-party
    // {{sw-add-to-cart}} button, plus the {{sw-cart}} mount (the floating cart + drawer). The cart is
    // FRONT-END only — it builds an order in localStorage and hands it to a submission channel
    // (WhatsApp / mailto / payment link) configured in Website settings (website.shop). Prices are
    // NON-AUTHORITATIVE (a front-end inquiry). The two headings are editable page.data leaves; the cart
    // drawer's labels auto-localize from the translation catalog (reserved cart_* keys) — bare {{sw-cart}}.
    id: 'global:shop',
    name: 'Shop (global)',
    source: `<section class="mx-auto max-w-6xl px-6 py-20">
  <header class="mb-14 text-center">
    <h1 class="text-4xl font-bold tracking-tight sm:text-5xl" data-sw-text="page.data.heading">Shop</h1>
    <p class="mx-auto mt-4 max-w-xl text-lg text-base-content/60" data-sw-text="page.data.intro">Browse our products and build your order.</p>
  </header>
  <div class="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
    {{#each data.products}}
    <div class="card group overflow-hidden border border-base-200 bg-base-100 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl">
      {{#if image}}<figure class="aspect-square overflow-hidden bg-base-200"><img src="{{sw-url image}}" alt="{{name}}" class="h-full w-full object-cover transition duration-500 group-hover:scale-105"></figure>{{/if}}
      <div class="card-body gap-2">
        <h2 class="card-title text-base tracking-tight">{{name}}</h2>
        <p class="text-sm leading-relaxed text-base-content/60">{{description}}</p>
        <div class="mt-2 flex items-center justify-between gap-3">
          <span class="text-xl font-bold tracking-tight">{{@root.website.shop.currency.symbol}}{{price}}</span>
          {{sw-add-to-cart sku=sku name=name price=price image=image class="btn btn-primary btn-sm rounded-full px-4"}}
        </div>
      </div>
    </div>
    {{/each}}
  </div>
  {{sw-cart}}
</section>`,
    data: {
      heading: 'Shop',
      intro: 'Browse our products and build your order.',
    },
  },
];

/** Whether a `Page.template` reference points at a built-in global template. */
export function isGlobalTemplate(ref: string): boolean {
  return ref.startsWith(GLOBAL_TEMPLATE_PREFIX);
}

/** The built-in globals as a resolver map (keyed by the full `global:<id>` reference). */
const BUILTIN_GLOBAL_TEMPLATE_MAP: ReadonlyMap<string, Template> = new Map(GLOBAL_TEMPLATES.map((t) => [t.id, t]));

/**
 * Resolves a `Page.template` reference to its Handlebars source: global templates by prefix
 * (from `globalTemplates`, keyed by the full `global:<id>` ref — defaults to the built-in constants
 * so existing callers/tests are unchanged; the API/publish path passes the runtime, admin-edited
 * global library), otherwise the project's own template entities. Throws
 * {@link TemplateResolutionError} for an unknown reference (an author-correctable publish error —
 * never silently render a blank page).
 */
export function resolveTemplateSource(
  ref: string,
  projectTemplates: ReadonlyMap<string, Template>,
  globalTemplates: ReadonlyMap<string, Template> = BUILTIN_GLOBAL_TEMPLATE_MAP,
): string {
  const template = isGlobalTemplate(ref) ? globalTemplates.get(ref) : projectTemplates.get(ref);
  if (template === undefined) {
    throw new TemplateResolutionError(`unknown template: ${ref}`);
  }
  return template.source;
}
