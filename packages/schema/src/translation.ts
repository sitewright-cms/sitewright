import { z } from 'zod';
import { PageNodeSchema } from './block.js';
import { IdSchema } from './primitives.js';

/**
 * A per-locale override of a page's content. The default locale uses the page's
 * own `root`; for every other locale, a translation (when present) supplies a
 * localized `root` (and optional `title`). Untranslated pages fall back to the
 * default locale at publish time.
 *
 * `id` is the storage key `${pageId}__${locale}`. Like other tree-bearing content,
 * untrusted input MUST pass `assertWithinTreeDepth` on `root` before parsing.
 */
export const PageTranslationSchema = z.object({
  id: IdSchema,
  pageId: IdSchema,
  locale: z.string().min(1).max(35),
  title: z.string().max(200).optional(),
  root: PageNodeSchema,
});

export type PageTranslation = z.infer<typeof PageTranslationSchema>;
