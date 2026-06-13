/**
 * Built-in GLOBAL snippets — platform-shipped starter sections every project can compose with
 * `{{> name}}` (the code-first analogue of the block-tree STARTER_PATTERNS). They surface read-only +
 * copyable in the editor's Snippets rail (above the project's own editable snippets) and are merged
 * into the render's partials so `{{> name}}` resolves in preview AND publish. A project snippet of
 * the same `name` overrides the global.
 *
 * Every source is CSP/validator-safe by construction (no `<script>`, `on*` handlers, `{{{raw}}}`,
 * only literal/`{{sw-url}}` URLs) and uses platform conventions: DaisyUI component classes (brand-themed
 * via `--color-primary`…), `{{ company.* }}` bindings, and `<span data-sw-text="key">default</span>` regions a
 * client may later edit. The editor's `global-snippets.test.ts` runs each through `validateTemplate`,
 * so an unsafe edit here fails the build, not publish. Sitewright's own compositions (no third-party
 * markup → no licensing constraint).
 */
export interface GlobalSnippet {
  /** The `{{> name}}` partial name — a valid Handlebars identifier (also the override key). */
  name: string;
  /** Human label shown in the Snippets rail. */
  label: string;
  /** Handlebars + DaisyUI/Tailwind source. */
  source: string;
}

