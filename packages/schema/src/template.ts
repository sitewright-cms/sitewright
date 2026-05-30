import { z } from 'zod';
import { PageNodeSchema } from './block.js';
import { IdSchema } from './primitives.js';

/**
 * A reusable page layout (contentBase's "templates"). A page may reference a
 * template via `Page.template`; at build time the template's tree wraps the
 * page, with the page's own content injected at the template's single `Outlet`
 * node (`type: 'Outlet'`). Templates may themselves use partials.
 */
export const TemplateSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(200),
  root: PageNodeSchema,
});
export type Template = z.infer<typeof TemplateSchema>;
