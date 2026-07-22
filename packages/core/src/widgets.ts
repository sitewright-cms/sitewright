import type { Field } from '@sitewright/schema';
import { GLOBAL_SNIPPET_PARTIALS } from './global-snippets.js';

/**
 * WIDGETS — the platform's system-authored, data-driven, interactive blocks. A Widget is NOT a
 * Snippet: it is MANAGED (its body is owned here, never an editable snippet row), it ships BEHAVIOUR
 * (a `data-sw-component` runtime), and it is backed by a config DATASET it declares via `provides`.
 * Producers (coders/agents) compose a Widget with `{{> name}}`; consumers configure it through the
 * provisioned dataset (the nested entry editor), never by editing its source. See
 * docs/authoring-model.md.
 *
 * HARD-SEPARATED from snippets (the explicit product decision):
 *  - Widgets are NOT seeded into the global snippet library, so they never surface in the editor's
 *    Snippets rail / snippet editor (those read the seeded `snippet` rows).
 *  - Their bodies merge into the render's partials from {@link WIDGET_PARTIALS} (a constant), so
 *    `{{> name}}` resolves in preview AND publish without any DB row.
 *  - On page save the platform ENSURES each composed Widget's datasets exist (create-if-missing,
 *    seed-once, never overwrite) — {@link widgetDatasetsForSources} + the API's `ensureWidgetDatasets`.
 *
 * Every body is CSP/validator-safe by construction (no `<script>`/`on*`/`{{{raw}}}`, `{{sw-url}}` for
 * URLs) and is exercised through `validateTemplate` by the package tests, so an unsafe edit fails the
 * build, not publish.
 */

/** A WIDGET manifest: the backing config dataset(s) a widget needs (provisioned on first use). */
export interface WidgetProvides {
  datasets: ReadonlyArray<{
    /** Stable slug the widget body binds via `{{#each dataset.<slug>}}` (loop all) or
     *  `(sw-pick-entry dataset.<slug> …)` (render one chosen entry). */
    slug: string;
    name: string;
    /** Dataset field tree (scalars + nested list/object) — validated against DatasetSchema on create. */
    fields: Field[];
    /** Entries created ONLY when the dataset is first provisioned (placeholders the user then edits). */
    seed?: ReadonlyArray<{ id: string; values: Record<string, unknown> }>;
  }>;
}

export interface Widget {
  /** The `{{> name}}` partial name — a valid Handlebars identifier. */
  name: string;
  /** Human label for the Widget gallery. */
  label: string;
  /** One-line description for the gallery. */
  description: string;
  /** The `data-sw-component` this widget is built on (for the gallery / catalog). */
  component: string;
  /** Handlebars + DaisyUI/Tailwind body — consumes its `provides` dataset via `{{#each dataset.<slug>}}`. */
  source: string;
  /** The config dataset(s) auto-provisioned when a page composes this widget. */
  provides: WidgetProvides;
}

