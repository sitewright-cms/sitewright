import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const REDIRECT = 'http://127.0.0.1:8976/callback';
const CLIENT = 'sitewright-cli';

let app: FastifyInstance;
let db: Database;
let publishRoot: string;

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-oauth-'));
  db = await makeTestDb();
  app = await createApp({ db, publishRoot, encryptionKey: randomBytes(32) });
  await app.ready();
});
afterEach(async () => {
  await rm(publishRoot, { recursive: true, force: true });
});

function cookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session');
  return t;
}

async function setup() {
  const uid = randomUUID().slice(0, 8);
  const email = `a-${uid}@e2e.test`;
  // Project creation is agency-staff-only now; seed the creator as `developer`. The /auth/register
  // route is invite-only, so seed via the repo, then log in for a session cookie.
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
  const session = cookie(login);
  const proj = await app.inject({
    method: 'POST',
    url: `/projects`,
    cookies: { sw_session: session },
    // Slugs are instance-unique; keep each setup() call's slug distinct.
    payload: { name: 'Site<X>', slug: `site-${uid}` },
  });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { session, projectId };
}

const authorizeQuery = (extra: Record<string, string> = {}) =>
  new URLSearchParams({
    client_id: CLIENT,
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    scope: 'content:read content:write',
    state: 'xyz-state',
    ...extra,
  }).toString();

function form(data: Record<string, string>) {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(data).toString(),
  };
}

describe('OAuth discovery + authorize', () => {
  it('publishes authorization-server + protected-resource metadata', async () => {
    const md = (await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' })).json();
    expect(md.code_challenge_methods_supported).toEqual(['S256']);
    expect(md.grant_types_supported).toContain('authorization_code');
    expect(md.token_endpoint).toMatch(/\/oauth\/token$/);
    const pr = (await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' })).json();
    expect(pr.authorization_servers).toHaveLength(1);
  });

  it('rejects an unknown client / non-loopback redirect without redirecting', async () => {
    const bad = await app.inject({ method: 'GET', url: `/oauth/authorize?${authorizeQuery({ redirect_uri: 'https://evil.example.com/cb' })}` });
    expect(bad.statusCode).toBe(400);
    expect(bad.headers['content-type']).toMatch(/text\/html/);
    expect(bad.headers.location).toBeUndefined(); // no open redirect
  });

  it('prompts for sign-in when unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: `/oauth/authorize?${authorizeQuery()}` });
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatch(/sign in/i);
  });

  it('renders an HTML-escaped consent page for an authenticated user', async () => {
    const { session } = await setup();
    const res = await app.inject({
      method: 'GET',
      url: `/oauth/authorize?${authorizeQuery()}`,
      cookies: { sw_session: session },
    });
    expect(res.statusCode).toBe(200);
    // The project name "Site<X>" must be escaped (no raw <X> tag injected).
    expect(res.body).toContain('Site&lt;X&gt;');
    expect(res.body).not.toContain('Site<X>');
    expect(res.body).toContain('content:read');
  });

  it('redirects with error=access_denied (carrying state) when consent is denied', async () => {
    const { session, projectId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/authorize',
      cookies: { sw_session: session },
      ...form({
        client_id: CLIENT,
        redirect_uri: REDIRECT,
        code_challenge: CHALLENGE,
        scope: 'content:read',
        state: 'xyz-state',
        // The consent picker value is just the projectId.
        project: projectId,
        decision: 'deny',
      }),
    });
    expect(res.statusCode).toBe(302);
    const loc = new URL(res.headers.location as string);
    expect(loc.searchParams.get('error')).toBe('access_denied');
    expect(loc.searchParams.get('state')).toBe('xyz-state');
  });
});

