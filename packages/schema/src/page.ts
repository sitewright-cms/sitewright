import { z } from 'zod';
import { PageNodeSchema } from './block.js';
import { SeoSchema } from './seo.js';
import { IdSchema, KeyNameSchema, RoutePathSchema, SlugSchema } from './primitives.js';

const COLLECTION_PARAM = /\[[A-Za-z0-9_]+\]/;

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
    seo: SeoSchema.optional(),
    /** Optional reusable layout: the template wraps this page at its Outlet node. */
    template: IdSchema.optional(),
    /** Root of the block tree rendered for this page. */
    root: PageNodeSchema,
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
