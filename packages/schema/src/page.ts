import { z } from 'zod';
import { PageNodeSchema } from './block.js';
import { SeoSchema } from './seo.js';
import { IdSchema, KeyNameSchema, RoutePathSchema, SlugSchema } from './primitives.js';

const COLLECTION_PARAM = /\[[A-Za-z0-9_]+\]/;

/** Navigation slots a page can appear in (the page-tree-driven auto-nav). */
export const NAV_SLOTS = ['header', 'footer', 'mobile'] as const;
export type NavSlot = (typeof NAV_SLOTS)[number];

/**
 * A page route. `path` may contain a `[param]` segment for collection pages
 * (e.g. `/products/[slug]`), in which case `collection` must be set — and a
 * `collection` requires a `[param]` segment. Both directions are enforced.
 */
export const PageSchema = z
  .object({
    id: IdSchema,
    path: RoutePathSchema,
    title: z.string().min(1).max(300),
    /**
     * Publication status. `draft` pages are excluded from the published site, its
     * sitemap, and the auto-nav — but stay editable and visible in the preview.
     * Optional: an absent status means published, so existing pages (and the
     * API/MCP) keep working unchanged. `publishedPages` keys off `!== 'draft'`.
     */
    status: z.enum(['draft', 'published']).optional(),
    seo: SeoSchema.optional(),
    /** Optional reusable layout: the template wraps this page at its Outlet node. */
    template: IdSchema.optional(),
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
