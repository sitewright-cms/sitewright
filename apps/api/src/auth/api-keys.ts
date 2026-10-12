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

/**
 * Prefix of a MEMBER token (`swm_` = SiteWright Member). Distinct from the project-key prefix so the
 * two can never be mistaken for one another: each resolver looks only at its own prefix, which means a
 * member token presented where a project key is expected is simply unknown — not "a key for no project".
 */
const MEMBER_TOKEN_PREFIX = 'swm_';

/** Mints a new project API token and the material to store for it. */
export function generateApiToken(): GeneratedToken {
  return mint(TOKEN_PREFIX);
}

/** Mints a new member token and the material to store for it. */
export function generateMemberToken(): GeneratedToken {
  return mint(MEMBER_TOKEN_PREFIX);
}

function mint(prefix: string): GeneratedToken {
  const token = prefix + randomBytes(32).toString('hex');
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

/** Whether a bearer is shaped like a member token (decides which resolver it goes to). */
export function isMemberTokenFormat(token: string): boolean {
  return token.startsWith(MEMBER_TOKEN_PREFIX);
}
