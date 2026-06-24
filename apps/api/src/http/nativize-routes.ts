// Streamed server-side nativize: turn a project's imported (rawFidelity) pages into native Tailwind+token
// source, emitting per-page progress over SSE (same frame shape as the import route, so the editor's
// progress UI is reused). Owner-only + content:write; one job per project + a small global cap; the
// headless capture is additionally bounded by the shared render-slot. Mirrors import-routes' SSE pattern.
import type { FastifyInstance, FastifyRequest, FastifyBaseLogger } from 'fastify';
import type { ContentRepository } from '../repo/content.js';
import type { ProjectContext } from '../repo/context.js';
import type { RenderPool } from '../render/render-pool.js';
import { nativizeProject } from '../render/nativize-project.js';

export interface NativizeRouteDeps {
  resolveProject: (
    req: FastifyRequest<{ Params: { projectId: string } }>,
    access: 'content:write',
  ) => Promise<{ ctx: ProjectContext; project: { id: string; name: string; slug: string } }>;
  contentRepo: ContentRepository;
  /** The Handlebars render pool (renders each page's literal source before the headless capture). */
  renderPool?: RenderPool;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
  log: FastifyBaseLogger;
}

const MAX_CONCURRENT = 2;
const active = new Set<string>(); // per-project lock
let activeCount = 0; // global cap

export function registerNativizeRoutes(app: FastifyInstance, deps: NativizeRouteDeps): void {
  const { resolveProject, contentRepo, renderPool, rl, log } = deps;

  app.post<{ Params: { projectId: string } }>('/projects/:projectId/nativize/stream', { config: rl(3) }, async (req, reply) => {
    const { ctx, project } = await resolveProject(req, 'content:write');
    if (ctx.role !== 'owner') return reply.code(403).send({ error: 'only the project owner can nativize a site' });
    if (!renderPool) return reply.code(503).send({ error: 'rendering is not available' });
    if (active.has(project.id)) return reply.code(409).send({ error: 'a nativize is already in progress for this project' });
    if (activeCount >= MAX_CONCURRENT) return reply.code(429).send({ error: 'too many nativize jobs in progress; try again shortly' });

    active.add(project.id);
    activeCount += 1;
    const port = req.socket.localPort ?? (Number(process.env.PORT) || 80);
    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown): void => { raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    try {
      const report = await nativizeProject(
        ctx,
        { contentRepo, renderPool, originHostPort: `127.0.0.1:${port}`, log, signal: abort.signal },
        (e) => send('progress', e),
      );
      send('done', { report });
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err), projectId: project.id }, 'nativize failed');
      send('error', { message: 'nativize failed' }); // generic — never leak host internals
    } finally {
      active.delete(project.id);
      activeCount -= 1;
      raw.end();
    }
  });
}
