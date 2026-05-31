import { createHash, randomBytes } from 'node:crypto';

/** Prefix that identifies a Sitewright project API key (`swk_` = SiteWright Key). */
const TOKEN_PREFIX = 'swk_';
/** How many leading characters are safe to show in the UI to identify a key. */
const DISPLAY_PREFIX_LENGTH = TOKEN_PREFIX.length + 8;

export interface GeneratedToken {
  /** The raw token — returned to the creator ONCE and never stored. */
  token: string;
  /** SHA-256 hex of the token; this is what gets persisted. */
  tokenHash: string;
  /** Non-secret leading slice shown in the UI to identify the key. */
  tokenPrefix: string;
}

/** Mints a new project API token and the material to store for it. */
export function generateApiToken(): GeneratedToken {
  const token = TOKEN_PREFIX + randomBytes(32).toString('hex');
  return {
    token,
    tokenHash: hashApiToken(token),
    tokenPrefix: token.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

/** SHA-256 of a raw token — the only form ever persisted or compared. */
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Cheap shape check so we only hit the DB for plausibly-ours tokens. */
export function isApiTokenFormat(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX);
}
