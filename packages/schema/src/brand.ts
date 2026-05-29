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
 * Per-project corporate identity. Compiled to CSS custom properties at build
 * time. Editable by developers; lockable for the client editing role. Token
 * values are constrained so they cannot break out of a CSS declaration.
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
