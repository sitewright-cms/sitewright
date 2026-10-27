import type { FastifyRequest } from 'fastify';

/**
 * SECRETS IN URL PATHS, masked before a request is logged. Fastify logs every request's URL ("incoming
 * request"), and some addresses ARE credentials: the bookings feed's token gives whoever holds it every booking and
 * every customer's contacts, and a calendar app polls it every few minutes. Header and body redaction (the
 * logger's `redact` list) cannot reach a path.
 */
const URL_SECRETS: ReadonlyArray<[RegExp, string]> = [
  // /b/<project>/feed/<token>.ics, also as a request to a site host is rewritten (/sites/<slug>/b/…).
  [/^((?:\/sites\/[^/?#]+)?\/b\/[^/?#]+\/feed\/)[^/?#]*?(\.ics)?(?=[?#]|$)/, '$1***$2'],
];

export function maskUrlSecrets(url: string): string {
  let out = url;
  for (const [re, replacement] of URL_SECRETS) out = out.replace(re, replacement);
  return out;
}

/** The request as logged: Fastify's default fields, with the URL masked. */
export function logRequest(req: FastifyRequest): Record<string, unknown> {
  return {
    method: req.method,
    url: maskUrlSecrets(req.url),
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}