describe('OAuth Dynamic Client Registration (RFC 7591)', () => {
  it('advertises the registration endpoint in metadata', async () => {
    const md = (await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' })).json();
    expect(md.registration_endpoint).toMatch(/\/oauth\/register$/);
  });

  it('registers a public client and rejects bad client metadata', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: { client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] },
    });
    expect(ok.statusCode).toBe(201);
    const body = ok.json() as { client_id: string; token_endpoint_auth_method: string };
    expect(body.client_id).toMatch(/^swcid_/);
    expect(body.token_endpoint_auth_method).toBe('none');

    const bad = await app.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: { client_name: 'Evil', redirect_uris: ['http://evil.example.com/cb'] },
    });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: string }).error).toBe('invalid_client_metadata');
  });

  it('authorizes a registered client only at its exact redirect URI', async () => {
    const { session } = await setup();
    const reg = await app.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: { client_name: 'Hosted <b>App</b>', redirect_uris: ['https://app.example.test/cb'] },
    });
    const clientId = (reg.json() as { client_id: string }).client_id;
    const q = (redirect: string) =>
      new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirect,
        response_type: 'code',
        code_challenge: CHALLENGE,
        code_challenge_method: 'S256',
        scope: 'content:read',
        state: 's',
      }).toString();

    // Exact registered redirect → consent page, showing the (escaped) client name.
    const okRes = await app.inject({
      method: 'GET',
      url: `/oauth/authorize?${q('https://app.example.test/cb')}`,
      cookies: { sw_session: session },
    });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.body).toContain('Hosted &lt;b&gt;App&lt;/b&gt;'); // name escaped, not raw HTML
    expect(okRes.body).not.toContain('Hosted <b>App</b>');

    // A different (unregistered) redirect → 400, no redirect (open-redirect guard).
    const badRes = await app.inject({
      method: 'GET',
      url: `/oauth/authorize?${q('https://app.example.test/other')}`,
      cookies: { sw_session: session },
    });
    expect(badRes.statusCode).toBe(400);
    expect(badRes.headers.location).toBeUndefined();
  });
});

