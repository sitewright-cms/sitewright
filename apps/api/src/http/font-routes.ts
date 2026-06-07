import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { FONT_WEIGHTS } from '@sitewright/schema';
import type { ProjectContext } from '../repo/context.js';
import type { ApiKeyCapability } from '../db/schema.js';
import { FONT_ID, WOFF2_FILE, type FontStore } from '../fonts/store.js';
import { selectGoogleFont, FontFetchError } from '../fonts/service.js';
import { FontWeightSchema } from '@sitewright/schema';

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

const SelectBody = z.object({
  family: z.string().min(1).max(100),
  weights: z.array(FontWeightSchema).min(1).max(FONT_WEIGHTS.length),
});

export interface FontRoutesDeps {
  resolveProject: (
    req: ProjectReq,
    access: ApiKeyCapability | 'session-only',
  ) => Promise<{ ctx: ProjectContext; project: { id: string } }>;
  isWriter: (ctx: ProjectContext) => boolean;
  fontStore: FontStore;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

/**
 * Google Fonts self-hosting. `POST …/fonts/select` downloads a family's weights server-side
 * (the only Google contact — see fonts/service.ts) into the instance cache and returns the
 * project-referencable record; the editor adds it to `typography.fonts` + the slot via the normal
 * settings save. `GET /fonts/:id/:file` serves the cached woff2 (public; fonts are public assets) —
 * inline + nosniff + CORS so the opaque-origin preview iframe can load it.
 */
export function registerFontRoutes(app: FastifyInstance, deps: FontRoutesDeps): void {
  const { resolveProject, isWriter, fontStore, rl } = deps;

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

  app.get<{ Params: { fontId: string; file: string } }>('/fonts/:fontId/:file', async (req, reply) => {
    const { fontId, file } = req.params;
    // Validate BOTH segments at the route boundary (the store re-checks, but fail fast + auditably).
    if (!FONT_ID.test(fontId) || !WOFF2_FILE.test(file)) return reply.code(404).send({ error: 'not found' });
    let bytes: Buffer;
    try {
      bytes = await fontStore.read(fontId, file);
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      // Fonts are CORS-restricted; the sandboxed (opaque-origin) preview iframe loads them
      // cross-origin, so allow it. The bytes are a public, immutable woff2 — no risk.
      .header('access-control-allow-origin', '*')
      .header('cross-origin-resource-policy', 'cross-origin')
      .type('font/woff2')
      .send(bytes);
  });
}
