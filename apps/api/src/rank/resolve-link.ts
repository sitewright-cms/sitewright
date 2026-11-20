import { normalizeRankDomain } from '@sitewright/schema';
import { isOwnHost, type RankTarget } from './match.js';
import { opaqueRedirect } from './providers/google-links.js';
import type { RankProviderIo } from './providers/types.js';

/** How long Google may take to say where its redirect leads (measured 0.7–0.9 s). */
const RESOLVE_TIMEOUT_MS = 5_000;

/**
 * The page behind a result's Google redirect (`/goto`, see `providers/google-links.ts`), for the site's own result: one
 * GET to Google, without credentials, whose redirect is read and never followed. The page only when Google answers with
 * a redirect to the site the check is for; null otherwise, and the result keeps the site it was read by.
 */
export async function resolveRedirect(via: string, target: RankTarget, io: RankProviderIo): Promise<string | null> {
  if (!opaqueRedirect(via)) return null;
  let location: string | undefined;
  try {
    const res = await io.fetch(via, { method: 'GET', headers: {}, signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS) });
    location = res.status >= 300 && res.status < 400 ? res.location : undefined;
  } catch {
    return null;
  }
  if (!location) return null;
  let u: URL;
  try {
    u = new URL(location);
  } catch {
    return null; // relative: one of Google's own pages
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
  const host = normalizeRankDomain(u.hostname);
  return host && isOwnHost(host, target) ? u.href.slice(0, 2048) : null;
}
