import { z } from 'zod';
import { TemplateRefSchema } from './template.js';
import { LocaleSchema } from './project.js';
import { AssetRefSchema, IdSchema, NavTargetSchema, OrderSchema, PageSlugSchema } from './primitives.js';
import { JsonObjectStoreSchema } from './json-store.js';

/**
 * The rejection message for a write that still carries `collection` (see the field below). Kept as a
 * named constant so the API/MCP error text and the test that pins it cannot drift apart.
 */
export const COLLECTION_REMOVED =
  'collection pages were removed: a `[param]` path never rendered its dataset entry. ' +
  'Give each item its own page with a shared `template:` ref (that is also the only way to get ' +
  'per-item SEO, nav placement and revisions), or keep the content in a dataset and loop it with ' +
  '{{#each dataset.<slug>}} on one page.';

/**
 * Navigation slots a page can appear in (the page-tree-driven auto-nav). `header`/`footer`/`mobile`
 * back the default chrome recipes; `custom` is an author-only slot the defaults never read — a page in
 * it shows up in `{{#each nav.custom}}` so you can build a bespoke menu/list anywhere.
 */
export const NAV_SLOTS = ['header', 'footer', 'mobile', 'custom'] as const;
export type NavSlot = (typeof NAV_SLOTS)[number];

/**
 * A page. `path` is the page's OWN slug SEGMENT (no slashes) — the full URL is computed
 * from the parent chain (see `pagePath` in @sitewright/core). The home page's slug is the
 * empty string. Every page URL is literal: there are no `[param]` segments and no
 * dataset-driven route expansion (see the `collection` field below).
 */
