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
      <h1 class="text-5xl font-bold" data-aos="fade-up">{{edit "headline" "A clear, bold promise"}}</h1>
      <p class="py-6 text-base-content/70" data-aos="fade-up" data-aos-delay="150">{{edit "subline" "One supporting sentence that earns the click."}}</p>
      <a class="btn btn-primary" href="{{url "/contact"}}">{{edit "cta" "Get in touch"}}</a>
    </div>
  </div>
</div>
<section class="mx-auto grid max-w-5xl gap-6 px-6 py-16 md:grid-cols-3">
  <div class="card bg-base-100 shadow-sm" data-aos="fade-up"><div class="card-body"><h2 class="card-title">{{edit "f1_title" "First benefit"}}</h2><p>{{edit "f1_text" "Why it matters to the visitor."}}</p></div></div>
  <div class="card bg-base-100 shadow-sm" data-aos="fade-up" data-aos-delay="100"><div class="card-body"><h2 class="card-title">{{edit "f2_title" "Second benefit"}}</h2><p>{{edit "f2_text" "Why it matters to the visitor."}}</p></div></div>
  <div class="card bg-base-100 shadow-sm" data-aos="fade-up" data-aos-delay="200"><div class="card-body"><h2 class="card-title">{{edit "f3_title" "Third benefit"}}</h2><p>{{edit "f3_text" "Why it matters to the visitor."}}</p></div></div>
</section>`,
  },
  {
    id: 'global:text',
    name: 'Text page (global)',
    source: `<article class="prose mx-auto max-w-3xl px-6 py-16">
  <h1>{{edit "heading" "Page heading"}}</h1>
  <p>{{edit "body" "Write the page text here. This simple template suits legal pages, about pages, and announcements."}}</p>
</article>`,
  },
  {
    // A content-only BLOG ARTICLE: every field is an in-preview-editable `data-sw-*="data.<key>"`
    // leaf bound to the page's own page.data, seeded from `data` below when the template is enabled.
    id: 'global:blog-article',
    name: 'Blog article (global)',
    source: `<article class="prose mx-auto max-w-3xl px-6 py-16">
  <p class="not-prose mb-2 text-sm uppercase tracking-wide text-base-content/50" data-sw-text="data.article_kicker">Article</p>
  <h1 data-sw-text="data.article_title">Your article title</h1>
  <p class="lead text-base-content/70" data-sw-text="data.article_excerpt">A one-sentence summary that draws the reader in.</p>
  <div class="not-prose my-6 aspect-video w-full overflow-hidden rounded-2xl bg-base-200 bg-cover bg-center" data-sw-bg="data.article_image"></div>
  <div data-sw-html="data.article_body"><p>Write the article here. Use the toolbar to format.</p></div>
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
    source: `<section class="mx-auto max-w-5xl px-6 py-16">
  <h1 class="mb-2 text-4xl font-bold" data-sw-text="data.heading">From the blog</h1>
  <p class="mb-10 text-base-content/60" data-sw-text="data.intro">News, guides, and updates.</p>
  <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {{#each page.children}}
    <a class="card bg-base-100 shadow-sm transition hover:shadow-md" href="{{url path}}">
      {{#if data.article_image}}<figure><img src="{{url data.article_image}}" alt="{{title}}" class="aspect-video w-full object-cover"></figure>{{/if}}
      <div class="card-body">
        <h2 class="card-title">{{title}}</h2>
        <p class="text-sm text-base-content/60">{{data.article_excerpt}}</p>
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
];

/** Whether a `Page.template` reference points at a built-in global template. */
export function isGlobalTemplate(ref: string): boolean {
  return ref.startsWith(GLOBAL_TEMPLATE_PREFIX);
}

/**
 * Resolves a `Page.template` reference to its Handlebars source: built-in
 * globals by prefix, otherwise the project's template entities. Throws
 * {@link TemplateResolutionError} for an unknown reference (an author-correctable
 * publish error — never silently render a blank page).
 */
export function resolveTemplateSource(
  ref: string,
  projectTemplates: ReadonlyMap<string, Template>,
): string {
  const template = isGlobalTemplate(ref)
    ? GLOBAL_TEMPLATES.find((t) => t.id === ref)
    : projectTemplates.get(ref);
  if (template === undefined) {
    throw new TemplateResolutionError(`unknown template: ${ref}`);
  }
  return template.source;
}
