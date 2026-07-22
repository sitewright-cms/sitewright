import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createSitewrightMcpServer, staticAuth, SitewrightClient, SitewrightApiError, type FetchLike } from '@sitewright/mcp';
import { hashApiToken } from '../auth/api-keys.js';
import { issuerOf } from './oauth-routes.js';

function bearerOf(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match ? match[1] : undefined;
}

/**
 * The REMOTE MCP transport (Streamable HTTP, stateless) at `/mcp`. Lets hosted MCP clients
 * (ChatGPT, claude.ai) drive ONE Sitewright project over HTTP, authenticated by an OAuth bearer
 * token — the complement to the local stdio bridge (`sitewright mcp`).
 *
 * We act as an OAuth 2.1 Resource Server (RFC 9728): a missing/invalid token gets a 401 with a
 * `WWW-Authenticate` challenge pointing at our protected-resource metadata, so the host can discover
 * the authorization server and run the flow (the discovery/DCR/authorize/token/device endpoints
 * already exist in oauth-routes). The token is the SAME project-scoped bearer the REST API validates.
 *
 * The MCP server reuses the existing REST routes IN-PROCESS via `app.inject` — every tool call
 * re-enters the app carrying the bearer token, so capability gating, project/tenant scoping, schema
 * validation, and the live change-stream (incl. the "agent editing" actor tag) are the exact same
 * code path as the public API, with zero duplication and no extra socket hop. We use the SDK's
 * WEB-STANDARD transport (Request→Response) — no Node-socket lifecycle — and let Fastify send the
 * response normally (so the security-headers hook still runs).
 */
