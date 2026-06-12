import type { Page } from '@sitewright/schema';


// ---------------------------------------------------------------- BLOG (content-only templates)
// A page-tree blog: the overview uses global:blog-overview ({{#each page.children}} with
// {{sw-date}} + {{sw-truncate}} per card), each article global:blog-article (every field a
// data-sw-*="data.*" in-preview-editable leaf). No code — the content lives entirely in each
// page's `data`, which is also exactly what a locale variant overrides (fully translated posts).
export function pagesBlog(assets: Record<string, string>): Page[] {
  return [
  {
    id: 'blog',
    path: 'blog',
    title: 'Blog',
    parent: 'home',
    nav: { title: 'Blog', slots: ['header'], order: 5 },
    template: 'global:blog-overview',
    description: 'Notes on web design, performance, and building sites that earn their keep.',
    data: { heading: 'From the studio', intro: 'Notes on web design, performance, and building sites that earn their keep.' },
  },
  {
    id: 'blog-static-speed',
    path: 'why-static-sites-win',
    title: 'Why static sites win on speed',
    parent: 'blog',
    template: 'global:blog-article',
    order: 1,
    description: 'A static-first build keeps your site fast, cheap to host, and effortless to maintain.',
    data: {
      article_kicker: 'Performance',
      article_title: 'Why static sites win on speed',
      article_excerpt: 'A static-first build keeps your site fast, cheap to host, and effortless to maintain.',
      article_date: '2026-05-28',
      article_image: assets['blog-speed'] ?? '',
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
    parent: 'blog',
    template: 'global:blog-article',
    order: 2,
    description: 'Tokens and reusable components keep a growing site consistent — and fast to build.',
    data: {
      article_kicker: 'Design',
      article_title: 'Design systems that scale',
      article_excerpt: 'Tokens and reusable components keep a growing site consistent — and fast to build.',
      article_date: '2026-04-14',
      article_image: assets['blog-design'] ?? '',
      article_body:
        '<p>A design system is the shared vocabulary between design and code: colour tokens, type scales, spacing, and a library of components everyone reaches for.</p>' +
        '<p>The payoff compounds. Once the building blocks exist, new pages are assembled in hours, and a brand tweak ripples everywhere from a single change.</p>',
    },
  },
  {
    id: 'blog-seo-foundations',
    path: 'seo-foundations',
    title: 'SEO foundations, from day one',
    parent: 'blog',
    template: 'global:blog-article',
    order: 3,
    description: 'Clean markup, structured data, and fast pages are the SEO basics that actually move rankings.',
    data: {
      article_kicker: 'SEO',
      article_title: 'SEO foundations, from day one',
      article_excerpt: 'Clean markup, structured data, and fast pages are the basics that actually move rankings.',
      article_date: '2026-03-02',
      article_image: assets['blog-seo'] ?? '',
      article_body:
        '<p>SEO is not a bolt-on. The fast, accessible, semantically-marked-up site you launch is the one search engines reward.</p>' +
        '<h2>Get the basics right</h2>' +
        '<ul><li>Descriptive titles and meta descriptions</li><li>A clean, crawlable URL structure</li><li>Structured data and an accurate sitemap</li></ul>',
    },
  },
  ];
}
