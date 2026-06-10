// AOS scroll-reveal effect names. Inlined (not imported from @sitewright/blocks) so the
// main editor bundle doesn't pull the blocks barrel — which would drag the full Lucide
// icon set in too. `catalog-icons.test.ts` asserts this stays in sync with the source.
const ANIMATION_EFFECTS: readonly string[] = [
  'fade', 'fade-up', 'fade-down', 'fade-left', 'fade-right',
  'zoom-in', 'zoom-out', 'slide-up', 'slide-down', 'slide-left', 'slide-right',
  'flip-up', 'flip-down', 'flip-left', 'flip-right',
];

// The Library catalog: a static, searchable reference of everything the platform
// gives an author — icons, the AOS / lazyload / ripple vocabularies, and a curated
// set of DaisyUI components. Each entry carries a copy-paste `example` snippet.
// The icon set is large + self-contained, so it lives in `catalog-icons.ts` and is
// LAZY-loaded (dynamic import) the first time the Icons modal opens.

export type LibraryCategory = 'icons' | 'brand' | 'flags' | 'fonts' | 'aos' | 'lazyload' | 'ripple' | 'daisyui';

export interface LibraryItem {
  /** Stable id (category-scoped). */
  id: string;
  /** Display name (also the primary search term). */
  name: string;
  /** Extra keywords for search. */
  keywords?: string;
  /** One-line description. */
  description: string;
  /**
   * The copy-paste example markup. MUST stay STATIC, trusted, in-repo content — it is
   * rendered as a live preview via `dangerouslySetInnerHTML` (Handlebars neutralized). Never
   * put `<script>`, event handlers, or user-supplied data here (would need DOMPurify first).
   */
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
  /** Eagerly-bundled items. The `icons` section is empty here and lazy-loaded on open. */
  items: LibraryItem[];
  /** When set, the section's items are fetched via dynamic import (code-split). */
  lazy?: 'icons' | 'brand' | 'flags';
  /** DaisyUI items render a live preview in the modal (themed via `.sw-preview`). */
  preview?: boolean;
}

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
    name: 'Image swap (data-src)',
    keywords: 'lazyload lazy image data-src data-srcset',
    description: 'Lazy <img>: put the URL in data-src (no class needed) and the runtime swaps it to src on scroll-in, with a blur-up fade.',
    example: '<img data-src="/media/<id>/<file>" alt="…" width="800" height="450" />',
  },
  {
    id: 'lazy-img-skeleton',
    name: 'Lazy image + skeleton',
    keywords: 'lazyload lazy image skeleton placeholder shimmer height data-src',
    description: 'Fixed-height lazy image with a DaisyUI skeleton shimmer until it loads, then the image fades in over it.',
    example:
      '<div class="skeleton h-64 w-full overflow-hidden rounded-box">\n  <img data-src="/media/<id>/<file>" alt="…" width="800" height="450" class="h-full w-full object-cover" />\n</div>',
  },
  {
    id: 'lazy-iframe',
    name: 'Lazy iframe (native)',
    keywords: 'lazyload lazy iframe embed map video skeleton loading',
    description: 'Native loading="lazy" defers the embed and works without JS; the skeleton shimmers behind it until it paints.',
    example: '<iframe src="…" loading="lazy" class="skeleton" width="560" height="315" title="…"></iframe>',
  },
  {
    id: 'lazy-iframe-defer',
    name: 'Lazy iframe (data-src)',
    keywords: 'lazyload lazy iframe embed data-src defer skeleton',
    description: 'Defer the embed until near the viewport — the runtime swaps data-src → src on scroll-in. Needs JS; wrap in a skeleton for the loading state.',
    example:
      '<div class="skeleton w-full overflow-hidden rounded-box" style="aspect-ratio:16/9">\n  <iframe data-src="…" class="h-full w-full" title="…"></iframe>\n</div>',
  },
  {
    id: 'lazy-native',
    name: 'Native lazy <img>',
    keywords: 'lazy loading native img',
    description: 'For a plain image, native loading="lazy" is the best default — no runtime needed (the image pipeline adds a blur-up placeholder).',
    example: '<img src="/media/<id>/<file>" alt="…" width="800" height="450" loading="lazy" />',
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

/** A DaisyUI component reference (id derives from the name; `daisyui` keyword is implicit). */
const daisy = (name: string, keywords: string, description: string, example: string): LibraryItem => ({
  id: `daisy-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  name,
  keywords: `daisyui component ${keywords}`,
  description,
  example,
});

// A broad slice of the DaisyUI v5 component library (CSS-only patterns favoured — the
// platform forbids page JS; JS-driven components are shown as static markup).
const DAISYUI_ITEMS: LibraryItem[] = [
  // --- Actions ---
  daisy('Button', 'btn cta link', 'Variants: btn-primary/-secondary/-accent/-neutral/-ghost/-outline/-link/-soft; sizes btn-xs/-sm/-lg/-xl; btn-circle/-square/-block.', '<a class="btn btn-primary" href="/contact">Contact us</a>'),
  daisy('Button group (join)', 'join group buttons segmented', 'Group buttons/inputs into one bar.', '<div class="join">\n  <button class="btn join-item">One</button>\n  <button class="btn join-item btn-active">Two</button>\n  <button class="btn join-item">Three</button>\n</div>'),
  daisy('Dropdown', 'dropdown menu popover', 'CSS-only dropdown via <details> (no JS).', '<details class="dropdown">\n  <summary class="btn">Menu</summary>\n  <ul class="menu dropdown-content bg-base-100 rounded-box z-10 w-52 p-2 shadow">\n    <li><a href="/about">About</a></li>\n    <li><a href="/contact">Contact</a></li>\n  </ul>\n</details>'),
  daisy('Modal', 'modal dialog popup', 'Native <dialog> modal (CSS-only open via anchor).', '<dialog class="modal" open>\n  <div class="modal-box">\n    <h3 class="text-lg font-bold">Hello!</h3>\n    <p class="py-4">Modal content.</p>\n  </div>\n</dialog>'),
  daisy('Swap', 'swap toggle icon', 'Swap between two states with a checkbox (CSS-only).', '<label class="swap swap-rotate">\n  <input type="checkbox" />\n  <div class="swap-on">ON</div>\n  <div class="swap-off">OFF</div>\n</label>'),
  daisy('Theme controller', 'theme dark light toggle', 'Toggle the page theme with a checkbox (no JS).', '<input type="checkbox" value="dark" class="toggle theme-controller" />'),
  // --- Data display ---
  daisy('Card', 'card panel tile', 'Content card with a body, optional figure + actions.', '<div class="card bg-base-100 w-80 shadow-xl">\n  <div class="card-body">\n    <h2 class="card-title">Title</h2>\n    <p>Body text.</p>\n    <div class="card-actions justify-end"><a class="btn btn-primary" href="/contact">Buy</a></div>\n  </div>\n</div>'),
  daisy('Avatar', 'avatar profile image', 'User/profile image; avatar-group + online/offline.', '<div class="avatar">\n  <div class="w-16 rounded-full"><img src="https://i.pravatar.cc/96" alt="" /></div>\n</div>'),
  daisy('Badge', 'badge tag pill chip', 'Small label. Variants badge-primary…/-outline/-soft; sizes badge-sm/-lg.', '<span class="badge badge-primary">New</span>'),
  daisy('Carousel', 'carousel slider gallery', 'Scroll-snap image carousel (CSS-only).', '<div class="carousel rounded-box w-64">\n  <div class="carousel-item w-full"><img src="https://picsum.photos/seed/a/400/200" alt="" /></div>\n  <div class="carousel-item w-full"><img src="https://picsum.photos/seed/b/400/200" alt="" /></div>\n</div>'),
  daisy('Chat bubble', 'chat message bubble', 'Conversation bubbles (chat-start / chat-end).', '<div class="chat chat-start">\n  <div class="chat-bubble">Hi there!</div>\n</div>\n<div class="chat chat-end">\n  <div class="chat-bubble chat-bubble-primary">Hello 👋</div>\n</div>'),
  daisy('Collapse / Accordion', 'collapse accordion faq', 'CSS-only collapsible (great for FAQs).', '<div class="collapse collapse-arrow bg-base-100 border border-base-300">\n  <input type="checkbox" />\n  <div class="collapse-title font-medium">Question?</div>\n  <div class="collapse-content"><p>Answer.</p></div>\n</div>'),
  daisy('Countdown', 'countdown timer number', 'Animated number transitions (set --value).', '<span class="countdown font-mono text-4xl"><span style="--value:42;">42</span></span>'),
  daisy('Diff', 'diff compare before after', 'Side-by-side before/after comparison.', '<figure class="diff aspect-16/9 w-80" tabindex="0">\n  <div class="diff-item-1"><div class="bg-primary text-primary-content grid place-content-center">BEFORE</div></div>\n  <div class="diff-item-2"><div class="bg-base-200 grid place-content-center">AFTER</div></div>\n  <div class="diff-resizer"></div>\n</figure>'),
  daisy('Kbd', 'kbd keyboard key', 'Keyboard key hint.', '<p>Press <kbd class="kbd">Ctrl</kbd> + <kbd class="kbd">S</kbd> to save.</p>'),
  daisy('List', 'list rows vertical', 'A vertical list of rows.', '<ul class="list bg-base-100 rounded-box shadow-md">\n  <li class="list-row"><div>Item one</div></li>\n  <li class="list-row"><div>Item two</div></li>\n</ul>'),
  daisy('Stat / Stats', 'stats metrics kpi numbers', 'A row of headline metrics.', '<div class="stats shadow">\n  <div class="stat">\n    <div class="stat-title">Projects</div>\n    <div class="stat-value text-primary">120+</div>\n    <div class="stat-desc">21% more than last year</div>\n  </div>\n</div>'),
  daisy('Status', 'status dot indicator', 'A tiny status dot.', '<span class="inline-grid *:[grid-area:1/1]"><span class="status status-success"></span> Online</span>'),
  daisy('Table', 'table data grid rows', 'Data table; table-zebra / table-pin-rows.', '<table class="table table-zebra">\n  <thead><tr><th>Name</th><th>Role</th></tr></thead>\n  <tbody><tr><td>Mara</td><td>Design</td></tr><tr><td>Devon</td><td>Engineering</td></tr></tbody>\n</table>'),
  daisy('Timeline', 'timeline steps history', 'Vertical/horizontal timeline.', '<ul class="timeline timeline-vertical">\n  <li><div class="timeline-start">2021</div><div class="timeline-middle">●</div><div class="timeline-end timeline-box">Founded</div><hr/></li>\n  <li><hr/><div class="timeline-start">2024</div><div class="timeline-middle">●</div><div class="timeline-end timeline-box">100 sites</div></li>\n</ul>'),
  // --- Navigation ---
  daisy('Breadcrumbs', 'breadcrumbs path nav', 'Hierarchical path links.', '<div class="breadcrumbs text-sm">\n  <ul><li><a href="/">Home</a></li><li><a href="/services">Services</a></li><li>Web Design</li></ul>\n</div>'),
  daisy('Dock', 'dock bottom-nav mobile', 'Bottom navigation bar (mobile).', '<div class="dock">\n  <button class="dock-active"><span class="dock-label">Home</span></button>\n  <button><span class="dock-label">Search</span></button>\n</div>'),
  daisy('Link', 'link anchor text', 'Styled text link (link-hover / link-primary).', '<a class="link link-primary" href="/about">About us</a>'),
  daisy('Menu', 'menu nav list sidebar', 'Vertical/horizontal menu (with submenus).', '<ul class="menu bg-base-200 rounded-box w-56">\n  <li><a href="/">Home</a></li>\n  <li><a href="/services">Services</a></li>\n</ul>'),
  daisy('Navbar', 'navbar header topnav', 'Top navigation bar (start/center/end).', '<div class="navbar bg-base-100 shadow-sm">\n  <div class="navbar-start"><a class="btn btn-ghost text-xl" href="/">{{ company.name }}</a></div>\n  <div class="navbar-end"><a class="btn btn-primary" href="/contact">Contact</a></div>\n</div>'),
  daisy('Pagination', 'pagination pages join', 'Page navigation via a join group.', '<div class="join">\n  <button class="join-item btn">«</button>\n  <button class="join-item btn btn-active">1</button>\n  <button class="join-item btn">2</button>\n  <button class="join-item btn">»</button>\n</div>'),
  daisy('Steps', 'steps wizard progress', 'A step indicator.', '<ul class="steps">\n  <li class="step step-primary">Discover</li>\n  <li class="step step-primary">Design</li>\n  <li class="step">Build</li>\n  <li class="step">Launch</li>\n</ul>'),
  daisy('Tabs', 'tabs tabbed navigation', 'Tab bar (tabs-box / -border / -lift).', '<div class="tabs tabs-box">\n  <a class="tab tab-active">Overview</a>\n  <a class="tab">Pricing</a>\n  <a class="tab">FAQ</a>\n</div>'),
  // --- Feedback ---
  daisy('Alert', 'alert notice banner', 'Inline alert. alert-info/-success/-warning/-error; alert-soft/-outline.', '<div class="alert alert-info">We’ll reply within one business day.</div>'),
  daisy('Loading', 'loading spinner progress', 'Spinner. loading-spinner/-dots/-ring/-ball/-bars.', '<span class="loading loading-spinner loading-lg text-primary"></span>'),
  daisy('Progress', 'progress bar percent', 'A progress bar.', '<progress class="progress progress-primary w-56" value="70" max="100"></progress>'),
  daisy('Radial progress', 'radial progress ring circle', 'Circular progress (set --value).', '<div class="radial-progress text-primary" style="--value:70;" role="progressbar">70%</div>'),
  daisy('Skeleton', 'skeleton loading placeholder shimmer', 'Animated loading placeholder.', '<div class="flex flex-col gap-3 w-56">\n  <div class="skeleton h-28 w-full"></div>\n  <div class="skeleton h-4 w-28"></div>\n  <div class="skeleton h-4 w-full"></div>\n</div>'),
  daisy('Toast', 'toast notification snackbar', 'Stacked corner notifications.', '<div class="toast toast-end">\n  <div class="alert alert-success">Saved!</div>\n</div>'),
  daisy('Tooltip', 'tooltip hint popover', 'Hover tooltip (data-tip).', '<button class="btn tooltip" data-tip="Helpful hint">Hover me</button>'),
  // --- Data input ---
  daisy('Checkbox', 'checkbox input form', 'A checkbox (checkbox-primary, sizes).', '<input type="checkbox" checked class="checkbox checkbox-primary" />'),
  daisy('File input', 'file input upload', 'File picker input.', '<input type="file" class="file-input file-input-bordered w-full max-w-xs" />'),
  daisy('Fieldset & Label', 'fieldset label legend form', 'A labelled form group.', '<fieldset class="fieldset">\n  <legend class="fieldset-legend">Email</legend>\n  <input type="email" class="input" placeholder="you@company.com" />\n  <p class="label">We’ll never share it.</p>\n</fieldset>'),
  daisy('Input', 'input text field form', 'A text input (input-bordered, sizes, validator).', '<input type="text" placeholder="Your name" class="input input-bordered w-full max-w-xs" />'),
  daisy('Radio', 'radio input form choice', 'A radio button (radio-primary).', '<input type="radio" name="r" class="radio radio-primary" checked />'),
  daisy('Range', 'range slider input', 'A range slider (range-primary, steps).', '<input type="range" min="0" max="100" value="40" class="range range-primary" />'),
  daisy('Rating', 'rating stars review', 'Star rating (CSS-only radios).', '<div class="rating">\n  <input type="radio" name="rate" class="mask mask-star-2 bg-orange-400" />\n  <input type="radio" name="rate" class="mask mask-star-2 bg-orange-400" checked />\n  <input type="radio" name="rate" class="mask mask-star-2 bg-orange-400" />\n</div>'),
  daisy('Select', 'select dropdown form', 'A select menu (select-bordered).', '<select class="select select-bordered w-full max-w-xs">\n  <option disabled selected>Pick one</option>\n  <option>Design</option>\n  <option>Build</option>\n</select>'),
  daisy('Textarea', 'textarea input multiline', 'A multi-line text input.', '<textarea class="textarea textarea-bordered" placeholder="Your message"></textarea>'),
  daisy('Toggle', 'toggle switch checkbox', 'A switch (toggle-primary, sizes).', '<input type="checkbox" checked class="toggle toggle-primary" />'),
  daisy('Validator', 'validator form validation', 'Native-validation styling for inputs.', '<input type="email" class="input validator" required placeholder="email" />'),
  // --- Layout ---
  daisy('Divider', 'divider separator rule', 'A labelled divider (vertical/horizontal).', '<div class="divider">OR</div>'),
  daisy('Drawer', 'drawer sidebar offcanvas', 'Sidebar layout (CSS-only toggle).', '<div class="drawer">\n  <input id="d" type="checkbox" class="drawer-toggle" />\n  <div class="drawer-content"><label for="d" class="btn btn-primary drawer-button">Open</label></div>\n  <div class="drawer-side"><ul class="menu bg-base-200 min-h-full w-64 p-4"><li><a href="/">Home</a></li></ul></div>\n</div>'),
  daisy('Footer', 'footer site bottom', 'Multi-column footer (goes in the Footer slot, which the skeleton wraps in <footer id="footer">).', '<div class="footer bg-neutral text-neutral-content p-10">\n  <div><h6 class="footer-title">Company</h6><a class="link link-hover" href="/about">About</a></div>\n</div>'),
  daisy('Hero', 'hero banner header', 'Full-width hero banner.', '<div class="hero bg-base-200 min-h-[60vh]">\n  <div class="hero-content text-center"><div class="max-w-xl">\n    <h1 class="text-5xl font-bold">Headline</h1>\n    <p class="py-6">Supporting copy.</p>\n    <a class="btn btn-primary" href="/contact">Get started</a>\n  </div></div>\n</div>'),
  daisy('Indicator', 'indicator badge corner', 'Place an element on a corner.', '<div class="indicator">\n  <span class="indicator-item badge badge-primary">9</span>\n  <button class="btn">Inbox</button>\n</div>'),
  daisy('Join', 'join group attach', 'Visually join children into one unit.', '<div class="join">\n  <input class="input join-item" placeholder="Search"/>\n  <button class="btn btn-primary join-item">Go</button>\n</div>'),
  daisy('Mask', 'mask shape clip image', 'Clip an element to a shape.', '<img class="mask mask-squircle w-24" src="https://picsum.photos/seed/m/96" alt="" />'),
  daisy('Stack', 'stack layered cards pile', 'Stack elements on top of each other.', '<div class="stack">\n  <div class="card bg-primary text-primary-content w-40 h-24 grid place-content-center">1</div>\n  <div class="card bg-secondary text-secondary-content w-40 h-24"></div>\n</div>'),
  // --- Mockup ---
  daisy('Mockup browser', 'mockup browser window screenshot', 'A browser window frame.', '<div class="mockup-browser border-base-300 border w-80">\n  <div class="mockup-browser-toolbar"><div class="input">https://acme.com</div></div>\n  <div class="bg-base-200 grid h-32 place-content-center">Hello!</div>\n</div>'),
  daisy('Mockup code', 'mockup code terminal snippet', 'A code/terminal block.', '<div class="mockup-code w-80">\n  <pre data-prefix="$"><code>npm run build</code></pre>\n</div>'),
  daisy('Mockup phone', 'mockup phone device iphone', 'A phone device frame.', '<div class="mockup-phone">\n  <div class="mockup-phone-camera"></div>\n  <div class="mockup-phone-display grid place-content-center">App</div>\n</div>'),
  daisy('Mockup window', 'mockup window app frame', 'An app window frame.', '<div class="mockup-window border-base-300 border w-80">\n  <div class="bg-base-200 grid h-32 place-content-center">Hello!</div>\n</div>'),
];

export const LIBRARY_SECTIONS: LibrarySection[] = [
  { category: 'icons', label: 'Icons', blurb: 'The full Lucide icon set. Insert with {{sw-icon "name"}} — searchable by name + keyword.', items: [], lazy: 'icons' },
  { category: 'brand', label: 'Brand icons', blurb: 'Brand / social logos. Insert with {{sw-icon "brand:slug"}}.', items: [], lazy: 'brand' },
  { category: 'flags', label: 'Country flags', blurb: 'Full-color country flags. Insert with {{sw-flag "de"}} (rectangular) or {{sw-flag "de-circle"}} (round).', items: [], lazy: 'flags' },
  { category: 'fonts', label: 'Google Fonts', blurb: 'Browse + preview Google Fonts. Pick per-slot fonts in Settings → Typography (self-hosted on select).', items: [] },
  { category: 'aos', label: 'AOS (scroll reveal)', blurb: 'Animate elements as they scroll into view via data-aos.', items: AOS_ITEMS },
  { category: 'lazyload', label: 'Lazy-load', blurb: 'Defer offscreen images with data-bg / lazyload.', items: LAZYLOAD_ITEMS },
  { category: 'ripple', label: 'Ripple effect', blurb: 'Material “waves” click ripple via waves-effect.', items: RIPPLE_ITEMS },
  { category: 'daisyui', label: 'DaisyUI components', blurb: 'Brand-themed component classes (Tailwind + DaisyUI).', items: DAISYUI_ITEMS, preview: true },
];
