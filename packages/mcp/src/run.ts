import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SitewrightClient, type Scope } from './client.js';
import { createSitewrightMcpServer } from './server.js';

/**
 * Introspects the token, builds the capability-gated MCP server, and connects it
 * over stdio. Returns the resolved scope (for diagnostics). Throws if the token
 * can't be resolved (caller maps that to a fatal startup error). Shared by the
 * `@sitewright/mcp` bin and the `sitewright mcp` CLI command.
 */
export async function runStdioBridge(opts: {
  url: string;
  token: string;
  /** Optional refresh hook for short-lived OAuth tokens (returns null to give up). */
  onUnauthorized?: () => Promise<string | null>;
}): Promise<Scope> {
  const client = new SitewrightClient(opts.url, opts.token, undefined, opts.onUnauthorized);
  const scope = await client.introspect();
  const server = createSitewrightMcpServer(client, scope);
  await server.connect(new StdioServerTransport());
  return scope;
}
