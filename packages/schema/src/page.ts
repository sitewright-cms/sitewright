import { z } from 'zod';
import { TemplateRefSchema } from './template.js';
import { LocaleSchema } from './project.js';
import { AssetRefSchema, IdSchema, KeyNameSchema, NavTargetSchema, PageSlugSchema, SlugSchema } from './primitives.js';
import { JsonObjectStoreSchema } from './json-store.js';

const COLLECTION_PARAM = /\[[A-Za-z0-9_]+\]/;

/** Navigation slots a page can appear in (the page-tree-driven auto-nav). */
export const NAV_SLOTS = ['header', 'footer', 'mobile'] as const;
export type NavSlot = (typeof NAV_SLOTS)[number];

/**
 * A page. `path` is the page's OWN slug SEGMENT (no slashes) — the full URL is computed
 * from the parent chain (see `pagePath` in @sitewright/core). The home page's slug is the
 * empty string. A collection page's slug is a single `[param]` segment (e.g. `[slug]`),
 * in which case `collection` must be set — and a `collection` requires the `[param]`. Both
 * directions are enforced.
 */
const PageObject = z
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
     * Sibling sort order within the same parent (ascending; ties broken by title). Set by
     * drag-reordering the pages list; the canonical page-tree order, independent of nav
     * membership. The list and the auto-nav both prefer this, falling back to the legacy
     * `nav.order` then title when it is absent.
     */
    order: z.number().int().min(0).max(100_000).optional(),
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
          .refine((s) => new Set(s).size === s.length, 'slots must not contain duplicates'),
        /** Sort order within a slot (ascending; ties broken by title). */
        order: z.number().int().min(0).max(100_000).optional(),
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
    /** Present when this page is generated once per dataset entry. */
    collection: z
      .object({
        dataset: SlugSchema,
        param: KeyNameSchema,
      })
      .optional(),
    /**
     * Entry kind. Absent/`'page'` = a normal page (slug + a rendered route/HTML file). `'link'` = a
     * NAVIGATION PLACEHOLDER: no own route/HTML — a pages-list entry that appears in the auto-nav (via
     * `nav.slots`) and either groups its child pages in a dropdown (`nav.dropdown`) or links somewhere
     * (`link.target`). A link page is routing-transparent: `path:''` (no slug segment, contributes
     * nothing to child routes) with a stub `root`. Its `title` is the menu label (may contain inline
     * HTML + `{{sw-icon}}`/`{{sw-flag}}` helpers, rendered + sanitized into the nav).
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
  })
  .superRefine((page, ctx) => {
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
      // A link placeholder renders no page → it can't be a collection (would expand to bogus `/` routes).
      if (page.collection) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['collection'], message: 'a link (placeholder) page cannot be a collection' });
      }
    }
    const hasParam = COLLECTION_PARAM.test(page.path);
    if (page.collection && !hasParam) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['path'],
        message: 'a collection page path must contain a [param] segment',
      });
    }
    if (hasParam && !page.collection) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['collection'],
        message: 'a path with a [param] segment requires a collection definition',
      });
    }
  });

// NOTE: the retired-store migrations (legacy `content`/`richContent` → `page.data`, `seo` object →
// flat fields) and `social: string[]` → SocialLink[] have been REMOVED — the project is pre-1.0 with
// no production data to migrate, so the schema is the single shape of record (no back-compat preprocess).
export const PageSchema = PageObject;
export type Page = z.infer<typeof PageSchema>;

/**
 * True for a navigation-placeholder page (`kind:'link'`): no own route/HTML — a nav item that links
 * somewhere or groups child pages in a dropdown. Routing-transparent (`path:''`). Use this guard
 * wherever a slugless link page must NOT be mistaken for the home page, emitted as a route, or
 * counted toward duplicate-path checks.
 */
export function isLinkPage(page: Pick<Page, 'kind'>): boolean {
  return page.kind === 'link';
}
