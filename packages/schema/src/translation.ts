import { z } from 'zod';
import { IdSchema } from './primitives.js';
import { LocaleSchema } from './project.js';

/**
 * A per-locale override of a page's `title`. (Code-first per-locale CONTENT is a locale-variant
 * PAGE — a separate page row with `locale` set that inherits the owner's source; see i18n.ts. This
 * legacy entity now carries only the title override.) `id` is the storage key `${pageId}__${locale}`.
 */
export const PageTranslationSchema = z.object({
  id: IdSchema,
  pageId: IdSchema,
  locale: LocaleSchema,
  title: z.string().max(200).optional(),
});

export type PageTranslation = z.infer<typeof PageTranslationSchema>;
