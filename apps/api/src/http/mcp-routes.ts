import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createSitewrightMcpServer, staticAuth, SitewrightClient, SitewrightApiError, type FetchLike } from '@sitewright/mcp';
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
  opts: { rl: (max: number) => { rateLimit: { max: number; timeWindow: string } } },
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

  const handle = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    // issuerOf derives from the Host header — same self-hosted single-origin assumption the OAuth
    // routes already make (behind a proxy, pin Host + trustProxy). Only used to point the host at
    // our (same-origin) metadata; the real auth boundary is the in-process token validation below.
    const challenge = (): FastifyReply =>
      reply
        .code(401)
        .header('WWW-Authenticate', `Bearer resource_metadata="${issuerOf(req)}/.well-known/oauth-protected-resource"`)
        .send({ error: 'unauthorized', error_description: 'Authenticate via OAuth to use the Sitewright MCP endpoint.' });

    const token = bearerOf(req);
    if (!token) return challenge();

    // Resolve the token's project scope (validates it); a bad/expired token → the OAuth challenge,
    // any other API error (e.g. a 429 from the introspect rate-limit) → its real status, not a 500.
    const client = injectClient(token);
    let scope;
    try {
      scope = await client.introspect();
    } catch (err) {
      if (err instanceof SitewrightApiError) {
        if (err.status === 401) return challenge();
        return reply.code(err.status).send({ error: 'mcp_unavailable', error_description: err.message });
      }
      throw err;
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
      const webReq = new Request(`${issuerOf(req)}${req.url}`, { method: req.method, headers });
      const webRes = await transport.handleRequest(webReq, { parsedBody: req.body });
      reply.code(webRes.status);
      webRes.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(await webRes.text());
    } finally {
      // McpServer.close() closes the transport it owns — one close, correct order.
      await server.close();
    }
  };

  app.post('/mcp', { config: opts.rl(120) }, handle);
  // Stateless JSON mode uses neither the standalone SSE stream (GET) nor session termination
  // (DELETE) — 405 so a spec-compliant host doesn't open and wait on a stream that never arrives
  // (and we never buffer a streaming body via .text()).
  const methodNotAllowed = async (_req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
    reply.code(405).header('allow', 'POST').send({ error: 'method_not_allowed', error_description: 'The Sitewright MCP endpoint accepts POST.' });
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
}