describe('OAuth full authorization-code + PKCE flow', () => {
  async function getCode(session: string, project: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/authorize',
      cookies: { sw_session: session },
      ...form({
        client_id: CLIENT,
        redirect_uri: REDIRECT,
        response_type: 'code',
        code_challenge: CHALLENGE,
        code_challenge_method: 'S256',
        // Consent form checks capabilities as per-field checkboxes (scope_<cap>=1), not a `scope` field.
        'scope_content:read': '1',
        'scope_content:write': '1',
        state: 'xyz-state',
        project,
        decision: 'approve',
      }),
    });
    expect(res.statusCode).toBe(302);
    const loc = new URL(res.headers.location as string);
    expect(loc.searchParams.get('state')).toBe('xyz-state');
    const code = loc.searchParams.get('code');
    if (!code) throw new Error(`no code in redirect: ${res.headers.location}`);
    return code;
  }

  it('exchanges code → access + refresh, and the access token works on the API; refresh rotates', async () => {
    const { session, projectId } = await setup();
    const code = await getCode(session, projectId);

    const tokRes = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      ...form({ grant_type: 'authorization_code', code, client_id: CLIENT, redirect_uri: REDIRECT, code_verifier: VERIFIER }),
    });
    expect(tokRes.statusCode).toBe(200);
    const tok = tokRes.json() as { access_token: string; refresh_token: string; token_type: string; scope: string };
    expect(tok.token_type).toBe('Bearer');
    expect(tok.access_token.startsWith('swk_')).toBe(true);
    expect(tok.scope).toBe('content:read content:write');

    // The access token authenticates a normal bearer API call.
    const use = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/content/page`,
      headers: { authorization: `Bearer ${tok.access_token}` },
    });
    expect(use.statusCode).toBe(200);

    // Refresh rotates to a new pair.
    const refRes = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      ...form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: CLIENT }),
    });
    expect(refRes.statusCode).toBe(200);
    expect((refRes.json() as { refresh_token: string }).refresh_token).not.toBe(tok.refresh_token);
  });

  it('rejects a reused authorization code and a bad PKCE verifier', async () => {
    const { session, projectId } = await setup();
    const code = await getCode(session, projectId);
    const exchange = (verifier: string) =>
      app.inject({
        method: 'POST',
        url: '/oauth/token',
        ...form({ grant_type: 'authorization_code', code, client_id: CLIENT, redirect_uri: REDIRECT, code_verifier: verifier }),
      });
    // Wrong verifier does not consume the code…
    expect((await exchange('x'.repeat(43))).statusCode).toBe(400);
    // …correct verifier succeeds…
    expect((await exchange(VERIFIER)).statusCode).toBe(200);
    // …and the code is now single-use.
    const reused = await exchange(VERIFIER);
    expect(reused.statusCode).toBe(400);
    expect((reused.json() as { error: string }).error).toBe('invalid_grant');
  });

  it('refresh-token reuse is rejected and revokes the live successor (theft response)', async () => {
    const { session, projectId } = await setup();
    const code = await getCode(session, projectId);
    const exchange = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      ...form({ grant_type: 'authorization_code', code, client_id: CLIENT, redirect_uri: REDIRECT, code_verifier: VERIFIER }),
    });
    const rt1 = (exchange.json() as { refresh_token: string }).refresh_token;
    const refresh = (rt: string) =>
      app.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: rt, client_id: CLIENT }) });

    const rt2 = (await refresh(rt1).then((r) => r.json() as { refresh_token: string })).refresh_token;
    // Reusing the rotated rt1 is rejected…
    const reuse = await refresh(rt1);
    expect(reuse.statusCode).toBe(400);
    expect((reuse.json() as { error: string }).error).toBe('invalid_grant');
    // …and the live successor rt2 is now revoked too.
    expect((await refresh(rt2)).statusCode).toBe(400);
  });

  it('completes the full flow for a dynamically-registered client', async () => {
    const { session, projectId } = await setup();
    const reg = await app.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: { client_name: 'Hosted', redirect_uris: ['https://hosted.example.test/cb'] },
    });
    const clientId = (reg.json() as { client_id: string }).client_id;
    const HREDIRECT = 'https://hosted.example.test/cb';

    const consent = await app.inject({
      method: 'POST',
      url: '/oauth/authorize',
      cookies: { sw_session: session },
      ...form({
        client_id: clientId,
        redirect_uri: HREDIRECT,
        response_type: 'code',
        code_challenge: CHALLENGE,
        code_challenge_method: 'S256',
        'scope_content:read': '1',
        state: 's',
        project: projectId,
        decision: 'approve',
      }),
    });
    expect(consent.statusCode).toBe(302);
    const code = new URL(consent.headers.location as string).searchParams.get('code');

    const tok = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      ...form({ grant_type: 'authorization_code', code: code!, client_id: clientId, redirect_uri: HREDIRECT, code_verifier: VERIFIER }),
    });
    expect(tok.statusCode).toBe(200);
    expect((tok.json() as { access_token: string }).access_token.startsWith('swk_')).toBe(true);
  });

  it('rejects an unsupported grant type', async () => {
    const res = await app.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'password' }) });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('unsupported_grant_type');
  });

  it('runs the device authorization grant: device_authorization → approve → token', async () => {
    const { session, projectId } = await setup();
    const da = await app.inject({
      method: 'POST',
      url: '/oauth/device_authorization',
      ...form({ client_id: CLIENT, scope: 'content:read content:write' }),
    });
    expect(da.statusCode).toBe(200);
    const auth = da.json() as { device_code: string; user_code: string; verification_uri: string; interval: number };
    expect(auth.device_code).toMatch(/^swd_/);
    expect(auth.verification_uri).toMatch(/\/oauth\/device$/);

    const poll = () =>
      app.inject({
        method: 'POST',
        url: '/oauth/token',
        ...form({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: auth.device_code, client_id: CLIENT }),
      });
    const pending = await poll();
    expect(pending.statusCode).toBe(400);
    expect((pending.json() as { error: string }).error).toBe('authorization_pending');

    // Approve in the browser (session).
    const approve = await app.inject({
      method: 'POST',
      url: '/oauth/device',
      cookies: { sw_session: session },
      ...form({ user_code: auth.user_code, project: projectId, decision: 'approve' }),
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.body).toMatch(/authorized/i);

    const tok = await poll();
    expect(tok.statusCode).toBe(200);
    expect((tok.json() as { access_token: string }).access_token).toMatch(/^swk_/);
  });
});

// Regression: behind a TLS-terminating reverse proxy the app-facing hop is plain HTTP with an
// internal Host, so request-derived metadata is `http://internal…` — which MCP/OAuth clients reject
// ("Protected resource http://… does not match expected https://…"). SW_PUBLIC_URL must override it.
describe('issuer/resource honor SW_PUBLIC_URL (proxy-correct metadata)', () => {
  const PUBLIC = 'https://sitewright.example';
  // Simulate the proxy→app hop: a plain-HTTP request with an internal Host that must NOT leak out.
  const proxied = { host: 'sitewright-api:3000' };
  let pubApp: FastifyInstance;
  let pubRoot: string;

  beforeEach(async () => {
    pubRoot = await mkdtemp(join(tmpdir(), 'sw-oauth-pub-'));
    pubApp = await createApp({ db: await makeTestDb(), publishRoot: pubRoot, encryptionKey: randomBytes(32), publicUrl: PUBLIC });
    await pubApp.ready();
  });
  afterEach(async () => {
    await pubApp.close();
    await rm(pubRoot, { recursive: true, force: true });
  });

  it('advertises the configured public origin in OAuth discovery, ignoring the request Host/scheme', async () => {
    const as = (await pubApp.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server', headers: proxied })).json();
    expect(as.issuer).toBe(PUBLIC);
    expect(as.authorization_endpoint).toBe(`${PUBLIC}/oauth/authorize`);
    expect(as.token_endpoint).toBe(`${PUBLIC}/oauth/token`);

    const pr = (await pubApp.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource', headers: proxied })).json();
    expect(pr.resource).toBe(PUBLIC);
    expect(pr.authorization_servers).toEqual([PUBLIC]);
  });

  it('points the MCP 401 challenge at the public-origin resource metadata', async () => {
    const res = await pubApp.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...proxied, 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(`Bearer resource_metadata="${PUBLIC}/.well-known/oauth-protected-resource"`);
  });

  it('strips a trailing slash from SW_PUBLIC_URL so built URLs have no double slash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sw-oauth-slash-'));
    const slashApp = await createApp({ db: await makeTestDb(), publishRoot: root, encryptionKey: randomBytes(32), publicUrl: `${PUBLIC}/` });
    await slashApp.ready();
    try {
      const as = (await slashApp.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' })).json();
      expect(as.issuer).toBe(PUBLIC);
      expect(as.authorization_endpoint).toBe(`${PUBLIC}/oauth/authorize`); // not `${PUBLIC}//oauth/authorize`
    } finally {
      await slashApp.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

// Without SW_PUBLIC_URL, metadata falls back to the request origin (unchanged behavior).
describe('issuer/resource fall back to the request when SW_PUBLIC_URL is unset', () => {
  it('derives resource from the request Host/scheme', async () => {
    const pr = (await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource', headers: { host: 'derived.example' } })).json();
    expect(pr.resource).toBe('http://derived.example');
    expect(pr.authorization_servers).toEqual(['http://derived.example']);
  });
});

// The consent page presents every capability as an editable checkbox; a generic MCP client that
// requests no scope no longer dead-ends at invalid_scope — it gets all caps pre-selected and the
// USER decides what to grant.
describe('consent-page scope selection', () => {
  const ALL_CAPS = ['content:read', 'content:write', 'content:delete', 'publish', 'deploy'];
  const authzGet = (session: string, extra: Record<string, string> = {}) =>
    app.inject({
      method: 'GET',
      cookies: { sw_session: session },
      url: `/oauth/authorize?${new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 's', ...extra })}`,
    });

  it('pre-checks ALL capabilities when the client requests no scope', async () => {
    const { session } = await setup();
    const page = await authzGet(session);
    expect(page.statusCode).toBe(200);
    for (const cap of ALL_CAPS) expect(page.body).toContain(`name="scope_${cap}" value="1" checked`);
    // The two destructive/externally-visible caps (content:delete, deploy) are flagged as elevated.
    expect(page.body.match(/class="scope-warn"/g) ?? []).toHaveLength(2);
  });

  it('honors a specific requested scope by pre-checking only those (others unchecked)', async () => {
    const { session } = await setup();
    const page = await authzGet(session, { scope: 'content:read' });
    expect(page.body).toContain(`name="scope_content:read" value="1" checked`);
    expect(page.body).toContain(`name="scope_content:write" value="1">`); // present…
    expect(page.body).not.toContain(`name="scope_content:write" value="1" checked`); // …but not checked
  });

  it('grants only the capabilities the user leaves checked (token scope reflects the selection)', async () => {
    const { session, projectId } = await setup();
    const consent = await app.inject({
      method: 'POST',
      url: '/oauth/authorize',
      cookies: { sw_session: session },
      // The user keeps read + publish, unchecks the rest.
      ...form({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256', 'scope_content:read': '1', 'scope_publish': '1', state: 's', project: projectId, decision: 'approve' }),
    });
    expect(consent.statusCode).toBe(302);
    const code = new URL(consent.headers.location as string).searchParams.get('code');
    const tok = (await app.inject({
      method: 'POST',
      url: '/oauth/token',
      ...form({ grant_type: 'authorization_code', code: code!, client_id: CLIENT, redirect_uri: REDIRECT, code_verifier: VERIFIER }),
    })).json() as { scope: string };
    expect(tok.scope.split(' ').sort()).toEqual(['content:read', 'publish']);
  });

  it('rejects approval with no capability checked — cannot mint an empty-scope token', async () => {
    const { session, projectId } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/oauth/authorize',
      cookies: { sw_session: session },
      ...form({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 's', project: projectId, decision: 'approve' }),
    });
    expect(res.statusCode).toBe(302);
    expect(new URL(res.headers.location as string).searchParams.get('error')).toBe('invalid_scope');
  });
});
