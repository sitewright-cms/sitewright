import { ANIMATION_EFFECTS, ICON_NAMES, iconBody } from '@sitewright/blocks';

// The Library catalog: a static, searchable reference of everything the platform
// gives an author — icons, the AOS / lazyload / ripple vocabularies, and a curated
// set of DaisyUI components. Each entry carries a copy-paste `example` snippet.

export type LibraryCategory = 'icons' | 'aos' | 'lazyload' | 'ripple' | 'daisyui';

export interface LibraryItem {
  /** Stable id (category-scoped). */
  id: string;
  /** Display name (also the primary search term). */
  name: string;
  /** Extra keywords for search. */
  keywords?: string;
  /** One-line description. */
  description: string;
  /** The copy-paste example markup. */
  example: string;
  /** Optional inline SVG preview (icons only). */
  svg?: string;
  /** Optional external docs link. */
  docsUrl?: string;
}

export interface LibrarySection {
  category: LibraryCategory;
  label: string;
  blurb: string;
  items: LibraryItem[];
}

/** Wrap an icon body in the same <svg> the {{icon}} helper emits, for the preview. */
function iconSvg(name: string, cls = 'h-6 w-6'): string {
  const body = iconBody(name) ?? '';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

const ICON_ITEMS: LibraryItem[] = ICON_NAMES.map((name) => ({
  id: `icon-${name}`,
  name,
  keywords: 'icon svg lucide',
  description: `The “${name}” Lucide icon, inlined as an SVG.`,
  example: `{{icon "${name}" "h-5 w-5"}}`,
  svg: iconSvg(name),
}));

const AOS_ITEMS: LibraryItem[] = ANIMATION_EFFECTS.map((effect) => ({
  id: `aos-${effect}`,
  name: effect,
  keywords: 'aos animate scroll reveal animation',
  description: `Scroll-reveal “${effect}”. Add optional data-aos-delay (ms), data-aos-duration, data-aos-once="false".`,
  example: `<div data-aos="${effect}" data-aos-delay="0">…</div>`,
}));

const LAZYLOAD_ITEMS: LibraryItem[] = [
  {
    id: 'lazy-bg',
    name: 'Background image (data-bg)',
    keywords: 'lazyload lazy background image data-bg',
    description: 'Lazy-load a background image on any element; the runtime swaps it in on scroll with a blur-up fade.',
    example: '<section class="h-80 bg-cover bg-center" data-bg="/media/<id>/<file>">…</section>',
  },
  {
    id: 'lazy-img',
    name: 'Image swap (lazyload)',
    keywords: 'lazyload lazy image data-src data-srcset',
    description: 'Opt-in lazy <img>: the runtime copies data-src/data-srcset → src/srcset when it scrolls in.',
    example: '<img class="lazyload" data-src="/media/<id>/<file>" alt="…" />',
  },
  {
    id: 'lazy-native',
    name: 'Native lazy <img>',
    keywords: 'lazy loading native img',
    description: 'For a plain image, native loading="lazy" is the best default — no runtime needed.',
    example: '<img src="/media/<id>/<file>" alt="…" loading="lazy" />',
  },
];

const RIPPLE_ITEMS: LibraryItem[] = [
  {
    id: 'ripple-light',
    name: 'Ripple on a primary button',
    keywords: 'ripple waves material click button',
    description: 'Material “waves” click ripple. Use waves-light for a white ripple on dark/colored buttons.',
    example: '<a class="btn btn-primary waves-effect waves-light" href="/contact">Get started</a>',
  },
  {
    id: 'ripple-dark',
    name: 'Ripple on a light button',
    keywords: 'ripple waves material click button',
    description: 'On a light surface, omit waves-light for a subtle dark ripple.',
    example: '<button class="btn waves-effect">Learn more</button>',
  },
];

const DAISYUI_ITEMS: LibraryItem[] = [
  { id: 'daisy-btn', name: 'Button', keywords: 'btn button daisyui', description: 'Brand-themed button. Variants: btn-primary / -secondary / -accent / -ghost / -outline; sizes btn-sm / -lg.', example: '<a class="btn btn-primary" href="/contact">Contact us</a>' },
  { id: 'daisy-card', name: 'Card', keywords: 'card daisyui', description: 'Content card with a body.', example: '<div class="card bg-base-100 shadow-xl">\n  <div class="card-body">\n    <h2 class="card-title">Title</h2>\n    <p>Body text.</p>\n  </div>\n</div>' },
  { id: 'daisy-hero', name: 'Hero', keywords: 'hero daisyui banner', description: 'Full-width hero banner.', example: '<div class="hero min-h-[60vh] bg-base-200">\n  <div class="hero-content text-center">\n    <div class="max-w-xl">\n      <h1 class="text-5xl font-bold">Headline</h1>\n      <p class="py-6">Supporting copy.</p>\n      <a class="btn btn-primary" href="/contact">Get started</a>\n    </div>\n  </div>\n</div>' },
  { id: 'daisy-navbar', name: 'Navbar', keywords: 'navbar nav daisyui', description: 'Top navigation bar.', example: '<div class="navbar bg-base-100">\n  <a class="btn btn-ghost text-xl" href="/">{{ company.name }}</a>\n</div>' },
  { id: 'daisy-alert', name: 'Alert', keywords: 'alert daisyui notice', description: 'Inline alert. Variants: alert-info / -success / -warning / -error.', example: '<div class="alert alert-info">We’ll be in touch within one business day.</div>' },
  { id: 'daisy-badge', name: 'Badge', keywords: 'badge daisyui tag', description: 'Small label/tag.', example: '<span class="badge badge-primary">New</span>' },
  { id: 'daisy-stats', name: 'Stats', keywords: 'stats daisyui metrics', description: 'A row of headline metrics.', example: '<div class="stats shadow">\n  <div class="stat">\n    <div class="stat-title">Projects</div>\n    <div class="stat-value">120+</div>\n  </div>\n</div>' },
  { id: 'daisy-collapse', name: 'Accordion / Collapse', keywords: 'collapse accordion faq daisyui', description: 'CSS-only collapsible (great for FAQs — no JS).', example: '<div class="collapse collapse-arrow bg-base-100">\n  <input type="checkbox" />\n  <div class="collapse-title font-medium">Question?</div>\n  <div class="collapse-content"><p>Answer.</p></div>\n</div>' },
  { id: 'daisy-footer', name: 'Footer', keywords: 'footer daisyui', description: 'Multi-column footer.', example: '<footer class="footer bg-neutral text-neutral-content p-10">\n  <nav>\n    <h6 class="footer-title">Company</h6>\n    <a class="link link-hover" href="/about">About</a>\n  </nav>\n</footer>' },
];

export const LIBRARY_SECTIONS: LibrarySection[] = [
  { category: 'icons', label: 'Icons', blurb: 'Built-in Lucide icons. Insert with {{icon "name"}}.', items: ICON_ITEMS },
  { category: 'aos', label: 'AOS (scroll reveal)', blurb: 'Animate elements as they scroll into view via data-aos.', items: AOS_ITEMS },
  { category: 'lazyload', label: 'Lazy-load', blurb: 'Defer offscreen images with data-bg / lazyload.', items: LAZYLOAD_ITEMS },
  { category: 'ripple', label: 'Ripple effect', blurb: 'Material “waves” click ripple via waves-effect.', items: RIPPLE_ITEMS },
  { category: 'daisyui', label: 'DaisyUI components', blurb: 'Brand-themed component classes (Tailwind + DaisyUI).', items: DAISYUI_ITEMS },
];
