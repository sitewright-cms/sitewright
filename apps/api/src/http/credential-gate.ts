import type { IncomingHttpHeaders } from 'node:http';

/**
 * Which requests must prove who is calling BEFORE their body is read.
 *
 * Every write under `/projects`, `/admin`, `/account` and `/invites` needs a session or a bearer, but each
 * route asks for it inside its handler — after Fastify has read and parsed the body, up to the route's
 * limit: 4 MiB for a content save or an import, 60 MiB for a message to the on-page agent. So a caller with
 * no credential at all could make the server read and parse that much, per request, only to be told 401
 * afterwards. The pre-parse hook in app.ts refuses such a request first.
 *
 * Matched on the ROUTE PATTERN (`req.routeOptions.url`), not the raw URL: the router has already decided
 * which handler runs, so an odd spelling of the path cannot slip past, and an unknown path (no route) is
 * left to the 404 handler. That one still parses a body it never uses, within the app's default 1 MiB limit
 * and its own rate limit; gating it would put credential lookups ahead of that limiter, which runs later.
 *
 * The public write routes (forms, bookings, checkout, webhooks, the statistics beacon, sign-in, OAuth) live
 * elsewhere and are not matched. Two others check their own credential before the body: `/mcp` (its OAuth
 * challenge has a shape of its own) and `/media-upload/:token` (the upload ticket).
 * `credential-gate.test.ts` holds every registered write route to one of those lists, so a new route has to
 * be placed deliberately.
 */
const AUTHENTICATED_PREFIX = /^\/(?:projects|admin|account|invites)(?:\/|$)/;

export function credentialRequiredBeforeBody(method: string, routeUrl: string | undefined): boolean {
  // Fastify never reads a body for these.
  if (method === 'GET' || method === 'HEAD') return false;
  return routeUrl !== undefined && AUTHENTICATED_PREFIX.test(routeUrl);
}

/** Whether the request announces a body. One that carries none costs nothing to parse, and keeps the route's own answer. */
export function requestCarriesBody(headers: IncomingHttpHeaders): boolean {
  if (headers['transfer-encoding'] !== undefined) return true;
  const length = headers['content-length'];
  return length !== undefined && length !== '0';
}