export const GLOBAL_WIDGETS: readonly Widget[] = [
  {
    name: 'hero-slider',
    label: 'Hero slider',
    description:
      'Full-bleed background slideshow with alternating Ken Burns drift and rising captions — the standard frontpage hero. Slides and settings are edited as data, no code.',
    component: 'carousel',
    // The body renders ONE config from the `hero` dataset via the {{#sw-pick-entry}} BLOCK helper: the
    // entry whose id matches page.data.hero_config (set by a {{sw-control as="dataset-item"
    // dataset="hero" target="page.data.hero_config"}} picker), else the FIRST — so multiple configs coexist
    // and a page switches between them no-code. In the editor preview the helper wraps the block in a
    // data-sw-entry marker so CLICKING the hero opens that config's entry editor; data-click-next
    // advances on a slide click on the published site (the bridge intercepts the click for editing).
    // Settings drive the carousel data-* attributes (the runtime reads them by VALUE, so
    // data-autoplay="false" disables; data-kenburns="off" stops the drift). `slides` is the editable
    // image+caption list; backgrounds are <img> (object-fit:cover, the Ken Burns target) — a loop
    // can't use data-sw-bg's page.data binding, and an interpolated inline background-image is
    // validator-forbidden; an empty image falls back to a base-200 placeholder. captions are richtext
    // (sw-html); a BLANK caption renders NO pill at all — the overlay is guarded by
    // {{#unless (sw-blank caption)}} so empty/whitespace/cleared-WYSIWYG residue shows no empty box.
    // `dataset.hero` falls back to the bare dataset on translated pages (resolveLocaleDatasets).
    // An empty dataset → the {{#sw-pick-entry}} block renders nothing.
    // Arrows and the frosted centered caption pill are NOT styled here — the base Carousel component CSS
    // owns the "hero look" (a single-item slider auto-gets the full-height gradient EDGE arrows + the
    // frosted .sw-caption pill + frosted dots pill). This body only supplies the caption TYPOGRAPHY and
    // the light/dark caption variant. `height` (optional, px/vh/% etc.) overrides the full_bleed default
    // height via an inline style (validator-safe — a quoted `style` value is HTML-escaped, no breakout);
    // when blank the class-based default (86vh full-bleed / 60vh contained) applies.
    source: `{{#sw-pick-entry dataset.hero @root.page.data.hero_config}}
<div class="relative overflow-hidden {{#if full_bleed}}{{#unless height}}h-[86vh] min-h-[560px]{{/unless}}{{else}}rounded-3xl {{#unless height}}h-[60vh] min-h-[420px] max-h-[640px]{{/unless}}{{/if}}"{{#if height}} style="height:{{height}}"{{/if}} data-sw-component="carousel" data-sw-block="Carousel" data-loop="true" data-autoplay="{{#if autoplay}}true{{else}}false{{/if}}" data-interval="{{interval}}" data-kenburns="{{#if kenburns}}on{{else}}off{{/if}}" data-click-next="true" aria-label="Hero slideshow">
  <div data-sw-part="track">
    {{#each slides}}
    <div data-sw-part="slide">
      {{#if image}}<img class="sw-kenburns" src="{{sw-url image}}" alt="" />{{else}}<div class="sw-kenburns bg-base-200"></div>{{/if}}
      {{#unless (sw-blank caption)}}<div class="absolute inset-0 flex items-center justify-center p-6">
        <div class="sw-caption text-2xl font-semibold uppercase tracking-wider{{#if caption_light}} bg-white/90 text-neutral-900{{/if}}">{{sw-html caption}}</div>
      </div>{{/unless}}
    </div>
    {{/each}}
  </div>
  {{#if show_arrows}}<button type="button" data-sw-part="prev" aria-label="Previous slide">{{sw-icon "chevron-left" ""}}</button>
  <button type="button" data-sw-part="next" aria-label="Next slide">{{sw-icon "chevron-right" ""}}</button>{{/if}}
  {{#if show_indicators}}<div data-sw-part="dots" aria-hidden="true"></div>{{/if}}
</div>
{{/sw-pick-entry}}`,
    provides: {
      datasets: [
        {
          slug: 'hero',
          name: 'Hero Slider',
          fields: [
            { name: 'autoplay', type: 'boolean', required: false, localized: false },
            { name: 'interval', type: 'number', required: false, localized: false },
            { name: 'kenburns', type: 'boolean', required: false, localized: false },
            { name: 'show_arrows', type: 'boolean', required: false, localized: false },
            { name: 'show_indicators', type: 'boolean', required: false, localized: false },
            // full_bleed: full-viewport-height, square-cornered, edge-to-edge frame (the common site hero)
            // instead of the default contained rounded box. caption_light: a WHITE caption box with dark
            // text (vs the default dark translucent box) — match whichever the original uses.
            { name: 'full_bleed', type: 'boolean', required: false, localized: false },
            { name: 'caption_light', type: 'boolean', required: false, localized: false },
            // height: an explicit slider height in any CSS length (e.g. "70vh", "600px", "100%"). Blank =
            // the full_bleed default (86vh full-bleed / 60vh contained). Set into an inline style at render.
            { name: 'height', type: 'text', required: false, localized: false },
            {
              name: 'slides',
              type: 'list',
              required: false,
              localized: false,
              fields: [
                { name: 'image', type: 'image', required: false, localized: false },
                // RICHTEXT: captions support basic HTML (bold/links/…), rendered via {{sw-html}} (sanitized).
                { name: 'caption', type: 'richtext', required: false, localized: false },
              ],
            },
          ],
          seed: [
            {
              id: 'config',
              values: {
                autoplay: true,
                interval: 6000,
                kenburns: true,
                show_arrows: true,
                show_indicators: true,
                full_bleed: false,
                caption_light: false,
                height: '',
                slides: [
                  { image: '', caption: 'Your headline here' },
                  { image: '', caption: 'A second slide' },
                  { image: '', caption: 'A third slide' },
                ],
              },
            },
          ],
        },
      ],
    },
  },
  {
    name: 'logo-marquee',
    label: 'Logo marquee',
    description:
      'A CSS-only, auto-scrolling strip of partner/client logos (no JavaScript). Feed it an explicit list of logos OR a media folder name to render every image in that folder. Speed + logos are edited as data, no code.',
    component: 'marquee',
    // Renders ONE config from the `marquee` dataset via {{#sw-pick-entry}} (the entry matching
    // page.data.marquee_config, else the first). EITHER an explicit `logos` list OR — when empty — every
    // image in the `folder` (via {{#sw-folder}}). The track is rendered TWICE (second set aria-hidden +
    // data-sw-marquee-dup) so the CSS scroll loops seamlessly; `data-sw-marquee` ships MARQUEE_CSS and
    // `data-speed` selects a preset duration. URLs go through {{sw-url}} (validator-required for src/href).
    source: `{{#sw-pick-entry dataset.marquee @root.page.data.marquee_config}}
<div data-sw-marquee data-speed="{{speed}}" aria-label="Logos">
  <div class="sw-marquee-track">
    {{#if logos}}
    {{#each logos}}<div class="sw-marquee-item bg-base-100 rounded-box p-4">{{#if link}}<a href="{{sw-url link}}" target="_blank" rel="noopener"><img src="{{sw-url image}}" alt="{{alt}}" loading="lazy"></a>{{else}}<img src="{{sw-url image}}" alt="{{alt}}" loading="lazy">{{/if}}</div>{{/each}}
    {{#each logos}}<div class="sw-marquee-item bg-base-100 rounded-box p-4" data-sw-marquee-dup aria-hidden="true"><img src="{{sw-url image}}" alt="" loading="lazy"></div>{{/each}}
    {{else}}
    {{#sw-folder folder kind="image"}}<div class="sw-marquee-item bg-base-100 rounded-box p-4"><img src="{{sw-url url}}" alt="{{alt}}" loading="lazy"></div>{{/sw-folder}}
    {{#sw-folder folder kind="image"}}<div class="sw-marquee-item bg-base-100 rounded-box p-4" data-sw-marquee-dup aria-hidden="true"><img src="{{sw-url url}}" alt="" loading="lazy"></div>{{/sw-folder}}
    {{/if}}
  </div>
</div>
{{/sw-pick-entry}}`,
    provides: {
      datasets: [
        {
          slug: 'marquee',
          name: 'Logo Marquee',
          fields: [
            // Auto mode: every image in this media folder (used when `logos` is empty).
            { name: 'folder', type: 'text', required: false, localized: false },
            { name: 'speed', type: 'select', required: false, localized: false, config: { options: ['Normal', 'Slow', 'Fast'] } },
            // Explicit mode: a hand-picked list of logos (wins over `folder` when non-empty).
            {
              name: 'logos',
              type: 'list',
              required: false,
              localized: false,
              fields: [
                { name: 'image', type: 'image', required: false, localized: false },
                { name: 'alt', type: 'text', required: false, localized: false },
                { name: 'link', type: 'text', required: false, localized: false },
              ],
            },
          ],
          seed: [{ id: 'config', values: { folder: 'Partners', speed: 'Normal', logos: [] } }],
        },
      ],
    },
  },
];

