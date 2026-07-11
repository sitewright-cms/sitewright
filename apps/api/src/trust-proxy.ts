/**
 * Parse the `TRUST_PROXY` env var into Fastify's `trustProxy` option.
 *
 * - `"true"` → trust any proxy hop (Fastify reads the full X-Forwarded-For chain).
 * - `"false"` → trust nothing (an operator writing `false` means "off", not a CIDR literal).
 * - a comma-separated list → trust only those IPs/CIDRs; empty entries are dropped so a stray trailing
 *   comma (e.g. `"10.0.0.0/8,"`) can't crash proxy-addr at boot.
 * - unset / empty / only-whitespace → trust nothing; `req.ip` is the direct socket peer.
 *
 * The resolved value determines the rate-limit key (`req.ip`) behind a reverse proxy: without it, every
 * client behind the proxy shares one bucket keyed on the proxy's IP.
 */
export function parseTrustProxy(value: string | undefined): boolean | string[] {
  if (value === 'true') return true;
  if (!value || value === 'false') return false;
  const list = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : false;
}