export function registerMcpRoutes(
  app: FastifyInstance,
  opts: {
    rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
    /** The instance's public origin (`SW_PUBLIC_URL`); used to build the OAuth challenge's
     *  resource-metadata URL correctly behind a TLS-terminating proxy. See `issuerOf`. */
    publicUrl?: string;
  },
): void {
  // A SitewrightClient whose every request is an in-process app.inject carrying the bearer token.
  const injectClient = (token: string): SitewrightClient => {
    const fetchImpl: FetchLike = async (input, init) => {
      // SitewrightClient only ever issues GET/POST/PUT/DELETE.
      const res = (await app.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'DELETE',
        url: input,
        headers: init?.headers,
        payload: init?.body,
      })) as unknown as { statusCode: number; statusMessage?: string; payload: string };
      return {
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        statusText: res.statusMessage ?? '',
        text: async () => res.payload,
      };
    };
    return new SitewrightClient('', async () => token, fetchImpl);
  };

  // The JSON-RPC id of the posted request (best-effort — null when the body never parsed, e.g. a 429
  // thrown at onRequest). Error replies carry a real JSON-RPC envelope so a stateless MCP host gets a
  // well-formed `error{code,message}` it can surface/retry on, instead of a bare HTTP JSON body it
  // reports as an undefined RPC error.
  const rpcIdOf = (body: unknown): string | number | null => {
    const id = (body as { id?: unknown } | null | undefined)?.id;
    return typeof id === 'string' || typeof id === 'number' ? id : null;
  };
  const rpcError = (reply: FastifyReply, status: number, message: string, id: string | number | null): FastifyReply =>
    reply.code(status).send({ jsonrpc: '2.0', id, error: { code: -32000, message } });

  // Introspect cache: EVERY /mcp POST resolves the token's scope via GET /api-key/self, which sits in the
  // same per-token rate bucket at 30/min — an agent pacing tool calls well under the /mcp cap still tripped
  // it, surfacing as `mcp_unavailable` mid-run. Successful scopes are immutable for a key's lifetime in
  // practice (project binding + role + capabilities), so a short cache removes the hidden ceiling; every
  // TOOL call still re-validates the bearer in-process, so a revoked key fails closed within the TTL anyway.
  const SCOPE_TTL_MS = 15_000;
  const scopeCache = new Map<string, { scope: Awaited<ReturnType<SitewrightClient['introspect']>>; exp: number }>();

  const handle = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    // issuerOf prefers SW_PUBLIC_URL, else derives from the request — same single-origin assumption
    // the OAuth routes make (behind a TLS proxy set SW_PUBLIC_URL or TRUST_PROXY so this isn't
    // `http://…`). Only used to point the host at our (same-origin) protected-resource metadata; the
    // real auth boundary is the in-process token validation below.
    const challenge = (): FastifyReply =>
      reply
        .code(401)
        .header('WWW-Authenticate', `Bearer resource_metadata="${issuerOf(req, opts.publicUrl)}/.well-known/oauth-protected-resource"`)
        .send({ error: 'unauthorized', error_description: 'Authenticate via OAuth to use the Sitewright MCP endpoint.' });

    const token = bearerOf(req);
    if (!token) return challenge();

    // Resolve the token's project scope (validates it); a bad/expired token → the OAuth challenge,
    // any other API error (e.g. a 429 from the introspect rate-limit) → its real status as a JSON-RPC
    // error envelope, not a 500. Fresh scopes are cached briefly (see SCOPE_TTL_MS above).
    const client = injectClient(token);
    // Cache key = the token's sha256 (the codebase-wide rule: raw tokens are never persisted or held
    // beyond the request), so a heap inspection of the cache yields no usable bearer material.
    const cacheKey = hashApiToken(token);
    const cached = scopeCache.get(cacheKey);
    let scope;
    if (cached && cached.exp > Date.now()) {
      scope = cached.scope;
      // The client instance is per-request — seed it so tool calls (which read the client's own
      // introspected scope for project paths) work without re-spending an introspect request.
      client.primeScope(scope);
    } else {
      try {
        scope = await client.introspect();
      } catch (err) {
        if (err instanceof SitewrightApiError) {
          if (err.status === 401) return challenge();
          return rpcError(reply, err.status, `mcp_unavailable: ${err.message}`, rpcIdOf(req.body));
        }
        throw err;
      }
      if (scopeCache.size > 500) scopeCache.clear(); // bound memory on token churn; refill is one introspect
      scopeCache.set(cacheKey, { scope, exp: Date.now() + SCOPE_TTL_MS });
    }

    // Stateless transport (no session store): the bearer token carries all state, so each request is
    // independent. `enableJsonResponse` returns a single JSON reply (no SSE). staticAuth: the host
    // does OAuth out-of-band, so the in-band login/switch tools stay inert here.
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createSitewrightMcpServer(client, { scope }, staticAuth(token));
    try {
      await server.connect(transport);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(', '));
      }
      const webReq = new Request(`${issuerOf(req, opts.publicUrl)}${req.url}`, { method: req.method, headers });
      const webRes = await transport.handleRequest(webReq, { parsedBody: req.body });
      reply.code(webRes.status);
      webRes.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(await webRes.text());
    } finally {
      // McpServer.close() closes the transport it owns — one close, correct order.
      await server.close();
    }
  };

  // Route-level error handler: a 429 thrown by the rate-limit hook (or an unexpected 500) would otherwise
  // go out as the app-wide bare `{ error: … }` JSON — not a JSON-RPC envelope — which stateless MCP hosts
  // surface as an undefined RPC error. The rate-limit plugin's retry-after/x-ratelimit-* headers are
  // already on the reply and survive this handler; the message tells the agent to honor them.
  const mcpErrorHandler = (error: { statusCode?: number }, req: FastifyRequest, reply: FastifyReply): void => {
    const status = error.statusCode ?? 500;
    const message = status === 429 ? 'rate limit exceeded — honor the retry-after header and back off' : 'internal error';
    void rpcError(reply, status, message, rpcIdOf(req.body));
  };
  app.post('/mcp', { config: opts.rl(120), errorHandler: mcpErrorHandler }, handle);
  // Stateless JSON mode uses neither the standalone SSE stream (GET) nor session termination
  // (DELETE) — 405 so a spec-compliant host doesn't open and wait on a stream that never arrives
  // (and we never buffer a streaming body via .text()).
  const methodNotAllowed = async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
    reply.code(405).header('allow', 'POST').send({ error: 'method_not_allowed', error_description: 'The Sitewright MCP endpoint accepts POST.' });
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
}
