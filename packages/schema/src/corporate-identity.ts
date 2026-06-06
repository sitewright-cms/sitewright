import { z } from 'zod';
import {
  AssetRefSchema,
  CssColorSchema,
  CssStringSchema,
  KeyNameSchema,
  TokenValueSchema,
  safeRecord,
} from './primitives.js';

// Social / external profile URLs → schema.org `sameAs`; `.url()` alone accepts
// `javascript:`/`data:`, so require the http(s) scheme explicitly.
const AbsoluteUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine((v) => /^https?:\/\//i.test(v), 'must be an absolute http(s) URL');

const AddressSchema = z.object({
  street: z.string().max(300).optional(),
  locality: z.string().max(160).optional(),
  region: z.string().max(160).optional(),
  country: z.string().max(160).optional(),
  postalCode: z.string().max(40).optional(),
});

const GeoSchema = z.object({ latitude: z.string().max(40), longitude: z.string().max(40) });

/** Font weights the slot selector offers (100–900, the CSS numeric scale). */
export const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/**
 * A typography slot (heading or body). `source` distinguishes a generic SYSTEM family
 * (`serif`/`sans-serif`/`monospace`, mapped to a curated stack at render time) from a
 * self-hosted `google` webfont (which carries a `fontId` referencing the bundled woff2).
 * `family` is a single family name/keyword (NOT a full CSS stack), constrained so it can
 * never break out of a CSS declaration. `weight` is one of the numeric CSS weights.
 */
export const FontSlotSchema = z.object({
  source: z.enum(['system', 'google']).default('system'),
  family: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 '-]*$/, 'invalid font family name'),
  weight: z
    .number()
    .int()
    .refine((w): w is (typeof FONT_WEIGHTS)[number] => (FONT_WEIGHTS as readonly number[]).includes(w), 'invalid font weight'),
  /** For `source: 'google'`: the self-hosted font record id (PR2). */
  fontId: z.string().max(128).regex(/^[A-Za-z0-9_-]+$/).optional(),
});
export type FontSlot = z.infer<typeof FontSlotSchema>;

/**
 * A project's **Corporate Identity** — the single cohesive record that merges
 * contentBase's company info and brand tokens (the old split `brand.*` +
 * `company.*` namespaces). It drives:
 *   - schema.org JSON-LD + favicon / OG image (the identity/contact fields), and
 *   - the brand CSS custom properties + Tailwind theme (the design tokens).
 * `name` is the always-present display name; everything else is optional so a
 * project can publish with minimal identity (no structured data emitted then).
 * Token values are constrained (see primitives) so they can't break out of a CSS
 * declaration.
 */
export const CorporateIdentitySchema = z.object({
  // --- Identity / naming ---
  /** Display name (always present). schema.org falls back to this when legalName/shortName are unset. */
  name: z.string().min(1).max(200),
  legalName: z.string().max(300).optional(),
  shortName: z.string().max(120).optional(),
  slogan: z.string().max(300).optional(),
  description: z.string().max(4000).optional(),
  /** schema.org `@type` (`Organization` by default; `disabled` suppresses JSON-LD). */
  businessType: z.string().max(80).optional(),

  // --- Visual assets ---
  /** Primary logo. */
  logo: AssetRefSchema.optional(),
  logoLight: AssetRefSchema.optional(),
  logoDark: AssetRefSchema.optional(),
  /** Favicon source (preferred); falls back to `favicon`. */
  icon: AssetRefSchema.optional(),
  favicon: AssetRefSchema.optional(),
  /** OG / social share image. */
  image: AssetRefSchema.optional(),

  // --- Contact / structured data ---
  email: z.string().email().max(320).optional(),
  telephone: z.string().max(60).optional(),
  address: AddressSchema.optional(),
  geo: GeoSchema.optional(),
  /** Social / external profile URLs → schema.org `sameAs`. */
  social: z.array(AbsoluteUrlSchema).max(50).optional(),

  // --- Design tokens (compiled to CSS custom properties + Tailwind theme) ---
  /** Token name → CSS color value (e.g. `primary` → `#0a7`). */
  colors: safeRecord(CssColorSchema, KeyNameSchema).default({}),
  typography: z
    .object({
      fontFamilies: safeRecord(CssStringSchema, KeyNameSchema).default({}),
      scale: safeRecord(TokenValueSchema, KeyNameSchema).optional(),
      /** Heading-font slot (defaults to a serif at weight 700 when absent). */
      heading: FontSlotSchema.optional(),
      /** Body-font slot (defaults to a sans-serif at weight 400 when absent). */
      body: FontSlotSchema.optional(),
    })
    .optional(),
  spacing: safeRecord(TokenValueSchema, KeyNameSchema).optional(),
  radii: safeRecord(TokenValueSchema, KeyNameSchema).optional(),
});
export type CorporateIdentity = z.infer<typeof CorporateIdentitySchema>;

/**
 * The token-bearing slice of a CorporateIdentity — what the renderer / Tailwind /
 * brand-css compilers actually consume. A full `CorporateIdentity` is structurally
 * assignable to this, so callers pass the whole identity without a projection.
 */
export type BrandTokens = Pick<CorporateIdentity, 'colors' | 'typography' | 'spacing' | 'radii'>;
