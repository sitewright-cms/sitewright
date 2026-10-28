import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { BookingConfig } from '@sitewright/schema';
import type { ApiKeyCapability } from '../db/schema.js';
import type { ProjectContext } from '../repo/context.js';
import { CALENDAR_LIMITS, feedUrl, type BookingCalendarRepository, type CalendarReader, type CalendarRow } from '../booking/calendars.js';
import type { EncryptedSecret } from '../crypto/secret.js';
import { davUrl, type DavAuth, type FoundCalendar } from '../booking/caldav.js';

/**
 * A resource's OUTSIDE CALENDARS: the iCalendar feeds its busy times are read from.
 *
 *   GET    /projects/:projectId/booking/calendars             the calendars, and how their last reading went
 *   POST   /projects/:projectId/booking/calendars             connect one (read at once, so the answer says if it works)
 *   POST   /projects/:projectId/booking/calendars/:id/test    read it again now
 *   DELETE /projects/:projectId/booking/calendars/:id
 *   POST   /projects/:projectId/booking/calendars/discover    a CalDAV account's calendars (nothing is stored)
 *   PATCH  /projects/:projectId/booking/calendars/:id         `{writes}`: a CalDAV calendar takes the bookings, or not
 *
 * Two kinds: an iCalendar feed's address (`ics`), or a calendar on a CalDAV server (`caldav`: its address, a
 * username and an app password, all three encrypted together).
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
  /** Puts a calendar's resource's upcoming bookings into it (it starts taking them). Absent: no writing. */
  backfill?: (calendar: CalendarRow) => Promise<number>;
  /** Drops what was still to be written into a calendar that is removed. */
  forgetWrites?: (calendarId: string) => Promise<void>;
  /** A CalDAV account's calendars. Absent: CalDAV is not offered. */
  discoverCalDav?: (serverUrl: string, auth: DavAuth) => Promise<{ ok: true; calendars: FoundCalendar[] } | { ok: false; error: string }>;
  resolveProject: (req: ProjectReq, access: ApiKeyCapability | 'session-only') => Promise<{ ctx: ProjectContext; project: { id: string } }>;
  isWriter: (ctx: ProjectContext) => boolean;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
  now?: () => number;
}

const ConnectSchema = z.union([
  z.strictObject({
    kind: z.literal('ics').optional(),
    resourceId: z.string().min(1).max(48),
    name: z.string().trim().min(1).max(120),
    url: z.string().trim().min(1).max(2048),
  }),
  z.strictObject({
    kind: z.literal('caldav'),
    resourceId: z.string().min(1).max(48),
    name: z.string().trim().min(1).max(120),
    url: z.string().trim().min(1).max(2048),
    username: z.string().min(1).max(320),
    password: z.string().min(1).max(1024),
    /** Also put the bookings into it (and take them out when cancelled). */
    writes: z.boolean().optional(),
  }),
]);

const WritesSchema = z.strictObject({ writes: z.boolean() });

