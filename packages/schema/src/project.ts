import { z } from 'zod';
import { BrandSchema } from './brand.js';
import { CompanySchema } from './company.js';
import { WebsiteSettingsSchema } from './website.js';
import { IdSchema, SlugSchema } from './primitives.js';

/**
 * On-disk project format version. Bumped only on **incompatible** changes; the
 * CLI and API refuse to open a project with a newer format than they support.
 */
export const PROJECT_FORMAT_VERSION = 1;

// A BCP-47-ish locale tag. Constrained because the locale is used as a URL path
// segment + directory name in the published output (e.g. `/de/…`), so it must be
// a safe identifier — no slashes, dots, or traversal.
const LocaleSchema = z
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
  brand: BrandSchema,
  /** Corporate identity (the `company.*` namespace); drives schema.org + favicon/OG. */
  company: CompanySchema.optional(),
  /** Project-wide website settings (the `website.*` namespace): critical CSS, custom head/footer. */
  website: WebsiteSettingsSchema.optional(),
  settings: ProjectSettingsSchema.default({}),
});
export type Project = z.infer<typeof ProjectSchema>;