const PageFields = z
  .object({
    id: IdSchema,
    path: PageSlugSchema,
    title: z.string().min(1).max(300),
    /**
     * Publication status. `draft` pages are excluded from the published site, its
     * sitemap, and the auto-nav — but stay editable and visible in the preview.
     * Optional: an absent status means published, so existing pages (and the
     * API/MCP) keep working unchanged. `publishedPages` keys off `!== 'draft'`.
     */
    status: z.enum(['draft', 'published']).optional(),
    // SEO/meta fields, flattened directly onto the page (there is no nested `page.seo` object).
    // Rendered into the <head> (meta description, og:image, canonical, robots noindex) and bound in
    // templates as {{ page.description }} / {{ page.image }}. There is no separate SEO title — the page
    // title (above) IS the document/og title.
    /** Meta description (also og:description). */
    description: z.string().max(1000).optional(),
    /** OG/share image — an http(s) URL or root-relative path (never a `javascript:`/`data:` URI). */
    image: AssetRefSchema.optional(),
    /** Canonical URL — an absolute http(s) URL. */
    canonical: z
      .string()
      .url()
      .refine((v) => /^https?:\/\//i.test(v), 'must be an absolute http(s) URL')
      // Defence-in-depth (mirrors `website.siteUrl`): `.url()` also permits `"<>'&`, harmless where the
      // value is escaped (og:url + <link rel=canonical> both escapeAttr it) but rejected at the boundary
      // so it can never reach a future unescaped sink (a redirect rule, an HTTP header, …).
      .refine((v) => !/["<>'&]/.test(v), 'canonical must not contain HTML-significant characters')
      .optional(),
    /** Exclude from search indexing + the sitemap (`<meta name="robots" content="noindex">`). */
    noindex: z.boolean().optional(),
    /**
     * Raw HTML page: render the page `source` as FREE-FORM HTML with NO platform CSS or JS injected — the
     * compiled Tailwind/DaisyUI utility sheet, the platform base + typography CSS, the no-flash theme init,
     * and the component runtimes are ALL omitted (the page brings its own styling/scripts). The skeleton
     * landmarks and the site head/criticalCss/scripts slots still apply. Off by default; for pasting a
     * self-contained external page verbatim.
     */
    rawHtml: z.boolean().optional(),
    /**
     * Code-first template reference: when set, this page renders the TEMPLATE's
     * Handlebars source (a project `template` entity, or a built-in `global:<key>`),
     * contributing only its own editable `page.data` overrides + settings. The page editor
     * locks the code surface for such pages (fork the template to customize).
     */
    template: TemplateRefSchema.optional(),
    /**
     * Parent page (sub-page nesting). Drives the auto-nav: when the PARENT's
     * `nav.dropdown` is on, this page nests in a dropdown under the parent's
     * nav item (no own `nav.slots` needed).
     */
    parent: IdSchema.optional(),
    /**
     * Sibling sort order within the same parent (ascending; ties broken by title). THE sort key:
     * one page-tree order, independent of nav membership, driving both the pages list and every
     * auto-nav menu. Set by drag-reordering the pages list (or Arrow Up/Down); a writer that wants
     * an explicit position sets this. Absent → 0, so untouched pages fall back to title order.
     */
    order: OrderSchema.optional(),
    /**
     * The page's language. Absent → the project's default locale. A LOCALE VARIANT
     * of a page is itself a Page with its own `path`/`title`/`description`/`data`; it
     * usually shares structure by referencing the same `template` (template-reuse),
     * or forks its own `source` for a per-locale layout variation. See
     * docs/i18n-content-model.md.
     */
    locale: LocaleSchema.optional(),
    /**
     * Links all locale variants of one page (a stable shared id — by convention the
     * primary/default-locale page's id). Publish groups by this to emit `hreflang`
     * alternates + `x-default`, and to expose `{{ page.translations }}` for a
     * language switcher. Absent → the page stands alone (no alternates).
     */
    translationGroup: IdSchema.optional(),
    /** Navigation placement: which menu slots this page appears in (auto-nav). */
    nav: z
      .object({
        /** Menu label; falls back to the page title. */
        title: z.string().max(200).optional(),
        slots: z
          .array(z.enum(NAV_SLOTS))
          .min(1)
          .max(NAV_SLOTS.length)
          .refine((s) => new Set(s).size === s.length, 'slots must not contain duplicates')
          // Optional so a page can carry `hidden` WITHOUT claiming a slot. A nav object with neither
          // was invalid before, so nothing can depend on the old behaviour.
          .optional(),
        /**
         * Keep this page out of auto-nav entirely — including a parent's `dropdown`, which otherwise
         * folds in EVERY child regardless of its own slots.
         *
         * Exists because a paginated archive breaks the menu: 40 `news-2 … news-41` pages are real
         * children of News & Events (they need the route and the breadcrumb), and every one of them
         * appeared in the mega menu — 43 items, 1,700px tall, 37 of them "Latest News — page N".
         * There was no way to say "child, but not a menu entry".
         */
        hidden: z.boolean().optional(),
        /**
         * @deprecated LEGACY sort order — use the page's top-level `order` instead.
         *
         * Nothing writes this any more (the editor's number inputs are gone; the importer and the
         * new-project scaffold set `order`). It is still READ as a fallback, so a page written
         * before the page tree became canonical — or by an older agent — keeps its position:
         * effective order is `order ?? nav.order ?? 0`. Since `order` always wins, setting BOTH
         * silently does nothing; the editor promotes a legacy value to `order` on the next save.
         */
        order: OrderSchema.optional(),
        /** Show this page's CHILD pages (pages whose `parent` is this page) in a dropdown under its nav item. */
        dropdown: z.boolean().optional(),
      })
      .optional(),
    /**
     * Code-first authoring: the page is rendered from a Handlebars TEMPLATE (HTML + Tailwind +
     * `{{ }}`) — `source` directly, or a referenced `template`. Validated (no scripts/handlers/
     * unsafe contexts) and rendered in an isolated worker. A page with no `source`/`template`
     * (e.g. a brand-new page) renders an empty body.
     */
    source: z.string().max(256 * 1024).optional(),
    /**
     * Per-page custom data: the SINGLE editable store for a code-first page — every `data-sw-*`
     * directive override lands here, plus free-form structured data exposed in templates as
     * `{{ page.data.* }}` / `{{#each page.data.x}}` (the per-page counterpart of `website.data`,
     * e.g. a blog article page holds `{ article_title, article_body, article_image, … }`).
     *
     * A directive's bare key is a TOP-LEVEL property (`data-sw-text="headline"` → `data.headline`);
     * a `data.<path>` key is a nested path. Rich HTML (`data-sw-html`) stores here too — there is no
     * longer a separate `richContent` store. Edited via the graphical "Edit page data" tree/JSON
     * editor and the in-preview `data-sw-*` leaf directives. A root OBJECT, bounded + prototype-safe
     * ({@link JsonObjectStoreSchema}), available in both preview and publish.
     *
     * @security values are stored RAW (no HTML sanitization at rest): `page.data` is generic JSON
     * and which string leaves are HTML (bound to a `data-sw-html` directive) isn't known at the
     * entity boundary. The safety boundary is at RENDER — the html sink ALWAYS runs
     * `sanitizeRichHtml` before setting innerHTML; every other sink escapes (text) or `safeUrl`s
     * (src/href/bg); `{{{triple-stache}}}` is rejected by `validateTemplate`. So a `page.data` value
     * is never emitted to HTML unsanitized.
     */
    data: JsonObjectStoreSchema.optional(),
    /**
     * REMOVED — dataset-driven collection pages. `{ dataset, param }` on a `[param]` path once
     * expanded to one route per entry, but the renderer never bound the entry into the render
     * context, so every generated route rendered the same page with no entry data. It had no
     * editor UI, was never documented for agents, and had zero uses across all live projects — but
     * the schema ACCEPTED it, so a write guessing at the feature got HTTP 200 and N blank pages.
     *
     * Declared (rather than deleted) so that write still fails LOUDLY, with a message naming the
     * model that works, instead of being silently stripped by Zod and then failing on `path` with
     * an opaque slug-format error. `never` (not `undefined`) because PageSchema is published as the
     * MCP `put_page` input schema: `undefined` has no JSON Schema form and throws while building the
     * tool catalog, whereas `never` serializes to `{"not":{}}` — "no value is valid here", which is
     * exactly the intent and is visible to an agent reading the schema.
     *
     * Give anything that owns a URL its own page with a shared `template:` ref — that is also the
     * only model with per-item SEO, nav placement, revisions and a correct search-index entry.
     * Datasets remain right for repeated content with no URL of its own (`{{#each dataset.x}}`).
     */
    collection: z.never({ error: COLLECTION_REMOVED }).optional(),
    /**
     * Entry kind. Absent/`'page'` = a normal page (slug + a rendered route/HTML file). `'link'` = a
     * NAVIGATION PLACEHOLDER: no own route/HTML — a pages-list entry that appears in the auto-nav (via
     * `nav.slots`) and either groups its child pages in a dropdown (`nav.dropdown`) or links somewhere
     * (`link.target`). A link page is routing-transparent: `path:''` (no slug segment, contributes
     * nothing to child routes) with a stub `root`. Its `title` is the menu label (may contain inline
     * HTML + `{{sw-icon}}` helpers, rendered + sanitized into the nav).
     */
    kind: z.enum(['page', 'link']).optional(),
    /** For a `kind:'link'` placeholder: where the nav item points + whether it opens a new tab. */
    link: z
      .object({
        /**
         * The link target; behavior is inferred from its shape at render: `#id` → opens a matching
         * `<dialog>` (global modal) else smooth-scrolls to that section; `/path`(`#id`) → internal,
         * rebased per page/locale; `http(s)`/`mailto:`/`tel:`/`sms:` → external. Empty → a pure
         * dropdown-parent label (pair with `nav.dropdown`).
         */
        target: NavTargetSchema.optional(),
        /** Open the target in a new tab (`target="_blank" rel="noopener"`). */
        newTab: z.boolean().optional(),
      })
      .optional(),
  });

const PageObject = PageFields.superRefine((page, ctx) => {
    if (page.kind === 'link') {
      if (!page.link) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['link'], message: 'a link (placeholder) page requires a link definition' });
      }
      const hasTarget = !!page.link?.target && page.link.target.trim() !== '';
      const isDropdownParent = page.nav?.dropdown === true;
      // A link entry must DO something: point somewhere, or group children as a dropdown parent.
      if (!hasTarget && !isDropdownParent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['link', 'target'],
          message: 'a link page needs a target, or must be a dropdown parent (set nav.dropdown)',
        });
      }
    }
  });

