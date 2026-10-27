import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { BookingConfig } from '@sitewright/schema';
import type { ApiKeyCapability } from '../db/schema.js';
import type { ProjectContext } from '../repo/context.js';
import { CALENDAR_LIMITS, feedUrl, type BookingCalendarRepository, type CalendarReader, type CalendarRow } from '../booking/calendars.js';
import type { EncryptedSecret } from '../crypto/secret.js';

/**
 * A resource's OUTSIDE CALENDARS: the iCalendar feeds its busy times are read from.
 *
 *   GET    /projects/:projectId/booking/calendars             the calendars, and how their last reading went
 *   POST   /projects/:projectId/booking/calendars             connect one (read at once, so the answer says if it works)
 *   POST   /projects/:projectId/booking/calendars/:id/test    read it again now
 *   DELETE /projects/:projectId/booking/calendars/:id
 *
 * ★ A feed's address READS the calendar (Google calls it the "secret address"), so it is a credential: entered
 * here, stored encrypted, never returned (only its host is), never exported, never in the booking set-up's
 * content. Writers only, as for the project's SMTP and captcha.
 */

type ProjectReq = FastifyRequest<{ Params: { projectId: string } }>;

export interface BookingCalendarDeps {
  calendars: BookingCalendarRepository;
  reader: CalendarReader;
  readConfig: (projectId: string) => Promise<BookingConfig | null>;
  encrypt: (plaintext: string) => EncryptedSecret;
  resolveProject: (req: ProjectReq, access: ApiKeyCapability | 'session-only') => Promise<{ ctx: ProjectContext; project: { id: string } }>;
  isWriter: (ctx: ProjectContext) => boolean;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
  now?: () => number;
}

const ConnectSchema = z.strictObject({
  resourceId: z.string().min(1).max(48),
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2048),
});

/** A calendar as the editor sees it: never its address. */
function view(c: CalendarRow): Record<string, unknown> {
  return {
    id: c.id,
    resourceId: c.resourceId,
    kind: c.kind,
    name: c.name,
    host: c.host,
    lastOkAt: c.lastOkAt ? c.lastOkAt.getTime() : null,
    lastError: c.lastError,
    lastEvents: c.lastEvents,
    createdAt: c.createdAt.getTime(),
  };
}

export function registerBookingCalendarRoutes(app: FastifyInstance, deps: BookingCalendarDeps): void {
  const now = deps.now ?? Date.now;
  const writer = async (req: ProjectReq, access: ApiKeyCapability) => {
    const { ctx, project } = await deps.resolveProject(req, access);
    return { ctx, project, ok: deps.isWriter(ctx) };
  };
  const zoneOf = (config: BookingConfig | null, resourceId: string): string | null => config?.resources.find((r) => r.id === resourceId)?.timeZone ?? null;
  /** Reads it now and answers the calendar as it then stands. */
  const readNow = async (projectId: string, row: CalendarRow, timeZone: string) => {
    const reading = await deps.reader.readNow(projectId, row, timeZone);
    const fresh = (await deps.calendars.get(projectId, row.id)) ?? row;
    return { calendar: view(fresh), reading: { ok: reading.error === undefined, ...(reading.error ? { error: reading.error } : {}) } };
  };

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/booking/calendars', { config: deps.rl(60) }, async (req, reply) => {
    const { project, ok } = await writer(req, 'content:read');
    if (!ok) return reply.code(403).send({ error: 'insufficient role for this operation' });
    reply.header('cache-control', 'no-store');
    return reply.send({ calendars: (await deps.calendars.list(project.id)).map(view) });
  });

  app.post<{ Params: { projectId: string } }>('/projects/:projectId/booking/calendars', { config: deps.rl(20), bodyLimit: 8 * 1024 }, async (req, reply) => {
    const { project, ok } = await writer(req, 'content:write');
    if (!ok) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const input = ConnectSchema.safeParse(req.body);
    if (!input.success) return reply.code(400).send({ error: 'resourceId, name and url are needed' });
    const timeZone = zoneOf(await deps.readConfig(project.id), input.data.resourceId);
    if (!timeZone) return reply.code(400).send({ error: `there is no resource "${input.data.resourceId}" in the booking set-up` });
    const url = feedUrl(input.data.url);
    if (!url) return reply.code(400).send({ error: 'the address must be an https:// (or webcal://) address' });
    if ((await deps.calendars.count(project.id)) >= CALENDAR_LIMITS.perProject) {
      return reply.code(409).send({ error: `a project connects at most ${CALENDAR_LIMITS.perProject} calendars` });
    }
    const row = await deps.calendars.insert(
      { projectId: project.id, resourceId: input.data.resourceId, kind: 'ics', name: input.data.name, url: deps.encrypt(url), host: new URL(url).host },
      now(),
    );
    return reply.code(201).send(await readNow(project.id, row, timeZone));
  });

  app.post<{ Params: { projectId: string; id: string } }>('/projects/:projectId/booking/calendars/:id/test', { config: deps.rl(20) }, async (req, reply) => {
    const { project, ok } = await writer(req as unknown as ProjectReq, 'content:write');
    if (!ok) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const row = await deps.calendars.get(project.id, req.params.id);
    if (!row) return reply.code(404).send({ error: 'there is no such calendar' });
    const timeZone = zoneOf(await deps.readConfig(project.id), row.resourceId) ?? 'UTC';
    return reply.send(await readNow(project.id, row, timeZone));
  });

  app.delete<{ Params: { projectId: string; id: string } }>('/projects/:projectId/booking/calendars/:id', { config: deps.rl(30) }, async (req, reply) => {
    const { project, ok } = await writer(req as unknown as ProjectReq, 'content:write');
    if (!ok) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const row = await deps.calendars.get(project.id, req.params.id);
    if (!row || !(await deps.calendars.remove(project.id, row.id))) return reply.code(404).send({ error: 'there is no such calendar' });
    deps.reader.forget(row);
    return reply.send({ ok: true });
  });
}
