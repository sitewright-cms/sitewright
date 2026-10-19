import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Route signatures for the built-in statistics.
 *
 * The collector is a public endpoint and the site key in its URL is public too, so anybody can post to it. What
 * they must not be able to do is INVENT pages: a page table that grows by one row per made-up path is the one
 * way a stranger could make the statistics expensive to keep. So the publisher signs each page's route with a
 * per-project key, the tracker sends the signature back, and the collector counts a route only when it
 * verifies. A spammer can still replay a real page's pair — which inflates a real page, bounded by the rate
 * limit — but cannot add a row.
 *
 * The per-project key is derived from an instance secret (kept in the statistics database), so the build —
 * which runs author templates in a worker — only ever holds ONE project's key, never the secret itself.
 */

const TOKEN_CHARS = 16; // 96 bits of base64url

/** The key a project's builds sign routes with. */
export function statsProjectKey(secret: string, projectId: string): string {
  return createHmac('sha256', secret).update(`sw-stats-route:${projectId}`).digest('hex');
}

/** The signature for one route. */
export function statsRouteToken(projectKey: string, route: string): string {
  return createHmac('sha256', projectKey).update(route).digest('base64url').slice(0, TOKEN_CHARS);
}

/** Whether `token` is the signature for `route` (constant time). */
export function verifyStatsRouteToken(projectKey: string, route: string, token: string): boolean {
  if (token.length !== TOKEN_CHARS) return false;
  const want = Buffer.from(statsRouteToken(projectKey, route));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * A request path in the served site, normalized to the route the publisher signs: leading and trailing slash,
 * no `index.html`. `about`, `about/`, `/about/index.html` → `/about/`; `''` → `/`. Null for a traversal or
 * another `.html` file (the publisher writes every page as `<route>/index.html`).
 */
export function statsRouteOf(path: string): string | null {
  let p = path.split('?')[0] ?? '';
  p = p.replace(/(^|\/)index\.html$/, '$1');
  const segments = p.split('/').filter(Boolean);
  if (segments.some((s) => s === '.' || s === '..' || s.endsWith('.html'))) return null;
  return segments.length ? `/${segments.join('/')}/` : '/';
}
