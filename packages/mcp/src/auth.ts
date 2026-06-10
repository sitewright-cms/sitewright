import type { Scope } from './client.js';

/**
 * What an in-flight device-authorization login exposes to the bridge: the human-facing
 * verification URL + code to show the user now, plus a `completion` promise that resolves once
 * the user has approved (and the new tokens are persisted), or rejects on denial/expiry.
 */
export interface PendingLogin {
  verificationUrl: string;
  userCode: string;
  /** Seconds until the device code expires. */
  expiresIn: number;
  completion: Promise<void>;
}

/**
 * The bridge's auth strategy. Two implementations exist:
 *  - `staticAuth` — a fixed bearer token (the `@sitewright/mcp` bin / a PAT); not interactive.
 *  - the CLI's OAuth controller — lazy device-flow login, refresh, and project switching.
 * The MCP server is written against this interface so it can boot UNAUTHENTICATED and let the
 * agent trigger login on demand.
 */
export interface BridgeAuth {
  /** Whether interactive (device-flow) login + project switching are available. */
  readonly interactive: boolean;
  /** A valid access token (refreshing as needed), or null when not yet authenticated. */
  token(): Promise<string | null>;
  /** Force a refresh after a 401; returns the new token, or null if not possible. */
  forceRefresh(): Promise<string | null>;
  /**
   * Begin a device-flow login. Throws if `!interactive`. (Switching projects is the same grant —
   * the consent screen lets the user pick a different project — so there's no per-call option; the
   * `login` vs `switch_project` distinction is only the user-facing wording.)
   */
  beginLogin(): Promise<PendingLogin>;
}

/** Mutable scope holder: resolved at startup (if a token exists) and updated after a lazy login. */
export interface ScopeHolder {
  scope: Scope | null;
}

/** A non-interactive bridge backed by one fixed bearer token (no login/refresh/switch). */
export function staticAuth(token: string): BridgeAuth {
  return {
    interactive: false,
    token: async () => token,
    forceRefresh: async () => null,
    beginLogin: (): Promise<PendingLogin> => {
      throw new Error('this connection uses a fixed token; re-authentication is not available');
    },
  };
}
