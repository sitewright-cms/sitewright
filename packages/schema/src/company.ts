import { z } from 'zod';
import { AssetRefSchema } from './primitives.js';

// Social / external profile URLs must be absolute http(s) (→ schema.org `sameAs`);
// `.url()` alone would accept `javascript:`/`data:`, so require the scheme explicitly.
const AbsoluteUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine((v) => /^https?:\/\//i.test(v), 'must be an absolute http(s) URL');

/**
 * @deprecated Merged into {@link CorporateIdentitySchema} (the unified `identity`
 * record) as of project format v2. Retained only as a building block for the
 * legacy `{brand,company}` → identity migration (see migrate-identity.ts).
 *
 * The old `company.*` namespace (contentBase's company.json): corporate info that
 * drives schema.org JSON-LD + favicon / OG image. Every field optional.
 */
export const CompanySchema = z.object({
  /** schema.org `@type` (rendered as `Organization` by default; `disabled` suppresses JSON-LD). */
  businessType: z.string().max(80).optional(),
  /** Full/legal company name (schema.org `name`). */
  legalName: z.string().max(300).optional(),
  shortName: z.string().max(120).optional(),
  slogan: z.string().max(300).optional(),
  description: z.string().max(4000).optional(),
  logo: AssetRefSchema.optional(),
  icon: AssetRefSchema.optional(),
  image: AssetRefSchema.optional(),
  email: z.string().email().max(320).optional(),
  telephone: z.string().max(60).optional(),
  address: z
    .object({
      street: z.string().max(300).optional(),
      locality: z.string().max(160).optional(),
      region: z.string().max(160).optional(),
      country: z.string().max(160).optional(),
      postalCode: z.string().max(40).optional(),
    })
    .optional(),
  geo: z.object({ latitude: z.string().max(40), longitude: z.string().max(40) }).optional(),
  /** Social / external profile URLs → schema.org `sameAs`. */
  social: z.array(AbsoluteUrlSchema).max(50).optional(),
});
export type Company = z.infer<typeof CompanySchema>;
