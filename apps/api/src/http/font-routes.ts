import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { FONT_WEIGHTS, FontWeightSchema } from '@sitewright/schema';
import type { ProjectContext } from '../repo/context.js';
import type { ApiKeyCapability } from '../db/schema.js';
import { FONT_ID, FONT_FILE, type FontStore } from '../fonts/store.js';
import { selectGoogleFont, FontFetchError } from '../fonts/service.js';
import { storeLocalFont, FontUploadError, MAX_FONT_BYTES } from '../fonts/upload.js';

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

const SelectBody = z.object({
  family: z.string().min(1).max(100),
  weights: z.array(FontWeightSchema).min(1).max(FONT_WEIGHTS.length),
});

/** Multipart text fields accompanying an uploaded font file. */
const UploadMeta = z.object({
  family: z.string().min(1).max(100),
  weight: z.coerce.number().int().refine((w) => (FONT_WEIGHTS as readonly number[]).includes(w), 'invalid weight'),
  style: z.enum(['normal', 'italic']).default('normal'),
  fallback: z.enum(['serif', 'sans-serif', 'monospace', 'cursive']).default('sans-serif'),
});

/** A real project id (uuid-ish) — guards the PUBLIC serve route's store-root segment (no resolveProject there). */
const PROJECT_ID = /^[A-Za-z0-9_-]+$/;

/** `@font-face`-friendly content types per stored container (served INLINE, not as an attachment). */
const FONT_CONTENT_TYPES: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};
const contentTypeFor = (file: string): string => FONT_CONTENT_TYPES[file.split('.').pop() ?? ''] ?? 'application/octet-stream';

export interface FontRoutesDeps {
  resolveProject: (
    req: ProjectReq,
    access: ApiKeyCapability | 'session-only',
  ) => Promise<{ ctx: ProjectContext; project: { id: string } }>;
  isWriter: (ctx: ProjectContext) => boolean;
  /** Instance-shared Google cache (a family downloads once across projects). */
  fontStore: FontStore;
  /** Project-scoped store for uploaded (licensed) fonts — isolated per tenant. */
  projectFontStore: (projectId: string) => FontStore;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

function serveFont(reply: import('fastify').FastifyReply, file: string, bytes: Buffer) {
  return reply
    .header('cache-control', 'public, max-age=31536000, immutable')
    .header('x-content-type-options', 'nosniff')
    // Fonts are CORS-restricted; the sandboxed (opaque-origin) preview iframe loads them
    // cross-origin, so allow it. The bytes are a public, immutable font — no risk.
    .header('access-control-allow-origin', '*')
    .header('cross-origin-resource-policy', 'cross-origin')
    .type(contentTypeFor(file))
    .send(bytes);
}

/**
 * Self-hosted fonts. `POST …/fonts/select` downloads a Google family server-side (the only Google
 * contact — see fonts/service.ts) into the instance cache; `POST …/fonts/upload` validates + stores
 * an uploaded font in the PROJECT cache. Both return a `SelfHostedFont` record the editor adds to
 * `typography.fonts` + the slot via the normal settings save. The GET routes serve the stored files
 * (public; fonts are public assets) inline + nosniff + CORS so the opaque-origin preview iframe can
 * load them. Published pages never use these routes — they bundle their fonts into `_assets/_fonts`.
 */
export function registerFontRoutes(app: FastifyInstance, deps: FontRoutesDeps): void {
  const { resolveProject, isWriter, fontStore, projectFontStore, rl } = deps;

  app.post<{ Params: { projectId: string } }>('/projects/:projectId/fonts/select', { config: rl(20) }, async (req, reply) => {
    const { ctx } = await resolveProject(req, 'content:write');
    if (!isWriter(ctx)) return reply.code(403).send({ error: 'forbidden' });
    const parsed = SelectBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid request' });
    try {
      const font = await selectGoogleFont(fontStore, parsed.data.family, parsed.data.weights);
      return reply.send({ font });
    } catch (err) {
      if (err instanceof FontFetchError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  // Upload a local (licensed) font file → validated by magic bytes + size, stored PROJECT-scoped.
  // The font metadata rides as QUERY params (the multipart parser is configured `fields: 0`, mirroring
  // the media upload which takes its `folder` the same way).
  app.post<{ Params: { projectId: string }; Querystring: Record<string, string> }>(
    '/projects/:projectId/fonts/upload',
    { config: rl(20) },
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:write');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'forbidden' });

      const meta = UploadMeta.safeParse({
        family: req.query.family,
        weight: req.query.weight,
        style: req.query.style,
        fallback: req.query.fallback,
      });
      if (!meta.success) return reply.code(400).send({ error: 'invalid font metadata' });

      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'no file uploaded' });
      let data: Buffer;
      try {
        data = await file.toBuffer();
      } catch {
        return reply.code(413).send({ error: 'file exceeds size limit' });
      }
      if (file.file.truncated) return reply.code(413).send({ error: 'file exceeds size limit' });
      // Over the FONT cap (but under the larger multipart cap) → 413 here, so the client can tell
      // "too large" from "wrong format" (storeLocalFont also guards this, as defense-in-depth).
      if (data.length > MAX_FONT_BYTES) return reply.code(413).send({ error: 'file exceeds size limit' });

      try {
        const font = await storeLocalFont(projectFontStore(project.id), { ...meta.data, data });
        return reply.send({ font });
      } catch (err) {
        if (err instanceof FontUploadError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );

  // PUBLIC project-scoped serve (preview): the project store first, then the instance Google cache,
  // so ONE preview `fontUrl(/projects/:id/fonts/:fontId/:file)` resolves both local + google fonts.
  app.get<{ Params: { projectId: string; fontId: string; file: string } }>(
    '/projects/:projectId/fonts/:fontId/:file',
    async (req, reply) => {
      const { projectId, fontId, file } = req.params;
      if (!PROJECT_ID.test(projectId) || !FONT_ID.test(fontId) || !FONT_FILE.test(file)) {
        return reply.code(404).send({ error: 'not found' });
      }
      let bytes: Buffer | undefined;
      try {
        bytes = await projectFontStore(projectId).read(fontId, file);
      } catch {
        try {
          bytes = await fontStore.read(fontId, file); // google fallback (shared cache)
        } catch {
          return reply.code(404).send({ error: 'not found' });
        }
      }
      return serveFont(reply, file, bytes);
    },
  );

  // Back-compat: the instance Google serve (published exports use relative _assets paths, not this).
  app.get<{ Params: { fontId: string; file: string } }>('/fonts/:fontId/:file', async (req, reply) => {
    const { fontId, file } = req.params;
    if (!FONT_ID.test(fontId) || !FONT_FILE.test(file)) return reply.code(404).send({ error: 'not found' });
    let bytes: Buffer;
    try {
      bytes = await fontStore.read(fontId, file);
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
    return serveFont(reply, file, bytes);
  });
}
