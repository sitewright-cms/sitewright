import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A stable, stateless PREVIEW SIGNATURE for a project — `HMAC(secret, projectId)`, url-safe and
 * truncated. It rides in the preview URL as a PATH segment (`/preview/<projectId>/<sig>/…`) so the
 * sandboxed, opaque-origin draft preview needs no session cookie: a SameSite=Strict cookie is dropped
 * on in-frame navigation, but a path segment is carried automatically by every relative link.
 *
 * The signature is the bearer secret for the (unpublished) draft, so the URL is share-able like a
 * deploy-preview link. It is stable (survives restarts — no store) and revocable only by rotating the
 * instance secret. `secret` is the app's `cookieSecret` (mandatory in production).
 */
export function signPreview(projectId: string, secret: string): string {
  return createHmac('sha256', secret).update(`sw-preview:${projectId}`).digest('base64url').slice(0, 27);
}

/** Constant-time check that `sig` is the valid preview signature for `projectId`. */
export function verifyPreview(projectId: string, sig: string, secret: string): boolean {
  const a = Buffer.from(sig);
  const b = Buffer.from(signPreview(projectId, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}