/** `name → source` for merging widget bodies into a render's partials map so `{{> name}}` resolves.
 *  Spread alongside the global snippets in EVERY render path (preview + publish) — NOT into the
 *  snippet library, so widgets stay out of the snippet editor. */
export const WIDGET_PARTIALS: Readonly<Record<string, string>> = Object.fromEntries(
  GLOBAL_WIDGETS.map((w) => [w.name, w.source]),
);

/** `name → Widget manifest`, for the save-time dataset provisioning. */
export const WIDGET_MANIFESTS: Readonly<Record<string, WidgetProvides>> = Object.fromEntries(
  GLOBAL_WIDGETS.map((w) => [w.name, w.provides]),
);

// A static `{{> name}}` / `{{#> name}}` partial include (names are identifier-safe). Module-scoped +
// `g` flag, but used ONLY via String.matchAll (which resets lastIndex per call) — never .exec()/.test(),
// so the shared lastIndex state is not a hazard. Linear; no ReDoS.
const WIDGET_PARTIAL_REF = /\{\{~?\s*#?>\s*([a-zA-Z][a-zA-Z0-9_-]*)/g;

/**
 * The dataset specs to ENSURE for a set of page sources: every Widget the sources compose
 * (transitively via `{{> name}}` — a Widget body may itself compose snippets/widgets), deduped by
 * dataset slug. `partials` supplies bodies for the transitive walk (snippets ∪ widgets); `manifests`
 * maps a widget name → its `provides`. Pure: the caller performs the create-if-missing. Used by the
 * save-time provisioning so typing/pasting/agent-authoring a `{{> widget}}` all provision identically.
 */
export function widgetDatasetsForSources(
  sources: readonly (string | undefined)[],
  partials: Readonly<Record<string, string>> = { ...GLOBAL_SNIPPET_PARTIALS, ...WIDGET_PARTIALS },
  manifests: Readonly<Record<string, WidgetProvides>> = WIDGET_MANIFESTS,
): WidgetProvides['datasets'][number][] {
  const seen = new Set<string>();
  const queue: string[] = [];
  const scan = (src: string | null | undefined): void => {
    if (!src) return;
    for (const m of src.matchAll(WIDGET_PARTIAL_REF)) {
      const name = m[1]!;
      if (!seen.has(name)) {
        seen.add(name);
        queue.push(name);
      }
    }
  };
  for (const s of sources) scan(s);
  while (queue.length) {
    const n = queue.shift()!;
    if (partials[n]) scan(partials[n]);
  }
  const out: WidgetProvides['datasets'][number][] = [];
  const slugs = new Set<string>();
  for (const name of seen) {
    const m = manifests[name];
    if (!m) continue;
    for (const ds of m.datasets) {
      if (!slugs.has(ds.slug)) {
        slugs.add(ds.slug);
        out.push(ds);
      }
    }
  }
  return out;
}
