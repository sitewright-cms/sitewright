import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  StockImportSchema,
  StockProviderNameSchema,
  type MediaAsset,
  type StockProviderName,
  type StockProvidersStatus,
  type StockSearchResult,
} from '@sitewright/schema';
import { StockNotConfiguredError, StockUnknownProviderError } from '../stock/service.js';
import { StockProviderError } from '../stock/providers.js';
import { MediaValidationError } from '../media/errors.js';
import { EncryptionUnavailableError } from '../repo/instance-settings.js';
import type { ProjectContext } from '../repo/context.js';
import type { ApiKeyCapability } from '../db/schema.js';

const MAX_QUERY_LEN = 200;

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

/** The subset of StockService the routes use (so tests can inject a fake). */
export interface StockServiceLike {
  availability(): Promise<StockProvidersStatus>;
  search(name: StockProviderName, query: string, page: number): Promise<StockSearchResult>;
  fetchForImport(
    name: StockProviderName,
    id: string,
  ): Promise<{ buffer: Buffer; contentType: string; attribution: NonNullable<MediaAsset['attribution']> } | null>;
}

export interface StockRoutesDeps {
  resolveProject: (
    req: ProjectReq,
    access: ApiKeyCapability | 'session-only',
  ) => Promise<{ ctx: ProjectContext; project: { id: string } }>;
  isWriter: (ctx: ProjectContext) => boolean;
  stockService: StockServiceLike;
  createMediaAsset: (
    ctx: ProjectContext,
    projectId: string,
    buffer: Buffer,
    meta: { filename: string; mimetype: string; alt?: string; attribution?: MediaAsset['attribution'] },
  ) => Promise<MediaAsset>;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

/**
 * Stock-image search + import. The provider API keys stay server-side (instance
 * settings); search returns provider-hosted thumbnails for preview, and import
 * downloads + optimizes + self-hosts the full image as a normal media asset (with
 * attribution) so the static export stays portable.
 */
export function registerStockRoutes(app: FastifyInstance, deps: StockRoutesDeps): void {
  const { resolveProject, isWriter, stockService, createMediaAsset, rl } = deps;

  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/stock/providers',
    { config: rl(60) },
    async (req, reply) => {
      await resolveProject(req, 'content:read');
      return reply.send(await stockService.availability());
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/stock/search',
    { config: rl(30) },
    async (req, reply) => {
      await resolveProject(req, 'content:read');
      const q = req.query as { provider?: string; q?: string; page?: string };
      const provider = StockProviderNameSchema.safeParse(q.provider);
      if (!provider.success) return reply.code(400).send({ error: 'unknown or missing provider' });
      const query = (q.q ?? '').trim();
      if (!query || query.length > MAX_QUERY_LEN) return reply.code(400).send({ error: 'missing or oversized query' });
      const page = q.page ? Number(q.page) : 1;
      try {
        return reply.send(await stockService.search(provider.data, query, page));
      } catch (err) {
        return mapStockError(err, reply);
      }
    },
  );

  app.post<{ Params: { projectId: string } }>(
    '/projects/:projectId/stock/import',
    { config: rl(20) },
    async (req, reply) => {
      const { ctx, project } = await resolveProject(req, 'content:write');
      if (!isWriter(ctx)) return reply.code(403).send({ error: 'insufficient role for this operation' });
      const body = StockImportSchema.parse(req.body);
      try {
        const fetched = await stockService.fetchForImport(body.provider, body.id);
        if (!fetched) return reply.code(404).send({ error: 'stock image not found' });
        const asset = await createMediaAsset(ctx, project.id, fetched.buffer, {
          // id is display-only here (the on-disk path uses a UUID), but strip path-ish
          // characters so the stored filename stays clean.
          filename: `${body.provider}-${body.id.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
          mimetype: fetched.contentType,
          ...(body.alt ? { alt: body.alt } : {}),
          attribution: fetched.attribution,
        });
        return reply.code(201).send({ item: asset });
      } catch (err) {
        if (err instanceof MediaValidationError) return reply.code(400).send({ error: err.message });
        return mapStockError(err, reply);
      }
    },
  );
}

function mapStockError(err: unknown, reply: FastifyReply) {
  if (err instanceof StockNotConfiguredError) return reply.code(400).send({ error: err.message });
  if (err instanceof StockUnknownProviderError) return reply.code(404).send({ error: err.message });
  if (err instanceof EncryptionUnavailableError) return reply.code(503).send({ error: err.message });
  if (err instanceof StockProviderError) return reply.code(502).send({ error: 'stock provider unavailable — please try again' });
  throw err;
}
