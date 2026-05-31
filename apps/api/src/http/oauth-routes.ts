import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db/client.js';
import { OAuthError, OAuthRepository, type Grant } from '../repo/oauth.js';
import { isValidS256Challenge } from '../auth/pkce.js';
import { API_KEY_CAPABILITIES, type ApiKeyCapability } from '../db/schema.js';
import { listOrgsForUser, tenantContext } from '../repo/accounts.js';
import type { ProjectRepository } from '../repo/projects.js';
import { ForbiddenError, NotFoundError } from '../repo/context.js';

/** The built-in public client for the `sitewright` CLI (loopback redirect, PKCE, no secret). */
export const CLI_CLIENT_ID = 'sitewright-cli';

export interface OAuthDeps {
  db: Database;
  oauth: OAuthRepository;
  projects: ProjectRepository;
  /** Resolves the session user id, or null when unauthenticated. */
  currentUserId: (req: FastifyRequest) => Promise<string | null>;
  rl: (max: number) => { rateLimit: { max: number; timeWindow: string } };
}

type AuthorizeQuery = {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  state?: string;
};

/** Escapes a string for safe interpolation into the (same-origin) consent HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function issuerOf(req: FastifyRequest): string {
  const host = req.headers.host ?? 'localhost';
  return `${req.protocol}://${host}`;
}

/** RFC 8252 loopback redirect (any port/path on localhost) — the only redirect the CLI client may use. */
function isLoopbackRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:') return false;
  return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
}

function isValidRedirect(clientId: string, redirectUri: string): boolean {
  return clientId === CLI_CLIENT_ID && isLoopbackRedirect(redirectUri);
}

