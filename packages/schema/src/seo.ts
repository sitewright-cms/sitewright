import { z } from 'zod';
import { AssetRefSchema } from './primitives.js';

/** Per-page SEO metadata. */
export const SeoSchema = z.object({
  title: z.string().max(300).optional(),
  description: z.string().max(1000).optional(),
  // `.url()` alone accepts `javascript:`/`data:` URIs; require an absolute http(s) URL.
  canonical: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//i.test(v), 'must be an absolute http(s) URL')
    .optional(),
  /** Open Graph image — http(s) URL or root-relative path (never a `javascript:`/`data:` URI). */
  ogImage: AssetRefSchema.optional(),
  noindex: z.boolean().optional(),
});

export type Seo = z.infer<typeof SeoSchema>;
