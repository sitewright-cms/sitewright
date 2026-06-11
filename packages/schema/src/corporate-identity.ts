import { z } from 'zod';
import {
  AssetRefSchema,
  ColorTokenKeySchema,
  CssColorSchema,
  CssStringSchema,
  IdSchema,
  KeyNameSchema,
  TokenValueSchema,
  safeRecord,
} from './primitives.js';

/**
 * The brand colors every project ALWAYS has — they are non-deletable in the editor and
 * re-materialize on parse (see `colors` below), so templates/components can rely on them
 * unconditionally. Names are the canonical DaisyUI/Tailwind semantic roles, so they double
 * as `bg-<token>` utilities AND theme the DaisyUI component palette (`btn-primary`, …) with
 * zero translation. `*-content` foregrounds are NOT mandatory fields — they are derived for
 * contrast at compile time (see @sitewright/tailwind).
 */
export const MANDATORY_COLOR_TOKENS = ['primary', 'secondary', 'accent', 'neutral', 'base-100', 'base-content'] as const;
export type MandatoryColorToken = (typeof MANDATORY_COLOR_TOKENS)[number];

/** Reasonable, accessible defaults for the mandatory tokens (a deleted/absent one snaps back to these). */
export const DEFAULT_BRAND_COLORS: Readonly<Record<MandatoryColorToken, string>> = {
  primary: '#4f46e5',
  secondary: '#0ea5e9',
  accent: '#f59e0b',
  neutral: '#171627',
  'base-100': '#ffffff',
  'base-content': '#1a1a23',
};

/** Human labels for the mandatory tokens — the settings page renders these as fixed, non-deletable rows. */
export const COLOR_TOKEN_LABELS: Readonly<Record<MandatoryColorToken, string>> = {
  primary: 'Primary Color',
  secondary: 'Secondary Color',
  accent: 'Accent Color',
  neutral: 'Neutral Color',
  'base-100': 'Background Color',
  'base-content': 'Text Color',
};

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

// --- Social profiles (link + display name + icon) ---

/** Icon for a social link: a Lucide glyph name or a `brand:<slug>` social logo.
 *  A slug may start with a digit (e.g. `brand:500px`) — matching the simple-icons catalog. */
const SocialIconSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^(?:brand:)?[a-z0-9][a-z0-9-]*$/, 'invalid icon name');

/** Display name for a social link (rendered — escaped — in templates; length-bounded). */
const SocialNameSchema = z.string().max(60);

/** One social/external profile: an absolute http(s) URL plus an optional display name + icon. */
export const SocialLinkSchema = z.object({
  link: AbsoluteUrlSchema,
  name: SocialNameSchema.optional(),
  icon: SocialIconSchema.optional(),
});
export type SocialLink = z.infer<typeof SocialLinkSchema>;

/**
 * Known social providers → display name + icon, matched by host. Icons are `brand:<slug>` where a
 * brand logo exists, else a Lucide glyph (LinkedIn has no brand: logo — simple-icons dropped it).
 * Entry shape: [host suffixes, name, icon].
 */
const SOCIAL_PROVIDERS: ReadonlyArray<readonly [readonly string[], string, string]> = [
  [['wa.me', 'whatsapp.com'], 'WhatsApp', 'brand:whatsapp'],
  [['x.com', 'twitter.com'], 'X', 'brand:x'],
  [['github.com'], 'GitHub', 'brand:github'],
  [['youtube.com', 'youtu.be'], 'YouTube', 'brand:youtube'],
  [['instagram.com'], 'Instagram', 'brand:instagram'],
  [['facebook.com', 'fb.com', 'fb.me'], 'Facebook', 'brand:facebook'],
  [['tiktok.com'], 'TikTok', 'brand:tiktok'],
  [['discord.com', 'discord.gg'], 'Discord', 'brand:discord'],
  [['t.me', 'telegram.org'], 'Telegram', 'brand:telegram'],
  [['pinterest.com'], 'Pinterest', 'brand:pinterest'],
  [['reddit.com'], 'Reddit', 'brand:reddit'],
  [['mastodon.social'], 'Mastodon', 'brand:mastodon'],
  [['medium.com'], 'Medium', 'brand:medium'],
  [['vimeo.com'], 'Vimeo', 'brand:vimeo'],
  [['spotify.com'], 'Spotify', 'brand:spotify'],
  [['snapchat.com'], 'Snapchat', 'brand:snapchat'],
  [['behance.net'], 'Behance', 'brand:behance'],
  [['dribbble.com'], 'Dribbble', 'brand:dribbble'],
  [['bsky.app', 'bsky.social'], 'Bluesky', 'brand:bluesky'],
  [['threads.net', 'threads.com'], 'Threads', 'brand:threads'],
  [['twitch.tv'], 'Twitch', 'brand:twitch'],
  [['kick.com'], 'Kick', 'brand:kick'],
  [['signal.me', 'signal.group'], 'Signal', 'brand:signal'],
  [['soundcloud.com'], 'SoundCloud', 'brand:soundcloud'],
  [['bandcamp.com'], 'Bandcamp', 'brand:bandcamp'],
  [['tumblr.com'], 'Tumblr', 'brand:tumblr'],
  [['flickr.com'], 'Flickr', 'brand:flickr'],
  [['vk.com'], 'VK', 'brand:vk'],
  [['xing.com'], 'Xing', 'brand:xing'],
  [['patreon.com'], 'Patreon', 'brand:patreon'],
  [['ko-fi.com'], 'Ko-fi', 'brand:kofi'],
  [['substack.com'], 'Substack', 'brand:substack'],
  [['linkedin.com'], 'LinkedIn', 'linkedin'],
];

