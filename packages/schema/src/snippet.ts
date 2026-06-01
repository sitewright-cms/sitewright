import { z } from 'zod';
import { IdSchema } from './primitives.js';

/**
 * A reusable code-first fragment: a named Handlebars partial (HTML + Tailwind + `{{ }}`)
 * that templates include via `{{> name}}`. This is the code-first counterpart to the
 * block-tree {@link SitewrightPartial} (which the templating pivot supersedes). The
 * `source` is validated when rendered (no scripts, inline handlers, raw output, or
 * other unsafe HTML contexts).
 */
export const SnippetSchema = z.object({
  id: IdSchema,
  // A valid Handlebars partial name (so it is always referenceable via `{{> name}}` and
  // can't carry control/whitespace/mustache-significant characters).
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'snippet name must be a valid identifier (letters, digits, _ , -)'),
  source: z.string().max(256 * 1024),
});

export type Snippet = z.infer<typeof SnippetSchema>;
