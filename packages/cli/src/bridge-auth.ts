import type { BridgeAuth } from '@sitewright/mcp';
import { ensureAccessToken, forceRefreshAccessToken } from './session.js';
import { beginDeviceLogin } from './device.js';

/** Scopes requested by an agent-triggered login (the consent screen lets the user pick the project). */
const DEFAULT_SCOPE = 'content:read content:write publish';

/**
 * @deprecated RETIRED — the stdio bridge is retired in favour of the remote HTTP MCP endpoint (`POST /mcp`). This controller exists only to serve `sitewright mcp`; the HTTP
 * endpoint authenticates with a bearer token supplied by the client, so it never uses it.
 *
 * The interactive `BridgeAuth` used by `sitewright mcp`: tokens come from the stored OAuth
 * credentials (refreshed as needed), and a login is a DEVICE-FLOW grant — the agent's environment
 * is not the user's authenticated browser, so we never auto-open one; the `login` tool hands the
 * verification URL + code to the agent to relay. Switching project is just a fresh device grant
 * (the consent screen lets the user pick a different project), so `switchProject` needs no special
 * handling here.
 */
export function createBridgeAuth(issuer: string): BridgeAuth {
  return {
    interactive: true,
    token: async () => {
      try {
        return await ensureAccessToken(issuer);
      } catch {
        return null; // not logged in (or refresh expired) → the agent must run the login tool
      }
    },
    forceRefresh: () => forceRefreshAccessToken(issuer),
    beginLogin: () => beginDeviceLogin({ issuer, scope: DEFAULT_SCOPE }),
  };
}
