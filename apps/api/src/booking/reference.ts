import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A BOOKING REFERENCE: the visitor's handle on their own booking, in the links of their confirmation
 * mail and on the site's booking page. `<claimId>-<mac>`, where the MAC binds the claim to its project
 * under the platform's secret: it cannot be guessed, nor moved to another project. Holding it is what
 * lets someone see the booking's state and cancel it, as the payment token does for an order.
 *
 * The claim id is base62 (`newId`), the MAC base64url, whose alphabet includes `-`: so the FIRST dash
 * is the split (the same rule as preview share tokens).
 *
 * Rotating the secret invalidates every reference in mails already sent. That is the price of not
 * storing them; a visitor can still reach the business directly.
 */

const MAC_CHARS = 27;

/** A key for references alone, derived from the instance secret, so its other uses can never sign one. */
function referenceKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('sitewright booking reference key').digest();
}

function mac(projectId: string, claimId: string, secret: string): string {
  return createHmac('sha256', referenceKey(secret)).update(`sw-booking:${projectId}:${claimId}`).digest('base64url').slice(0, MAC_CHARS);
}

export function signBookingRef(projectId: string, claimId: string, secret: string): string {
  return `${claimId}-${mac(projectId, claimId, secret)}`;
}

/** The claim id a valid reference for `projectId` names, or null for anything else. Constant-time. */
export function verifyBookingRef(projectId: string, reference: unknown, secret: string): string | null {
  if (typeof reference !== 'string' || reference.length > 128) return null;
  const sep = reference.indexOf('-');
  if (sep <= 0) return null;
  const claimId = reference.slice(0, sep);
  if (!/^[0-9A-Za-z]+$/.test(claimId)) return null;
  const expected = Buffer.from(signBookingRef(projectId, claimId, secret));
  const given = Buffer.from(reference);
  return expected.length === given.length && timingSafeEqual(expected, given) ? claimId : null;
}
