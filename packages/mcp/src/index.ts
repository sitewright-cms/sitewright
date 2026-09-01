export {
  SitewrightClient,
  SitewrightApiError,
  type Scope,
  type Capability,
  type FetchLike,
} from './client.js';
export { createSitewrightMcpServer } from './server.js';
/** @deprecated RETIRED — the stdio bridge is retired in favour of the remote HTTP MCP endpoint (`POST /mcp`). See `run.ts`. */
export { runStdioBridge } from './run.js';
export { staticAuth, type BridgeAuth, type PendingLogin, type ScopeHolder } from './auth.js';
