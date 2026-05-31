import { z } from 'zod';
import {
  AssetRefSchema,
  CssColorSchema,
  CssStringSchema,
  KeyNameSchema,
  TokenValueSchema,
  safeRecord,
} from './primitives.js';

/**
 * @deprecated Merged into {@link CorporateIdentitySchema} (the unified `identity`
 * record) as of project format v2. Retained only as a building block for the
 * legacy `{brand,company}` → identity migration (see migrate-identity.ts).
 *
 * Per-project brand tokens. Compiled to CSS custom properties at build time.
 * Token values are constrained so they cannot break out of a CSS declaration.
 */
export const BrandSchema = z.object({
  name: z.string().min(1).max(200),
  logo: z
    .object({
      light: AssetRefSchema.optional(),
      dark: AssetRefSchema.optional(),
      favicon: AssetRefSchema.optional(),
    })
    .optional(),
  /** Token name -> CSS color value (e.g. `primary` -> `#0a7`). */
  colors: safeRecord(CssColorSchema, KeyNameSchema).default({}),
  typography: z
    .object({
      fontFamilies: safeRecord(CssStringSchema, KeyNameSchema).default({}),
      scale: safeRecord(TokenValueSchema, KeyNameSchema).optional(),
    })
    .optional(),
  spacing: safeRecord(TokenValueSchema, KeyNameSchema).optional(),
  radii: safeRecord(TokenValueSchema, KeyNameSchema).optional(),
});

export type Brand = z.infer<typeof BrandSchema>;
