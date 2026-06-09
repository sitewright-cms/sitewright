import { z } from 'zod';
import { PageNodeSchema } from './block.js';
import { SeoSchema } from './seo.js';
import { TemplateRefSchema } from './template.js';
import { LocaleSchema } from './project.js';
import { IdSchema, KeyNameSchema, PageSlugSchema, SlugSchema } from './primitives.js';
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
    seo: SeoSchema.optional(),
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
     * of a page is itself a Page with its own `path`/`title`/`seo`/`data`; it
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
    /** Root of the block tree rendered for this page. */
    root: PageNodeSchema,
    /**
     * Code-first authoring: when set, this page is rendered from a Handlebars TEMPLATE
     * (HTML + Tailwind + `{{ }}`) instead of the block tree — the templating pivot's page
     * model. Validated (no scripts/handlers/unsafe contexts) and rendered in an isolated
     * worker. The `root` stays for back-compat; `source` wins when present.
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
  })
  .superRefine((page, ctx) => {
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

const CONTENT_RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Migrate the RETIRED `content` map (the legacy `{{edit}}`/`data-sw-text="key"` flat-text store) into
 * `page.data`: each `content[key]` becomes a top-level `data[key]` (an existing `data` value wins on a
 * collision; prototype-pollution keys are dropped), then `content` is removed. Idempotent — runs on every
 * page parse, so stored pages migrate on the next read/write. Mirrors `migrateRetiredWebsiteFields`.
 * Non-object input or a page with no `content` passes straight through.
 */
export function migrateContentIntoData(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  const content = v.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return value; // nothing to migrate
  const existing = v.data && typeof v.data === 'object' && !Array.isArray(v.data) ? (v.data as Record<string, unknown>) : {};
  const data: Record<string, unknown> = { ...existing };
  for (const [k, val] of Object.entries(content)) {
    // page.data wins a collision; skip the empty key (no directive can read it) and never let a content
    // key define a prototype-pollution property.
    if (k === '' || CONTENT_RESERVED_KEYS.has(k) || Object.prototype.hasOwnProperty.call(data, k)) continue;
    // eslint-disable-next-line security/detect-object-injection -- own key from Object.entries + RESERVED-guarded
    data[k] = val;
  }
  const out: Record<string, unknown> = { ...v, data };
  delete out.content;
  return out;
}

/**
 * Migrate the RETIRED `richContent` map (the bare-key `data-sw-html` rich-HTML store) into `page.data`:
 * each `richContent[key]` becomes a top-level `data[key]` string, then `richContent` is removed. Now
 * there is a SINGLE store — bare-key `data-sw-html` reads `page.data` like the other directives, and
 * the value is sanitized at RENDER (the html sink). `page.data` wins a collision; empty/prototype keys
 * are dropped. Idempotent; runs on every page parse so stored pages migrate on the next read/write.
 * (We can't sanitize here — the schema package must not depend on the renderer — but the render html
 * sink always sanitizes, so a migrated value is never emitted unsanitized.)
 */
export function migrateRichContentIntoData(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  const rich = v.richContent;
  if (!rich || typeof rich !== 'object' || Array.isArray(rich)) return value; // nothing to migrate
  const existing = v.data && typeof v.data === 'object' && !Array.isArray(v.data) ? (v.data as Record<string, unknown>) : {};
  const data: Record<string, unknown> = { ...existing };
  for (const [k, val] of Object.entries(rich)) {
    if (k === '' || CONTENT_RESERVED_KEYS.has(k) || Object.prototype.hasOwnProperty.call(data, k)) continue;
    // eslint-disable-next-line security/detect-object-injection -- own key from Object.entries + RESERVED-guarded
    data[k] = val;
  }
  const out: Record<string, unknown> = { ...v, data };
  delete out.richContent;
  return out;
}

/**
 * Apply every retired-store migration to a raw page value (legacy `content` + `richContent` → `data`).
 * The single entry point used by both `PageSchema` (on parse) AND the raw `list()` read paths (preview
 * + publish + export), which read rows without parsing and so must migrate explicitly. Idempotent.
 */
export function migratePageStores(value: unknown): unknown {
  return migrateRichContentIntoData(migrateContentIntoData(value));
}

export const PageSchema = z.preprocess(migratePageStores, PageObject);
export type Page = z.infer<typeof PageSchema>;
