import { createHmac, timingSafeEqual } from 'node:crypto';

// The DRAFT preview is served from the app origin (sandboxed, opaque) and browsed with relative links,
// which drop a SameSite=Strict session cookie on in-frame navigation — so access rides in the URL PATH
// segment, not a cookie. There are TWO kinds of path credential:
//   1. The DEFAULT signature — TIME-BUCKETED so it EXPIRES. Only a logged-in member can mint a fresh one
//      (via the member-only /preview-url route), and a leaked/old URL stops working within ~1 window. This
//      is what makes the default preview "logged-in only" in practice (a random visitor can't view it).
//   2. A SHARE token — a STABLE, per-project, REVOCABLE credential the owner explicitly creates to hand a
//      draft to an UNAUTHENTICATED client. HMAC-signed (self-verifying, no secret stored) and gated by a
//      revocation list (the project's `preview_share` entries) so deleting the entry kills the link.

/** Rotation window for the default signature. A minted sig is valid for the bucket it was minted in AND
 *  the next one (the verifier accepts `now` and `now - WINDOW`), so it lives between 1 and 2 windows. */
const PREVIEW_WINDOW_MS = 12 * 60 * 60 * 1000; // 12h → a minted default sig lives 12–24h.
const bucketOf = (epochMs: number): number => Math.floor(epochMs / PREVIEW_WINDOW_MS);

/**
 * The DEFAULT, time-bucketed preview signature for a project — `HMAC(secret, projectId:bucket)`, url-safe
 * and truncated. Minted by the member-only preview-url route; expires so it is not a permanent bearer.
 * `secret` is the app's `cookieSecret` (mandatory in production). `nowMs` defaults to the current time.
 */
export function signPreview(projectId: string, secret: string, nowMs: number = Date.now()): string {
  return createHmac('sha256', secret).update(`sw-preview:${projectId}:${bucketOf(nowMs)}`).digest('base64url').slice(0, 27);
}

const eq = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/** Constant-time check that `sig` is a still-valid DEFAULT preview signature — accepts the current bucket
 *  and the previous one (grace across the window boundary / a URL minted up to a window ago). */
export function verifyPreview(projectId: string, sig: string, secret: string, nowMs: number = Date.now()): boolean {
  const b = bucketOf(nowMs);
  return eq(sig, signPreview(projectId, secret, nowMs)) || eq(sig, signPreview(projectId, secret, (b - 1) * PREVIEW_WINDOW_MS));
}

// ── Revocable SHARE tokens ───────────────────────────────────────────────────────────────────────────
// A share token is `<shareId>~<hmac>`: the shareId is a stored, revocable handle; the hmac binds it to the
// project + secret so the token is self-verifying (no secret stored, DB leak exposes no usable token).

/** Mint the share TOKEN string for a given (already stored) shareId. */
export function signShare(projectId: string, shareId: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(`sw-share:${projectId}:${shareId}`).digest('base64url').slice(0, 27);
  return `${shareId}~${mac}`;
}

/** Constant-time check that `token` is a valid, NON-revoked share token for `projectId`. `activeShareIds`
 *  is the set of share entries that still exist (deleting the entry revokes the link). */
export function verifyShare(projectId: string, token: string, secret: string, activeShareIds: ReadonlySet<string>): boolean {
  const sep = token.indexOf('~');
  if (sep <= 0) return false;
  const shareId = token.slice(0, sep);
  if (!activeShareIds.has(shareId)) return false; // revoked / unknown → reject before the HMAC compare
  return eq(token, signShare(projectId, shareId, secret));
}
