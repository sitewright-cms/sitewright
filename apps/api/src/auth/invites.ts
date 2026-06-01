import { createHash, randomBytes } from 'node:crypto';

/** Prefix identifying a Sitewright invite token (`swi_` = SiteWright Invite). */
const TOKEN_PREFIX = 'swi_';

export interface GeneratedInviteToken {
  /** The raw token — embedded in the invite link and returned to the inviter ONCE. */
  token: string;
  /** SHA-256 hex of the token; the only form persisted or compared. */
  tokenHash: string;
}

/** Mints an invite token (256 bits) and the hash to store for it. */
export function generateInviteToken(): GeneratedInviteToken {
  const token = TOKEN_PREFIX + randomBytes(32).toString('hex');
  return { token, tokenHash: hashInviteToken(token) };
}

/** SHA-256 of a raw invite token — the only form ever persisted or compared. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
