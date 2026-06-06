import { z } from 'zod';
import { IdSchema } from './primitives.js';

/**
 * A reference to a page template: either a PROJECT template entity (plain id)
 * or a built-in GLOBAL template (`global:<key>`, shipped with the platform —
 * see `@sitewright/core` GLOBAL_TEMPLATES).
 */
export const TemplateRefSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^(?:global:)?[A-Za-z0-9_-]+$/, 'must be an id, optionally prefixed "global:"');

/**
 * A reusable CODE-FIRST page template: a page that references one (via
 * `Page.template`) renders the TEMPLATE's Handlebars `source` — the page
 * contributes only its `{{edit}}` region content (and settings/SEO). The
 * editor can "fork" a template into a page (copy the source, drop the
 * reference) to customize it.
 *
 * The legacy block-tree template model (an `Outlet` wrap around `root`) is
 * RETIRED — templates are Handlebars sources, like pages.
 */
export const TemplateSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(200),
  /** Handlebars source (HTML + Tailwind + {{edit}} regions) the page renders. */
  source: z.string().max(256 * 1024),
});
export type Template = z.infer<typeof TemplateSchema>;