/** Granted scope = the requested capabilities ∩ the known set (canonical order). */
function parseScope(raw: string | undefined): ApiKeyCapability[] {
  const requested = (raw ?? '').split(/\s+/).filter(Boolean);
  return API_KEY_CAPABILITIES.filter((c) => requested.includes(c));
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
    body{font:15px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1.5rem;color:#0f172a}
    h1{font-size:1.25rem}.card{border:1px solid #e2e8f0;border-radius:.75rem;padding:1.25rem;margin-top:1rem}
    label{display:block;font-size:.8rem;color:#475569;margin:.75rem 0 .25rem}
    select{width:100%;padding:.5rem;border:1px solid #cbd5e1;border-radius:.5rem;font:inherit}
    .scopes{font-size:.85rem;color:#334155;background:#f8fafc;border-radius:.5rem;padding:.5rem .75rem}
    .row{display:flex;gap:.5rem;margin-top:1.25rem}
    button{font:inherit;padding:.5rem 1rem;border-radius:.5rem;border:1px solid #cbd5e1;cursor:pointer}
    button.primary{background:#0f172a;color:#fff;border-color:#0f172a;font-weight:600}
    code{background:#f1f5f9;padding:.1rem .3rem;border-radius:.25rem}
  </style></head><body>${body}</body></html>`;
}

/** Builds a redirect URL appending query params, preserving any existing query. */
function redirectWith(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * Registers the OAuth 2.1 endpoints: discovery metadata, the authorization
 * endpoint (with a server-rendered consent page + project picker), and the token
 * endpoint (authorization_code + PKCE, and refresh_token rotation). The CLI is a
 * built-in public client; tokens issued are the same scoped bearer tokens the
 * rest of the API validates.
 */
export function registerOAuthRoutes(app: FastifyInstance, deps: OAuthDeps): void {
  const { oauth, db, projects, currentUserId, rl } = deps;

  // ---- Discovery (RFC 8414 + RFC 9728) ----
  app.get('/.well-known/oauth-authorization-server', async (req, reply) => {
    const issuer = issuerOf(req);
    return reply.send({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: API_KEY_CAPABILITIES,
    });
  });

  app.get('/.well-known/oauth-protected-resource', async (req, reply) => {
    const issuer = issuerOf(req);
    return reply.send({ resource: issuer, authorization_servers: [issuer] });
  });

  // ---- Authorization endpoint ----
  // Validates the request, then either prompts the user to sign in or renders a
  // consent page (project picker). PKCE is mandatory; only the loopback CLI client
  // is accepted (DCR for hosted clients is a follow-up).
  app.get<{ Querystring: AuthorizeQuery }>(
    '/oauth/authorize',
    { config: rl(30) },
    async (req, reply) => {
      const q = req.query;
      const clientId = q.client_id ?? '';
      const redirectUri = q.redirect_uri ?? '';
      // A bad client_id / redirect_uri must NOT redirect (open-redirect guard) — render.
      if (!isValidRedirect(clientId, redirectUri)) {
        return reply.code(400).type('text/html').send(
          htmlPage('Invalid request', '<h1>Invalid authorization request</h1><p>Unknown client or redirect URI.</p>'),
        );
      }
      // From here, parameter errors can safely redirect back to the (validated) client.
      const fail = (error: string): FastifyReply =>
        reply.redirect(redirectWith(redirectUri, { error, ...(q.state ? { state: q.state } : {}) }));
      if (q.response_type !== 'code') return fail('unsupported_response_type');
      if (q.code_challenge_method !== 'S256' || !q.code_challenge || !isValidS256Challenge(q.code_challenge)) {
        return fail('invalid_request');
      }
      const scope = parseScope(q.scope);
      if (scope.length === 0) return fail('invalid_scope');

      const userId = await currentUserId(req);
      if (!userId) {
        return reply.code(401).type('text/html').send(
          htmlPage(
            'Sign in required',
            `<h1>Sign in to approve access</h1><p>Open the <a href="/">Sitewright editor</a>, sign in, then return to this page to continue.</p>`,
          ),
        );
      }

      // Build the project picker from the user's memberships.
      const orgs = await listOrgsForUser(db, userId);
      const options: Array<{ value: string; label: string }> = [];
      for (const org of orgs) {
        const ctx = await tenantContext(db, userId, org.id);
        for (const project of await projects.list(ctx)) {
          options.push({ value: `${org.id}:${project.id}`, label: `${project.name} — ${org.name}` });
        }
      }
      if (options.length === 0) {
        return reply.code(200).type('text/html').send(
          htmlPage('No projects', '<h1>No projects</h1><p>Create a project in the editor first, then retry.</p>'),
        );
      }

      const hidden = (name: string, value: string): string =>
        `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
      const optionsHtml = options
        .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
        .join('');
      const scopeHtml = scope.map((s) => `<code>${escapeHtml(s)}</code>`).join(' ');

      return reply.code(200).type('text/html').send(
        htmlPage(
          'Authorize access',
          `<h1>Authorize <strong>${escapeHtml(clientId)}</strong></h1>
           <p>It will be able to act on the selected project with these permissions:</p>
           <div class="card">
             <form method="post" action="/oauth/authorize">
               ${hidden('client_id', clientId)}${hidden('redirect_uri', redirectUri)}
               ${hidden('response_type', 'code')}${hidden('code_challenge', q.code_challenge)}
               ${hidden('code_challenge_method', 'S256')}${hidden('scope', scope.join(' '))}
               ${q.state ? hidden('state', q.state) : ''}
               <label for="project">Project</label>
               <select id="project" name="project" required>${optionsHtml}</select>
               <div class="scopes" style="margin-top:.75rem">Permissions: ${scopeHtml}</div>
               <div class="row">
                 <button class="primary" type="submit" name="decision" value="approve">Approve</button>
                 <button type="submit" name="decision" value="deny">Deny</button>
               </div>
             </form>
           </div>`,
        ),
      );
    },
  );

  // Consent submission. Same-origin form; the session cookie is sameSite=strict,
  // so a cross-site forgery can't carry it (CSRF protection). All OAuth params are
  // re-validated server-side.
  app.post<{ Body: Record<string, string> }>(
    '/oauth/authorize',
    { config: rl(30) },
    async (req, reply) => {
      const b = req.body ?? {};
      const clientId = b.client_id ?? '';
      const redirectUri = b.redirect_uri ?? '';
      if (!isValidRedirect(clientId, redirectUri)) {
        return reply.code(400).type('text/html').send(htmlPage('Invalid request', '<h1>Invalid request</h1>'));
      }
      const state = b.state;
      const back = (params: Record<string, string>): FastifyReply =>
        reply.redirect(redirectWith(redirectUri, { ...params, ...(state ? { state } : {}) }));

      if (b.decision !== 'approve') return back({ error: 'access_denied' });

      const userId = await currentUserId(req);
      if (!userId) return reply.code(401).type('text/html').send(htmlPage('Sign in required', '<h1>Sign in required</h1>'));
      if (!b.code_challenge || !isValidS256Challenge(b.code_challenge)) return back({ error: 'invalid_request' });
      const scope = parseScope(b.scope);
      if (scope.length === 0) return back({ error: 'invalid_scope' });

      const projectField = b.project ?? '';
      const sep = projectField.indexOf(':');
      const orgId = sep > 0 ? projectField.slice(0, sep) : '';
      const projectId = sep > 0 ? projectField.slice(sep + 1) : '';
      if (!orgId || !projectId) return back({ error: 'invalid_request' });

      // Verify the user is a member of the chosen project's org, resolve their role
      // (frozen into the grant), and issue the code — all under one error guard.
      try {
        const ctx = await tenantContext(db, userId, orgId);
        await projects.get(ctx, projectId); // 404 if the project isn't in this org
        const grant: Grant = { clientId, userId, orgId, projectId, role: ctx.role, scope };
        const code = await oauth.createAuthCode(grant, redirectUri, b.code_challenge);
        return back({ code });
      } catch (err) {
        if (err instanceof ForbiddenError || err instanceof NotFoundError) return back({ error: 'access_denied' });
        if (err instanceof OAuthError) return back({ error: err.code });
        throw err;
      }
    },
  );

  // ---- Token endpoint ----
  app.post<{ Body: Record<string, string> }>(
    '/oauth/token',
    { config: rl(60) },
    async (req, reply) => {
      const b = req.body ?? {};
      const fail = (status: number, error: string, description: string): FastifyReply =>
        reply.code(status).send({ error, error_description: description });
      try {
        if (b.grant_type === 'authorization_code') {
          if (!b.code || !b.client_id || !b.redirect_uri || !b.code_verifier) {
            return fail(400, 'invalid_request', 'missing required parameter');
          }
          const tokens = await oauth.redeemAuthCode({
            code: b.code,
            clientId: b.client_id,
            redirectUri: b.redirect_uri,
            codeVerifier: b.code_verifier,
          });
          return reply.send({
            access_token: tokens.accessToken,
            token_type: 'Bearer',
            expires_in: tokens.expiresInSeconds,
            refresh_token: tokens.refreshToken,
            scope: tokens.scope.join(' '),
          });
        }
        if (b.grant_type === 'refresh_token') {
          if (!b.refresh_token || !b.client_id) return fail(400, 'invalid_request', 'missing required parameter');
          const tokens = await oauth.refresh({ refreshToken: b.refresh_token, clientId: b.client_id });
          return reply.send({
            access_token: tokens.accessToken,
            token_type: 'Bearer',
            expires_in: tokens.expiresInSeconds,
            refresh_token: tokens.refreshToken,
            scope: tokens.scope.join(' '),
          });
        }
        return fail(400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
      } catch (err) {
        if (err instanceof OAuthError) return fail(400, err.code, err.message);
        throw err;
      }
    },
  );
}