// NOTE: the retired-store migrations (legacy `content`/`richContent` → `page.data`, `seo` object →
// flat fields) and `social: string[]` → SocialLink[] have been REMOVED — the project is pre-1.0 with
// no production data to migrate, so the schema is the single shape of record (no back-compat preprocess).
export const PageSchema = PageObject;
export type Page = z.infer<typeof PageSchema>;

/**
 * A PARTIAL page for patch writes (`PUT …/content/page/:id?merge=1`, MCP `patch_page`): every field is
 * optional except `id`, and the fragment is deep-merged into the stored page before the FULL
 * {@link PageSchema} validates the result. Derived from the same field object as `PageSchema`, so it can
 * never drift from it.
 *
 * Exists because a page write is otherwise a total REPLACE: sending `{id, path, title, nav}` to relabel a
 * nav entry silently deleted `source`, `status`, `description`, `order`, `parent` and `data.swImport`.
 * The cross-field rules (a link page needs a `link`, and that link needs a target or a dropdown) deliberately
 * do NOT run on the fragment — they are checked on the MERGED page, where they are actually meaningful.
 *
 * Every field is also NULLABLE, because `deepMerge` reads `null` as "delete this key" (see
 * repo/merge.ts) — that is the ONLY way to clear a field, since omitting it means "leave unchanged"
 * and some fields cannot be overwritten into absence (`template` is `.min(1)`, so `template:""`
 * fails validation). A plain `.partial()` here accepts `undefined` but REJECTS `null`, which made
 * the documented clear-a-field contract unreachable over MCP while it kept working over REST — the
 * REST route deep-merges the raw body and never sees this schema. Three separate clone agents hit
 * it, and their only recourse was `put_page`, the total replace that wipes `data.swImport` (the
 * marker every fidelity tool requires). `id` stays non-null: it addresses the row.
 */
export const PagePatchSchema = z
  .object(
    Object.fromEntries(
      Object.entries(PageFields.shape).map(([key, field]) => [key, field.nullable().optional()]),
    ) as { [K in keyof typeof PageFields.shape]: z.ZodOptional<z.ZodNullable<(typeof PageFields.shape)[K]>> },
  )
  .extend({ id: IdSchema });
export type PagePatch = z.infer<typeof PagePatchSchema>;

/**
 * True for a navigation-placeholder page (`kind:'link'`): no own route/HTML — a nav item that links
 * somewhere or groups child pages in a dropdown. Routing-transparent (`path:''`). Use this guard
 * wherever a slugless link page must NOT be mistaken for the home page, emitted as a route, or
 * counted toward duplicate-path checks.
 */
export function isLinkPage(page: Pick<Page, 'kind'>): boolean {
  return page.kind === 'link';
}
