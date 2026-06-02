/**
 * Built-in code-first starter patterns: original DaisyUI + Tailwind section snippets a
 * developer inserts into a page's Handlebars `source` as a starting point — the code-first
 * analogue of the block-tree STARTER_PATTERNS.
 *
 * Every pattern is CSP/validator-safe by construction (no `<script>`, no `on*` handlers, no
 * `{{{raw}}}`, only literal/`{{url}}` URLs) and uses the platform conventions: DaisyUI
 * component classes (brand-themed via `--color-primary`…), `{{ company.* }}` bindings, and
 * `{{edit "key" "default"}}` for the regions a client may later edit. `code-patterns.test.ts`
 * runs each through `validateTemplate`, so an unsafe edit here fails the build, not publish.
 *
 * These are Sitewright's own compositions (no third-party markup), so there is no licensing
 * constraint. (HyperUI adoption for a richer partial library is deferred — see the roadmap.)
 */
export interface CodePattern {
  id: string;
  name: string;
  source: string;
}

export const CODE_PATTERNS: readonly CodePattern[] = [
  {
    id: 'navbar',
    name: 'Navbar',
    source: `<div class="navbar bg-base-100 shadow-sm">
  <div class="flex-1">
    <a class="btn btn-ghost text-xl" href="/">{{ company.name }}</a>
  </div>
  <div class="flex-none">
    <ul class="menu menu-horizontal px-1">
      <li><a href="/features">Features</a></li>
      <li><a href="/pricing">Pricing</a></li>
      <li><a class="btn btn-primary btn-sm" href="/contact">{{edit "nav_cta" "Contact"}}</a></li>
    </ul>
  </div>
</div>`,
  },
  {
    id: 'hero',
    name: 'Hero',
    source: `<div class="hero min-h-[60vh] bg-base-200">
  <div class="hero-content text-center">
    <div class="max-w-2xl">
      <h1 class="text-5xl font-bold">{{edit "hero_title" "Build something people love"}}</h1>
      <p class="py-6 text-base-content/70">{{edit "hero_subtitle" "A clear, benefit-led subheadline that explains your value in one sentence."}}</p>
      <a class="btn btn-primary" href="/contact">{{edit "hero_cta" "Get started"}}</a>
    </div>
  </div>
</div>`,
  },
  {
    id: 'features',
    name: 'Feature grid',
    source: `<section class="bg-base-100 px-6 py-20">
  <div class="mx-auto max-w-5xl text-center">
    <h2 class="text-3xl font-bold">{{edit "features_title" "Everything you need"}}</h2>
    <div class="mt-12 grid gap-6 md:grid-cols-3">
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title">{{edit "feature_1_title" "Fast"}}</h3>
          <p class="text-base-content/70">{{edit "feature_1_text" "Describe the benefit of this feature in a sentence."}}</p>
        </div>
      </div>
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title">{{edit "feature_2_title" "Reliable"}}</h3>
          <p class="text-base-content/70">{{edit "feature_2_text" "Describe the benefit of this feature in a sentence."}}</p>
        </div>
      </div>
      <div class="card bg-base-200">
        <div class="card-body">
          <h3 class="card-title">{{edit "feature_3_title" "Secure"}}</h3>
          <p class="text-base-content/70">{{edit "feature_3_text" "Describe the benefit of this feature in a sentence."}}</p>
        </div>
      </div>
    </div>
  </div>
</section>`,
  },
  {
    id: 'cta',
    name: 'Call to action',
    source: `<section class="bg-primary px-6 py-20 text-center text-primary-content">
  <div class="mx-auto max-w-2xl">
    <h2 class="text-3xl font-bold">{{edit "cta_title" "Ready to get started?"}}</h2>
    <p class="mt-4 opacity-90">{{edit "cta_text" "Join thousands of teams already on board."}}</p>
    <a class="btn btn-secondary mt-8" href="/contact">{{edit "cta_button" "Sign up"}}</a>
  </div>
</section>`,
  },
  {
    id: 'pricing',
    name: 'Pricing card',
    source: `<section class="bg-base-100 px-6 py-20">
  <div class="mx-auto max-w-md text-center">
    <h2 class="text-3xl font-bold">{{edit "pricing_title" "Simple pricing"}}</h2>
    <div class="card mt-10 bg-base-200 text-left">
      <div class="card-body">
        <h3 class="card-title">{{edit "plan_name" "Pro"}}</h3>
        <p class="text-4xl font-bold">{{edit "plan_price" "$29"}}<span class="text-base font-normal text-base-content/60">/mo</span></p>
        <ul class="mt-4 space-y-2 text-base-content/70">
          <li>{{edit "plan_feature_1" "Unlimited projects"}}</li>
          <li>{{edit "plan_feature_2" "Priority support"}}</li>
        </ul>
        <a class="btn btn-primary mt-6" href="/contact">{{edit "plan_cta" "Choose plan"}}</a>
      </div>
    </div>
  </div>
</section>`,
  },
  {
    id: 'footer',
    name: 'Footer',
    source: `<footer class="footer footer-center bg-base-200 p-10 text-base-content/70">
  <aside>
    <p class="font-semibold text-base-content">{{ company.name }}</p>
    <p>{{edit "footer_tagline" "Building better software since day one."}}</p>
  </aside>
  <nav class="grid grid-flow-col gap-4">
    <a class="link link-hover" href="/about">About</a>
    <a class="link link-hover" href="/contact">Contact</a>
    <a class="link link-hover" href="/privacy">Privacy</a>
  </nav>
</footer>`,
  },
];
