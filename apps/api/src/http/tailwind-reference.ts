// The Tailwind CSS reference payload served to the editor's Library.
//
// STATIC platform data — every utility class the bundled Tailwind can generate, the CSS each one
// produces, and the authored per-topic prose. No tenant data participates, so it is computed once
// per process and served to everyone from the same buffer.
//
// It is served pre-serialized rather than as an object because it is ~1.8 MB: returning the object
// would make Fastify re-run JSON.stringify over the whole dataset on EVERY request. Serializing once
// turns each request into a buffer write (and, with the ETag below, usually a 304 with no body).
import { createHash } from 'node:crypto';
import { tailwindReference } from '@sitewright/tailwind-reference';

interface Payload {
  body: string;
  etag: string;
}

let cache: Payload | null = null;

/**
 * The serialized reference + a strong ETag over its bytes.
 *
 * The ETag is content-derived rather than version-derived on purpose: the dataset changes when the
 * Tailwind version changes OR when the authored prose does, and only hashing the output catches both.
 */
export function tailwindReferencePayload(): Payload {
  if (cache) return cache;
  const body = JSON.stringify(tailwindReference());
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
  cache = { body, etag };
  return cache;
}