const DiscoverSchema = z.strictObject({
  url: z.string().trim().min(1).max(2048),
  username: z.string().min(1).max(320),
  password: z.string().min(1).max(1024),
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
    writes: c.writes,
    writeError: c.writeError,
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
    if (!input.success) return reply.code(400).send({ error: 'resourceId, name and url are needed (and a username and password for CalDAV)' });
    const timeZone = zoneOf(await deps.readConfig(project.id), input.data.resourceId);
    if (!timeZone) return reply.code(400).send({ error: `there is no resource "${input.data.resourceId}" in the booking set-up` });
    const caldav = input.data.kind === 'caldav';
    if (caldav && !deps.discoverCalDav) return reply.code(400).send({ error: 'CalDAV calendars are not available on this server' });
    const url = caldav ? davUrl(input.data.url)?.href ?? null : feedUrl(input.data.url);
    if (!url) return reply.code(400).send({ error: caldav ? 'the calendar address must start with https://' : 'the address must be an https:// (or webcal://) address' });
    if ((await deps.calendars.count(project.id)) >= CALENDAR_LIMITS.perProject) {
      return reply.code(409).send({ error: `a project connects at most ${CALENDAR_LIMITS.perProject} calendars` });
    }
    // ★ A CalDAV calendar's address, username and password are one secret, encrypted together.
    const secret = input.data.kind === 'caldav' ? JSON.stringify({ url, username: input.data.username, password: input.data.password }) : url;
    const row = await deps.calendars.insert(
      {
        projectId: project.id,
        resourceId: input.data.resourceId,
        kind: caldav ? 'caldav' : 'ics',
        name: input.data.name,
        url: deps.encrypt(secret),
        host: new URL(url).host,
        writes: input.data.kind === 'caldav' && input.data.writes === true && !!deps.backfill,
      },
      now(),
    );
    if (row.writes) void deps.backfill?.(row).catch((err: unknown) => req.log.warn({ err, calendarId: row.id }, 'could not put the upcoming bookings into a calendar'));
    return reply.code(201).send(await readNow(project.id, row, timeZone));
  });

  // A CalDAV account's calendars, to pick one. Nothing is stored; the password is only used for this.
  app.post<{ Params: { projectId: string } }>('/projects/:projectId/booking/calendars/discover', { config: deps.rl(10), bodyLimit: 8 * 1024 }, async (req, reply) => {
    const { ok } = await writer(req, 'content:write');
    if (!ok) return reply.code(403).send({ error: 'insufficient role for this operation' });
    if (!deps.discoverCalDav) return reply.code(400).send({ error: 'CalDAV calendars are not available on this server' });
    const input = DiscoverSchema.safeParse(req.body);
    if (!input.success) return reply.code(400).send({ error: 'the server address, a username and a password are needed' });
    const found = await deps
      .discoverCalDav(input.data.url, { username: input.data.username, password: input.data.password })
      .catch(() => ({ ok: false as const, error: 'the calendar server answered something that could not be read' }));
    reply.header('cache-control', 'no-store');
    return found.ok ? reply.send({ calendars: found.calendars }) : reply.code(400).send({ error: found.error });
  });

  app.post<{ Params: { projectId: string; id: string } }>('/projects/:projectId/booking/calendars/:id/test', { config: deps.rl(20) }, async (req, reply) => {
    const { project, ok } = await writer(req as unknown as ProjectReq, 'content:write');
    if (!ok) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const row = await deps.calendars.get(project.id, req.params.id);
    if (!row) return reply.code(404).send({ error: 'there is no such calendar' });
    const timeZone = zoneOf(await deps.readConfig(project.id), row.resourceId) ?? 'UTC';
    return reply.send(await readNow(project.id, row, timeZone));
  });

  app.patch<{ Params: { projectId: string; id: string } }>('/projects/:projectId/booking/calendars/:id', { config: deps.rl(30), bodyLimit: 1024 }, async (req, reply) => {
    const { project, ok } = await writer(req as unknown as ProjectReq, 'content:write');
    if (!ok) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const input = WritesSchema.safeParse(req.body);
    if (!input.success) return reply.code(400).send({ error: '{"writes": true|false} is expected' });
    const row = await deps.calendars.get(project.id, req.params.id);
    if (!row) return reply.code(404).send({ error: 'there is no such calendar' });
    if (row.kind !== 'caldav' || (input.data.writes && !deps.backfill)) return reply.code(400).send({ error: 'only a CalDAV calendar takes the bookings' });
    await deps.calendars.setWrites(project.id, row.id, input.data.writes);
    const fresh = (await deps.calendars.get(project.id, row.id)) ?? row;
    // Switched on: the upcoming bookings go in now. Switched off: what is there stays (it is the business's calendar).
    if (input.data.writes && !row.writes) void deps.backfill?.(fresh).catch((err: unknown) => req.log.warn({ err, calendarId: row.id }, 'could not put the upcoming bookings into a calendar'));
    return reply.send({ calendar: view(fresh) });
  });

  app.delete<{ Params: { projectId: string; id: string } }>('/projects/:projectId/booking/calendars/:id', { config: deps.rl(30) }, async (req, reply) => {
    const { project, ok } = await writer(req as unknown as ProjectReq, 'content:write');
    if (!ok) return reply.code(403).send({ error: 'insufficient role for this operation' });
    const row = await deps.calendars.get(project.id, req.params.id);
    if (!row || !(await deps.calendars.remove(project.id, row.id))) return reply.code(404).send({ error: 'there is no such calendar' });
    deps.reader.forget(row);
    await deps.forgetWrites?.(row.id);
    return reply.send({ ok: true });
  });
}