/** Capitalize a host's first label (`acme.com` → `Acme`) — a fallback name for an unknown provider. */
function hostLabelName(host: string): string {
  const label = host.split('.')[0] ?? host;
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : host;
}

/**
 * Best-effort `{ name, icon }` for a social URL, by host; `{}` for an unparseable URL. Used to
 * AUTO-FILL a social link's name + icon (in the editor + the legacy-array migration) — always
 * overridable by the author. Unknown hosts get a capitalized hostname + a generic `globe` icon.
 */
export function detectSocial(url: string): { name?: string; icon?: string } {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return {};
  }
  for (const [suffixes, name, icon] of SOCIAL_PROVIDERS) {
    if (suffixes.some((s) => host === s || host.endsWith(`.${s}`))) return { name, icon };
  }
  return { name: hostLabelName(host), icon: 'globe' };
}

/**
 * Migrate the legacy `social: string[]` (bare URLs) into `social: SocialLink[]` with an auto-detected
 * name + icon per URL. Idempotent — an already-object array passes straight through. Runs on every
 * identity parse (z.preprocess), so stored projects migrate on the next read/write.
 */
export function migrateSocialLinks(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.social) || !v.social.some((s) => typeof s === 'string')) return value;
  const social = v.social.map((s) => (typeof s === 'string' ? { link: s, ...detectSocial(s) } : s));
  return { ...v, social };
}

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

/**
 * A self-hosted font file name (and URL segment): `<family-slug>-<weight>[-italic].<ext>` — e.g.
 * `playfair-display-700.woff2` (the older `<weight>[-italic].<ext>` scheme like `400.woff2` also
 * matches). The regex guards what MATTERS for safety — path-safety (lowercase alnum + `-` only, no
 * `/`/`.`/traversal, leading alnum) and a real font extension; the weight/style are validated
 * separately by their own fields. Deliberately FLAT (no nested/overlapping quantifiers) so it can't
 * ReDoS — see the per-segment note in media.ts.
 */
export const FontFileNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,150}\.(woff2|woff|ttf|otf)$/, 'invalid font file name');

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
const CorporateIdentityObject = z.object({
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
  /** Google Maps EMBED URL — used as an <iframe> src in templates (e.g. the footer map). */
  mapUrl: AbsoluteUrlSchema.optional(),
  /** External booking / reservation / appointment URL (a scheduling service, e.g. a "Book now"
   *  link). Available in templates as `{{ company.bookingUrl }}`. */
  bookingUrl: AbsoluteUrlSchema.optional(),
  /** Social / external profiles (link + display name + icon) → schema.org `sameAs` (the links). */
  social: z.array(SocialLinkSchema).max(50).optional(),

  // --- Design tokens (compiled to CSS custom properties + Tailwind theme) ---
  /**
   * Token name → CSS color value (e.g. `primary` → `#0a7`). Keys may use the DaisyUI/Tailwind
   * semantic names incl. hyphens (`base-100`, `base-content`). The {@link MANDATORY_COLOR_TOKENS}
   * are ALWAYS present: the transform fills any that are missing with {@link DEFAULT_BRAND_COLORS},
   * so a project (or a `colors:{}`) can never end up without them — author values win, a removed
   * one snaps back to its default. Extra (custom) colors pass through untouched.
   */
  colors: safeRecord(CssColorSchema, ColorTokenKeySchema)
    .default({})
    // Annotate the output as a plain string map: the mandatory keys are guaranteed at RUNTIME, but
    // typing them as required statically would force every `colors` literal to spell out all six.
    .transform((c): Record<string, string> => ({ ...DEFAULT_BRAND_COLORS, ...c })),
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

/** Migrates a legacy `social: string[]` into SocialLink objects, then validates the identity object. */
export const CorporateIdentitySchema = z.preprocess(migrateSocialLinks, CorporateIdentityObject);
export type CorporateIdentity = z.infer<typeof CorporateIdentitySchema>;

/**
 * The token-bearing slice of a CorporateIdentity — what the renderer / Tailwind /
 * brand-css compilers actually consume. A full `CorporateIdentity` is structurally
 * assignable to this, so callers pass the whole identity without a projection.
 */
export type BrandTokens = Pick<CorporateIdentity, 'colors' | 'typography' | 'spacing' | 'radii'>;
