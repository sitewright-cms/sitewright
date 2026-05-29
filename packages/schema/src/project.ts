import { z } from 'zod';
import { BrandSchema } from './brand.js';
import { IdSchema, SlugSchema } from './primitives.js';

/**
 * On-disk project format version. Bumped only on **incompatible** changes; the
 * CLI and API refuse to open a project with a newer format than they support.
 */
export const PROJECT_FORMAT_VERSION = 1;

export const ProjectSettingsSchema = z
  .object({
    defaultLocale: z.string().max(35).default('en'),
    locales: z.array(z.string().max(35)).min(1).max(100).default(['en']),
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
  settings: ProjectSettingsSchema.default({}),
});
export type Project = z.infer<typeof ProjectSchema>;
