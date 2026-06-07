import { z } from 'zod';
import {
  AssetRefSchema,
  CssColorSchema,
  CssStringSchema,
  IdSchema,
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

/** One of the numeric CSS weights (100–900). */
export const FontWeightSchema = z
  .number()
  .int()
  .refine((w): w is (typeof FONT_WEIGHTS)[number] => (FONT_WEIGHTS as readonly number[]).includes(w), 'invalid font weight');

/** A single family name/keyword (NOT a full CSS stack) — constrained so it can't break out of CSS. */
export const FontFamilyNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 '-]*$/, 'invalid font family name');

/** Web-font container formats a self-hosted font file may use. */
export const FONT_FORMATS = ['woff2', 'woff', 'ttf', 'otf'] as const;
export const FontFormatSchema = z.enum(FONT_FORMATS);
/** The generic CSS fallback a font asset degrades to before it loads. */
export const FontFallbackSchema = z.enum(['serif', 'sans-serif', 'monospace', 'cursive']);
/** Where a self-hosted font came from. */
export const FontSourceSchema = z.enum(['google', 'local']);

/** A self-hosted font file name (and URL segment): `<weight>[-italic].<ext>` — path-safe + format-true. */
export const FontFileNameSchema = z
  .string()
  .regex(/^[1-9]00(-italic)?\.(woff2|woff|ttf|otf)$/, 'invalid font file name');

/** One stored face of a self-hosted font (a weight×style at a given format/file). */
export const FontFileSchema = z.object({
  weight: FontWeightSchema,
  style: z.enum(['normal', 'italic']).default('normal'),
  format: FontFormatSchema,
  file: FontFileNameSchema,
});
export type FontFile = z.infer<typeof FontFileSchema>;

/**
 * A typography slot (heading, body, or a custom named slot). `source` is either a generic SYSTEM
 * family (`serif`/`sans-serif`/`monospace`, mapped to a curated stack) or `asset` — a self-hosted
 * font in the media library (kind `font`), referenced by `assetId`. `family` is a single family
 * name/keyword (constrained so it can't break out of CSS); `weight` is a numeric CSS weight.
 *
 * Back-compat: pre-unification slots used `source: 'google'|'local'` + a `fontId` into the old
 * `typography.fonts[]` (now removed). Those degrade to a SYSTEM slot keeping the family name (so the
 * text still renders in a sensible fallback) until the user re-picks the font from the library.
 */
export const FontSlotSchema = z
  .object({
    source: z.enum(['system', 'google', 'local', 'asset']).default('system'),
    family: FontFamilyNameSchema,
    weight: FontWeightSchema,
    /** For `source: 'asset'`: the font media asset id (references a `kind:'font'` library asset). */
    assetId: IdSchema.optional(),
    /** Legacy (pre-unification) reference — ignored; the slot degrades to a system family. */
    fontId: z.string().optional(),
  })
  .transform((s) => {
    const isAsset = s.source === 'asset' && !!s.assetId;
    return {
      source: isAsset ? ('asset' as const) : ('system' as const),
      family: s.family,
      weight: s.weight,
      ...(isAsset ? { assetId: s.assetId } : {}),
    };
  });
export type FontSlot = z.infer<typeof FontSlotSchema>;

/**
 * A custom typography slot name → a `font-<name>` Tailwind utility + `--sw-font-<name>` var. The
 * name is a CSS-ident slug; reserved names (the built-in slots + Tailwind's default font keys) are
 * rejected so a custom slot can never shadow `font-heading`/`font-body`/`font-sans`/etc.
 */
const RESERVED_FONT_SLOT_NAMES = new Set(['heading', 'body', 'sans', 'serif', 'mono']);
const NamedFontSlotKeySchema = z
  .string()
  .min(1)
  .max(32)
  // A CSS-ident slug: starts with a letter, hyphen-separated alphanumerics, no leading/trailing hyphen.
  // Linear (each `-[a-z0-9]+` group requires a leading `-`, so no overlap with the prefix) on a ≤32-char input.
  // eslint-disable-next-line security/detect-unsafe-regex -- provably linear; bounded input
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'invalid font slot name');

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
      /** Custom named slots → `font-<name>` utilities (+ `--sw-font-<name>` vars); opt-in, not auto-applied. */
      named: safeRecord(FontSlotSchema, NamedFontSlotKeySchema)
        .refine((obj) => Object.keys(obj).every((k) => !RESERVED_FONT_SLOT_NAMES.has(k)), 'reserved font slot name')
        .optional(),
      // (Self-hosted fonts now live in the media library as `kind:'font'` assets, referenced by a
      //  slot's `assetId`; the legacy `fonts` array is dropped on parse — old slots degrade to system.)
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
