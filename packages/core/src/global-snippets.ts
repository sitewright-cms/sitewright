/**
 * Built-in GLOBAL snippets — platform-shipped starter sections every project can compose with
 * `{{> name}}` (the code-first analogue of the block-tree STARTER_PATTERNS). They surface read-only +
 * copyable in the editor's Snippets rail (above the project's own editable snippets) and are merged
 * into the render's partials so `{{> name}}` resolves in preview AND publish. A project snippet of
 * the same `name` overrides the global.
 *
 * Snippets are CONTRACT-FREE: inert/lightly-bound markup, freely editable and deletable. The
 * data-driven, managed, interactive blocks (carrying a config dataset + `data-sw-component` runtime)
 * are WIDGETS — a hard-separated registry in `./widgets.ts`, never seeded here, never in the snippet
 * editor. See docs/authoring-model.md.
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
    <ul class="menu menu-horizontal px-1 sw-nav-box-solid">
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
  {
    name: 'logo-marquee',
    label: 'Logo marquee',
    // A CSS-only, auto-scrolling logo strip (no JS). The `data-sw-marquee` marker ships MARQUEE_CSS; the
    // track holds the logos TWICE (the second set aria-hidden + data-sw-marquee-dup) so the scroll loops
    // seamlessly and reduced-motion can drop the copy. Logos come from a media folder — edit the folder
    // name ("Partners") to your own. Logo height / speed are tunable via the marquee CSS variables.
    source: `<div data-sw-marquee aria-label="Partners">
  <div class="sw-marquee-track">
    {{#sw-folder "Partners" kind="image"}}
    <div class="sw-marquee-item bg-base-100 rounded-box p-4"><img src="{{sw-url url}}" alt="{{alt}}" loading="lazy"></div>
    {{/sw-folder}}
    {{#sw-folder "Partners" kind="image"}}
    <div class="sw-marquee-item bg-base-100 rounded-box p-4" data-sw-marquee-dup aria-hidden="true"><img src="{{sw-url url}}" alt="" loading="lazy"></div>
    {{/sw-folder}}
  </div>
</div>`,
  },
  {
    name: 'rotating-tiles',
    label: 'Rotating tiles (flip cards)',
    // A grid of 3D FLIP CARDS — pure Tailwind, no JS. Each card flips on hover to reveal its back. The 3D
    // is plain Tailwind: `[perspective]` on the cell, `transform-3d` on the rotating inner,
    // `backface-hidden` on both faces, and `group-hover:rotate-y-180` to flip.
    // Source-editable: copy a card, change the icon / front title / back text. Each face uses theme tokens.
    source: `<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
  <div class="group h-56 perspective-distant">
    <div class="relative h-full w-full transition-transform duration-700 transform-3d group-hover:rotate-y-180">
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-box bg-base-100 p-6 text-center shadow backface-hidden">
        {{sw-icon "rocket" "h-10 w-10 text-primary"}}
        <h3 class="font-heading text-lg font-semibold text-base-content" data-sw-text="tile1_title">Migrations &amp; Setup</h3>
      </div>
      <div class="absolute inset-0 flex items-center justify-center rounded-box bg-primary p-6 text-center text-primary-content shadow rotate-y-180 backface-hidden">
        <p data-sw-text="tile1_back">Moving your data across and getting you set up, ready to go.</p>
      </div>
    </div>
  </div>
  <div class="group h-56 perspective-distant">
    <div class="relative h-full w-full transition-transform duration-700 transform-3d group-hover:rotate-y-180">
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-box bg-base-100 p-6 text-center shadow backface-hidden">
        {{sw-icon "graduation-cap" "h-10 w-10 text-primary"}}
        <h3 class="font-heading text-lg font-semibold text-base-content" data-sw-text="tile2_title">Training</h3>
      </div>
      <div class="absolute inset-0 flex items-center justify-center rounded-box bg-primary p-6 text-center text-primary-content shadow rotate-y-180 backface-hidden">
        <p data-sw-text="tile2_back">Hands-on training so your team is confident from day one.</p>
      </div>
    </div>
  </div>
  <div class="group h-56 perspective-distant">
    <div class="relative h-full w-full transition-transform duration-700 transform-3d group-hover:rotate-y-180">
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-box bg-base-100 p-6 text-center shadow backface-hidden">
        {{sw-icon "life-buoy" "h-10 w-10 text-primary"}}
        <h3 class="font-heading text-lg font-semibold text-base-content" data-sw-text="tile3_title">Continuous Support</h3>
      </div>
      <div class="absolute inset-0 flex items-center justify-center rounded-box bg-primary p-6 text-center text-primary-content shadow rotate-y-180 backface-hidden">
        <p data-sw-text="tile3_back">Ongoing help whenever you need a hand.</p>
      </div>
    </div>
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