export const GLOBAL_SNIPPETS: readonly GlobalSnippet[] = [
  {
    name: 'navbar',
    label: 'Navbar',
    source: `<div class="navbar bg-base-100 shadow-sm">
  <div class="flex-1">
    <a class="btn btn-ghost text-xl" href="/">{{ company.name }}</a>
  </div>
  <div class="flex-none">
    <ul class="menu menu-horizontal px-1 sw-nav-soft">
      <li><a href="/features" class="{{#if (sw-active '/features')}}active{{/if}}"{{#if (sw-active '/features' exact=true)}} aria-current="page"{{/if}}>Features</a></li>
      <li><a href="/pricing" class="{{#if (sw-active '/pricing')}}active{{/if}}"{{#if (sw-active '/pricing' exact=true)}} aria-current="page"{{/if}}>Pricing</a></li>
      <li><a class="btn btn-primary btn-sm" href="/contact" data-sw-text="nav_cta">Contact</a></li>
    </ul>
  </div>
</div>`,
  },
  {
    name: 'hero',
    label: 'Hero',
    source: `<div class="hero min-h-[60vh] bg-base-200">
  <div class="hero-content text-center">
    <div class="max-w-2xl">
      <h1 class="text-5xl font-bold" data-sw-text="hero_title">Build something people love</h1>
      <p class="py-6 text-base-content/70" data-sw-text="hero_subtitle">A clear, benefit-led subheadline that explains your value in one sentence.</p>
      <a class="btn btn-primary" href="/contact" data-sw-text="hero_cta">Get started</a>
    </div>
  </div>
</div>`,
  },
  {
    name: 'hero-slider',
    label: 'Hero slider',
    // The "standard hero": a full-bleed background slideshow with Ken Burns drift + rising
    // captions, driven entirely by the Carousel's data-kenburns mode — no @keyframes to author
    // (the component ships them). Backgrounds bind to page.data via data-sw-bg (set each in the
    // editor); captions are editable data-sw-text regions. The full-height gradient arrows carry
    // the overrides the zero-specificity defaults need (transform-none/rounded-none/bg-gradient).
    source: `<div class="relative overflow-hidden rounded-3xl" data-sw-component="carousel" data-sw-block="Carousel" data-loop="true" data-autoplay="true" data-interval="6000" data-kenburns aria-label="Hero slideshow">
  <div data-sw-part="track">
    <div data-sw-part="slide" class="h-[60vh] max-h-[640px] min-h-[420px]">
      <div class="sw-kenburns bg-base-200" data-sw-bg="hero_image_1"></div>
      <div class="absolute inset-0 flex items-center justify-center p-6">
        <div class="sw-caption rounded-xl bg-black/40 px-7 py-3.5 text-center text-2xl font-semibold uppercase tracking-wider text-white shadow-2xl backdrop-blur-md" data-sw-text="hero_caption_1">Your headline here</div>
      </div>
    </div>
    <div data-sw-part="slide" class="h-[60vh] max-h-[640px] min-h-[420px]">
      <div class="sw-kenburns bg-base-200" data-sw-bg="hero_image_2"></div>
      <div class="absolute inset-0 flex items-center justify-center p-6">
        <div class="sw-caption rounded-xl bg-black/40 px-7 py-3.5 text-center text-2xl font-semibold uppercase tracking-wider text-white shadow-2xl backdrop-blur-md" data-sw-text="hero_caption_2">A second slide</div>
      </div>
    </div>
    <div data-sw-part="slide" class="h-[60vh] max-h-[640px] min-h-[420px]">
      <div class="sw-kenburns bg-base-200" data-sw-bg="hero_image_3"></div>
      <div class="absolute inset-0 flex items-center justify-center p-6">
        <div class="sw-caption rounded-xl bg-black/40 px-7 py-3.5 text-center text-2xl font-semibold uppercase tracking-wider text-white shadow-2xl backdrop-blur-md" data-sw-text="hero_caption_3">A third slide</div>
      </div>
    </div>
  </div>
  <button type="button" data-sw-part="prev" class="group absolute inset-y-0 left-0 z-10 flex h-full w-20 transform-none items-center justify-start rounded-none bg-transparent bg-gradient-to-r from-black/55 via-black/20 to-transparent pl-4 text-white opacity-80 transition-opacity duration-300 hover:opacity-100 sm:w-32" aria-label="Previous slide">{{sw-icon "chevron-left" "size-20 drop-shadow-lg scale-[0.55] transition-transform duration-300 group-hover:scale-[0.65] group-hover:-translate-x-4 group-active:-translate-x-8"}}</button>
  <button type="button" data-sw-part="next" class="group absolute inset-y-0 right-0 z-10 flex h-full w-20 transform-none items-center justify-end rounded-none bg-transparent bg-gradient-to-l from-black/55 via-black/20 to-transparent pr-4 text-white opacity-80 transition-opacity duration-300 hover:opacity-100 sm:w-32" aria-label="Next slide">{{sw-icon "chevron-right" "size-20 drop-shadow-lg scale-[0.55] transition-transform duration-300 group-hover:scale-[0.65] group-hover:translate-x-4 group-active:translate-x-8"}}</button>
  <div data-sw-part="dots" aria-hidden="true"></div>
</div>`,
  },
  {
    name: 'features',
    label: 'Feature grid',
    source: `<section class="bg-base-100 px-6 py-20">
  <div class="mx-auto max-w-5xl text-center">
    <h2 class="text-3xl font-bold" data-sw-text="features_title">Everything you need</h2>
    <div class="mt-12 grid gap-6 md:grid-cols-3">
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title" data-sw-text="feature_1_title">Fast</h3>
          <p class="text-base-content/70" data-sw-text="feature_1_text">Describe the benefit of this feature in a sentence.</p>
        </div>
      </div>
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title" data-sw-text="feature_2_title">Reliable</h3>
          <p class="text-base-content/70" data-sw-text="feature_2_text">Describe the benefit of this feature in a sentence.</p>
        </div>
      </div>
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title" data-sw-text="feature_3_title">Secure</h3>
          <p class="text-base-content/70" data-sw-text="feature_3_text">Describe the benefit of this feature in a sentence.</p>
        </div>
      </div>
    </div>
  </div>
</section>`,
  },
  {
    name: 'cta',
    label: 'Call to action',
    source: `<section class="bg-primary px-6 py-20 text-center text-primary-content">
  <div class="mx-auto max-w-2xl">
    <h2 class="text-3xl font-bold" data-sw-text="cta_title">Ready to get started?</h2>
    <p class="mt-4 opacity-90" data-sw-text="cta_text">Join thousands of teams already on board.</p>
    <a class="btn btn-secondary mt-8" href="/contact" data-sw-text="cta_button">Sign up</a>
  </div>
</section>`,
  },
  {
    name: 'pricing',
    label: 'Pricing card',
    source: `<section class="bg-base-100 px-6 py-20">
  <div class="mx-auto max-w-md text-center">
    <h2 class="text-3xl font-bold" data-sw-text="pricing_title">Simple pricing</h2>
    <div class="card mt-10 bg-base-200 text-left">
      <div class="card-body">
        <h3 class="card-title" data-sw-text="plan_name">Pro</h3>
        <p class="text-4xl font-bold"><span data-sw-text="plan_price">$29</span><span class="text-base font-normal text-base-content/60">/mo</span></p>
        <ul class="mt-4 space-y-2 text-base-content/70">
          <li data-sw-text="plan_feature_1">Unlimited projects</li>
          <li data-sw-text="plan_feature_2">Priority support</li>
        </ul>
        <a class="btn btn-primary mt-6" href="/contact" data-sw-text="plan_cta">Choose plan</a>
      </div>
    </div>
  </div>
</section>`,
  },
  {
    name: 'footer',
    label: 'Footer',
    // Goes in the Footer slot, which the skeleton wraps in <footer id="footer"> — so this content
    // uses neutral <div>s (DaisyUI's `.footer` class still drives the layout on any element).
    source: `<div class="footer footer-center bg-base-200 p-10 text-base-content/70">
  <div>
    <p class="font-semibold text-base-content">{{ company.name }}</p>
    <p data-sw-text="footer_tagline">Building better software since day one.</p>
  </div>
  <div class="grid grid-flow-col gap-4">
    <a class="link link-hover" href="/about">About</a>
    <a class="link link-hover" href="/contact">Contact</a>
    <a class="link link-hover" href="/privacy">Privacy</a>
  </div>
</div>`,
  },
];

/**
 * `name → source` for merging GLOBAL_SNIPPETS into a render's partials map. Spread it FIRST so a
 * project snippet of the same name overrides the global: `{ ...GLOBAL_SNIPPET_PARTIALS, ...project }`.
 */
export const GLOBAL_SNIPPET_PARTIALS: Readonly<Record<string, string>> = Object.fromEntries(
  GLOBAL_SNIPPETS.map((s) => [s.name, s.source]),
);
