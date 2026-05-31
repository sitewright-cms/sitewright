import { z } from 'zod';
import { CorporateIdentitySchema } from './corporate-identity.js';
import { WebsiteSettingsSchema } from './website.js';
import { IdSchema, SlugSchema } from './primitives.js';

/**
 * On-disk project format version. Bumped only on **incompatible** changes; the
 * CLI and API refuse to open a project with a newer format than they support.
 * v2: merged the split `brand` + `company` into a single `identity` record
 * (the unified Corporate Identity; see migrate-identity.ts for the normalizer).
 */
export const PROJECT_FORMAT_VERSION = 2;

// A BCP-47-ish locale tag. Constrained because the locale is used as a URL path
// segment + directory name in the published output (e.g. `/de/…`), so it must be
// a safe identifier — no slashes, dots, or traversal.
export const LocaleSchema = z
  .string()
  .min(1)
  .max(35)
  .regex(/^[A-Za-z0-9-]+$/, 'locale must be alphanumeric with hyphens (e.g. en, de, pt-BR)');

export const ProjectSettingsSchema = z
  .object({
    defaultLocale: LocaleSchema.default('en'),
    locales: z.array(LocaleSchema).min(1).max(100).default(['en']),
  })
  .superRefine((settings, ctx) => {
    if (!settings.locales.includes(settings.defaultLocale)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaultLocale'],
        message: `defaultLocale "${settings.defaultLocale}" must be one of locales`,
      });
    }
  });
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

/** The top-level project manifest (`sitewright.json`). */
export const ProjectSchema = z.object({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  id: IdSchema,
  name: z.string().min(1).max(200),
  slug: SlugSchema,
  /** Unified Corporate Identity: company info + brand tokens; drives schema.org, favicon/OG, and brand CSS. */
  identity: CorporateIdentitySchema,
  /** Project-wide website settings (the `website.*` namespace): critical CSS, custom head/footer. */
  website: WebsiteSettingsSchema.optional(),
  settings: ProjectSettingsSchema.default({}),
});
export type Project = z.infer<typeof ProjectSchema>;
