import type { FastifyReply } from 'fastify';
import { DatasetSlugSchema } from '@sitewright/schema';
import type { ContentKind } from '../db/schema.js';

/**
 * Resolve the storage SCOPE for addressing a single content entity by id. An `entry` is keyed within its
 * dataset (its id is only unique per-dataset), so its owning dataset MUST arrive as `?dataset=<slug>` and
 * is validated against `DatasetSlugSchema` (same charset the stored slug uses) — a missing OR malformed
 * value is a 400 (this sends the reply and returns `undefined`, so the caller bails). Every other kind is
 * project-global, so the query param is ignored and the scope is `''`.
 */
export function entryScope(kind: ContentKind, dataset: string | undefined, reply: FastifyReply): string | undefined {
  if (kind !== 'entry') return '';
  const parsed = DatasetSlugSchema.safeParse(dataset);
  if (!parsed.success) {
    void reply.code(400).send({ error: 'a valid `dataset` query parameter is required to address an entry' });
    return undefined;
  }
  return parsed.data;
}
