import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SitewrightClient, type Scope } from './client.js';
import { createSitewrightMcpServer } from './server.js';
import { staticAuth, type BridgeAuth, type ScopeHolder } from './auth.js';

/**
 * @deprecated RETIRED — the stdio bridge is retired in favour of the remote HTTP MCP endpoint (`POST /mcp`). Kept, not deleted, so existing local installs keep working; it is
 * no longer developed and gets no new tool surface. New setups should point their agent at the
 * instance's `/mcp` URL with an `Authorization: Bearer <project API key>` header instead.
 *
 * Builds the capability-gated MCP server over a Sitewright instance and connects it over stdio.
 * Two modes:
 *  - `{ token }` — a fixed bearer token (the `@sitewright/mcp` bin / a PAT). Introspects up-front and
 *    THROWS on a bad token (fail fast — there is no login fallback). Returns the resolved scope.
 *  - `{ auth }` — an interactive controller (the `sitewright mcp` CLI). May start UNAUTHENTICATED: the
 *    agent triggers a device-flow login on demand via the `login` tool. Returns the scope or null.
 */
export async function runStdioBridge(opts: {
  url: string;
  token?: string;
  auth?: BridgeAuth;
}): Promise<Scope | null> {
  if (!opts.auth && opts.token === undefined) {
    throw new Error('runStdioBridge requires either a token or an auth controller');
  }
  const auth: BridgeAuth = opts.auth ?? staticAuth(opts.token as string);
  const client = new SitewrightClient(
    opts.url,
    () => auth.token(),
    undefined,
    () => auth.forceRefresh(),
  );

  const holder: ScopeHolder = { scope: null };
  // Resolve the scope up-front when we already have a token. In static mode a bad token must fail
  // fast (no login fallback); in interactive mode we tolerate an absent/expired token and let the
  // user log in on demand.
  if (await auth.token()) {
    if (auth.interactive) {
      try {
        holder.scope = await client.introspect();
      } catch {
        holder.scope = null;
      }
    } else {
      holder.scope = await client.introspect();
    }
  }

  const server = createSitewrightMcpServer(client, holder, auth);
  await server.connect(new StdioServerTransport());
  return holder.scope;
}
