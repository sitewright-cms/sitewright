import { z } from 'zod';
import { PageNodeSchema } from './block.js';
import { SeoSchema } from './seo.js';
import { TemplateRefSchema } from './template.js';
import { LocaleSchema } from './project.js';
import { IdSchema, KeyNameSchema, PageSlugSchema, SlugSchema } from './primitives.js';

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
export const PageSchema = z
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
     * contributing only its own {{edit}} `content` + settings. The page editor
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
     * of a page is itself a Page with its own `path`/`title`/`seo`/`content`; it
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
     * Client-editable bound content for a code-first (`source`) page: region key →
     * text. A developer marks editable regions in the template with the `{{edit "key"
     * "default"}}` helper; the value here OVERRIDES that default (HTML-escaped at render).
     * This is the ONLY field a client/member may change on a source page — the template
     * itself stays immutable to them (the re-targeted `data-sw-edit` client model). Bounded
     * to keep a member edit from bloating the page.
     */
    content: z
      .record(z.string().max(200), z.string().max(20_000))
      .refine((obj) => Object.keys(obj).length <= 500, 'too many content regions')
      .optional(),
    /**
     * Client-editable RICH (sanitized-HTML) bound content for a code-first page: region key →
     * sanitized HTML. A developer marks a rich region with the `data-sw-html="key"` directive; the
     * value here OVERRIDES the element's authored default and is set as its innerHTML. Values are
     * sanitized to an allowlist server-side on save AND defensively at render — the same
     * client-write property as `content` (a member may set these keys but nothing else). Keyed by
     * {@link KeyNameSchema} (refuses `__proto__`/`constructor`/`prototype`); larger per-value cap
     * than `content` for HTML markup overhead, still bounded.
     */
    richContent: z
      .record(KeyNameSchema, z.string().max(64_000))
      .refine((obj) => Object.keys(obj).length <= 500, 'too many rich regions')
      .optional(),
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

export type Page = z.infer<typeof PageSchema>;
